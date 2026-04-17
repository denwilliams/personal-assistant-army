import type { ModelMessage } from "ai";
import type { User } from "../types/models";
import type { AgentFactory } from "../services/AgentFactory";
import type { ConversationRepository } from "../repositories/ConversationRepository";
import type { TeamRepository } from "../repositories/TeamRepository";
import type { WorkflowRepository } from "../repositories/WorkflowRepository";
import { decrypt } from "../utils/encryption";
import type { BunRequest } from "bun";
import { DatabaseSession } from "../services/DatabaseSession";
import type { ToolStatusUpdate } from "../tools/context";
import { EmbeddingService } from "../services/EmbeddingService";
import type { ApiKeys } from "../services/ModelResolver";
import { WorkflowEngine } from "../workflows/WorkflowEngine";
import { parseWorkflow } from "../workflows/parser";
import { resolveModel, DEFAULT_MODEL } from "../services/ModelResolver";

function getDomain(email: string): string {
  return email.split("@")[1] || "";
}

interface ChatHandlerDependencies {
  agentFactory: AgentFactory;
  conversationRepository: ConversationRepository;
  teamRepository: TeamRepository | null;
  workflowRepository: WorkflowRepository | null;
  authenticate: (
    req: BunRequest
  ) => Promise<{ user: User; session: { id: string; userId: number } } | null>;
  encryptionSecret: string;
}

interface SendMessageRequest {
  message: string;
  conversation_id?: number;
}

const MAX_HANDOFFS = 5;

type Emitter = (
  data: {
    type:
      | "text"
      | "tool_call"
      | "agent_update"
      | "started"
      | "stopped"
      | "handoff"
      | "tool_status";
  } & Record<string, any>
) => void;

/**
 * Detect handoff markers in tool results from a streamText/generateText result.
 * Returns the handoff slug if found, null otherwise.
 */
function detectHandoff(steps: Array<{ toolResults: Array<{ output: unknown }> }>): string | null {
  for (const step of steps) {
    for (const toolResult of step.toolResults) {
      try {
        const parsed = typeof toolResult.output === "string"
          ? JSON.parse(toolResult.output)
          : toolResult.output;
        if (parsed?.__handoff && parsed?.slug) {
          return parsed.slug;
        }
      } catch {
        // not JSON, skip
      }
    }
  }
  return null;
}

/**
 * Build API keys object from user data
 */
async function buildApiKeys(user: User, encryptionSecret: string): Promise<ApiKeys> {
  const keys: ApiKeys = {};

  if (user.openai_api_key) {
    keys.openai = await decrypt(user.openai_api_key, encryptionSecret);
  }
  if (user.anthropic_api_key) {
    keys.anthropic = await decrypt(user.anthropic_api_key, encryptionSecret);
  }
  if (user.google_ai_api_key) {
    keys.google = await decrypt(user.google_ai_api_key, encryptionSecret);
  }
  if (user.ollama_url) {
    keys.ollama_url = user.ollama_url;
  }

  return keys;
}

function hasAnyProviderCreds(keys: ApiKeys): boolean {
  return Boolean(keys.openai || keys.anthropic || keys.google || keys.ollama_url);
}

/**
 * Factory function to create chat handlers
 */
export function createChatHandlers(deps: ChatHandlerDependencies) {
  /**
   * POST /api/chat/:slug/stream
   * Send a message to an agent with streaming response
   */
  const sendMessageStream = async (req: BunRequest): Promise<Response> => {
    const auth = await deps.authenticate(req);
    if (!auth) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    try {
      const url = new URL(req.url);
      const pathParts = url.pathname.split("/");
      const slug = pathParts[pathParts.length - 2]; // /api/chat/:slug/stream
      if (!slug) {
        return new Response(
          JSON.stringify({ error: "Agent slug is required" }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      const body: SendMessageRequest = await req.json();
      const { message, conversation_id } = body;

      if (!message || !message.trim()) {
        return new Response(JSON.stringify({ error: "Message is required" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Get agent configuration first to check pool_type
      const agentConfig = await deps.agentFactory.getAgentConfig(auth.user.id, slug, getDomain(auth.user.email));

      // Build API keys — use team settings for team agents, personal otherwise
      let apiKeys: ApiKeys;
      let googleSearchApiKey: string | undefined;
      let googleSearchEngineId: string | undefined;
      let googleServiceAccountKey: string | undefined;

      if (agentConfig.pool_type === 'team' && agentConfig.domain && deps.teamRepository) {
        const teamSettings = await deps.teamRepository.getSettings(agentConfig.domain);
        apiKeys = {};
        if (teamSettings?.openai_api_key) apiKeys.openai = await decrypt(teamSettings.openai_api_key, deps.encryptionSecret);
        if (teamSettings?.anthropic_api_key) apiKeys.anthropic = await decrypt(teamSettings.anthropic_api_key, deps.encryptionSecret);
        if (teamSettings?.google_ai_api_key) apiKeys.google = await decrypt(teamSettings.google_ai_api_key, deps.encryptionSecret);
        if (teamSettings?.google_search_api_key) googleSearchApiKey = await decrypt(teamSettings.google_search_api_key, deps.encryptionSecret);
        googleSearchEngineId = teamSettings?.google_search_engine_id;
        if (teamSettings?.google_service_account_key) googleServiceAccountKey = await decrypt(teamSettings.google_service_account_key, deps.encryptionSecret);
        if (teamSettings?.ollama_url) apiKeys.ollama_url = teamSettings.ollama_url;
      } else {
        apiKeys = await buildApiKeys(auth.user, deps.encryptionSecret);
        if (auth.user.google_search_api_key) {
          googleSearchApiKey = await decrypt(auth.user.google_search_api_key, deps.encryptionSecret);
        }
        googleSearchEngineId = auth.user.google_search_engine_id;
        if (auth.user.google_service_account_key) {
          googleServiceAccountKey = await decrypt(auth.user.google_service_account_key, deps.encryptionSecret);
        }
      }

      if (!hasAnyProviderCreds(apiKeys)) {
        return new Response(
          JSON.stringify({
            error: "No API keys configured. Please add at least one API key in your profile.",
          }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      // Get or create conversation
      let conversationId = conversation_id;
      if (!conversationId) {
        const conversation = await deps.conversationRepository.create({
          user_id: auth.user.id,
          agent_id: agentConfig.id,
          title: message.substring(0, 100),
        });
        conversationId = conversation.id;
      }

      // Verify conversation ownership
      const conversation = await deps.conversationRepository.findById(conversationId);
      if (!conversation || conversation.user_id !== auth.user.id) {
        return new Response(
          JSON.stringify({ error: "Conversation not found" }),
          { status: 404, headers: { "Content-Type": "application/json" } }
        );
      }

      // Create database session
      const session = new DatabaseSession(conversationId, deps.conversationRepository);

      // Create Server-Sent Events stream
      const stream = new ReadableStream({
        async start(controller) {
          const encoder = new TextEncoder();
          let isClosed = false;

          const emit: Emitter = (data) => {
            if (isClosed) return;
            const chunk = JSON.stringify(data);
            try {
              controller.enqueue(encoder.encode(`data: ${chunk}\n\n`));
            } catch (err) {
              isClosed = true;
              console.error(`[chat] Failed to enqueue:`, err);
            }
          };

          const updateStatus: ToolStatusUpdate = (msg) => {
            emit({ type: "tool_status", content: msg });
          };

          try {
            // Create embedding service (uses OpenAI for embeddings regardless of chat model)
            const embeddingService = apiKeys.openai
              ? new EmbeddingService(apiKeys.openai)
              : null;

            // Check for active workflow or start default workflow
            const domain = getDomain(auth.user.email);
            let workflowContext: any = undefined;
            let workflowEngine: WorkflowEngine | null = null;

            if (deps.workflowRepository) {
              workflowEngine = new WorkflowEngine({
                workflowRepository: deps.workflowRepository,
              });

              // Check for active workflow execution in this conversation
              const activeWorkflow = await workflowEngine.getActiveWorkflow(conversationId!);

              if (activeWorkflow) {
                const { execution, definition, state } = activeWorkflow;
                const currentStep = definition.steps[execution.current_step_index];
                if (currentStep) {
                  workflowContext = {
                    engine: workflowEngine,
                    definition,
                    executionId: execution.id,
                    currentStep,
                    currentStepIndex: execution.current_step_index,
                    facts: state.facts,
                  };
                }
              } else {
                // Check if the agent has a default workflow
                const defaultWorkflow = await deps.workflowRepository.getDefaultWorkflow(agentConfig.id);
                if (defaultWorkflow) {
                  const { execution, definition } = await workflowEngine.startWorkflow(
                    conversationId!,
                    defaultWorkflow.id
                  );
                  const firstStep = definition.steps[0]!;
                  workflowContext = {
                    engine: workflowEngine,
                    definition,
                    executionId: execution.id,
                    currentStep: firstStep,
                    currentStepIndex: 0,
                    facts: {},
                  };

                  emit({
                    type: "tool_status",
                    content: `Starting workflow: ${definition.name} — Step 1: ${firstStep.name}`,
                  });
                }
              }
            }

            // Create agent instance
            const agentStartTime = Date.now();
            let agentInstance = await deps.agentFactory.createAgent(
              auth.user.id,
              slug,
              updateStatus,
              apiKeys,
              {
                conversationId,
                generateEmbedding: embeddingService
                  ? (text) => embeddingService.generate(text)
                  : undefined,
                googleSearchApiKey,
                googleSearchEngineId,
                googleServiceAccountKey,
                domain,
                workflowContext,
              }
            );
            console.log(`[chat] Agent created in ${Date.now() - agentStartTime}ms`);

            // Send conversation_id and agent info
            const initData = JSON.stringify({
              type: "init",
              conversation_id: conversationId,
            });
            controller.enqueue(encoder.encode(`data: ${initData}\n\n`));

            // Save user message and load history
            await session.addUserMessage(message);
            let messages = await session.getMessages();

            // Handoff loop
            let handoffCount = 0;

            while (true) {
              emit({ type: "started" });
              emit({
                type: "agent_update",
                agent: { name: agentInstance.name },
              });

              const streamStartTime = Date.now();
              const result = await agentInstance.agent.stream(
                { messages },
                { timeout: 120_000 } // 120 second timeout
              );
              console.log(`[chat] agent.stream() took ${Date.now() - streamStartTime}ms`);

              // Stream events to client
              console.log(`[chat] Starting fullStream iteration...`);
              let partCount = 0;
              try {
                for await (const part of result.fullStream) {
                  partCount++;
                  if (partCount === 1 || partCount % 20 === 0) {
                    console.log(`[chat] Stream part ${partCount}:`, part.type);
                  }
                  switch (part.type) {
                    case "text-delta":
                      emit({ type: "text", content: (part as any).text ?? (part as any).delta ?? "" });
                      break;

                    case "tool-call":
                      emit({
                        type: "tool_call",
                        name: part.toolName,
                        agent: agentInstance.name,
                        status: "in_progress",
                      });
                      break;

                    case "tool-result":
                      // Check if it's a handoff result
                      try {
                        const output = (part as any).output;
                        const parsed = typeof output === "string"
                          ? JSON.parse(output)
                          : output;
                        if (parsed?.__handoff) {
                          emit({
                            type: "handoff",
                            name: parsed.name,
                          });
                        }
                      } catch {
                        // not a handoff
                      }
                      break;

                    case "error": {
                      const streamErr = (part as any).error;
                      console.error("Stream part error:", streamErr);
                      const errorMessage =
                        streamErr instanceof Error
                          ? streamErr.message
                          : typeof streamErr === "string"
                            ? streamErr
                            : streamErr?.message ?? JSON.stringify(streamErr);
                      emit({ type: "error", error: errorMessage });
                      break;
                    }
                  }
                }
              } catch (streamErr) {
                console.error(`[chat] Error during fullStream iteration:`, streamErr);
                throw streamErr;
              }

              console.log(`[chat] fullStream complete, ${partCount} parts received`);
              emit({ type: "stopped" });

              // Get response messages for saving and handoff detection
              const response = await result.response;
              const responseMessages = response.messages as ModelMessage[];

              // Save all response messages to the database
              await session.saveResponseMessages(responseMessages);

              // Check workflow advancement after each turn
              if (workflowContext && workflowEngine) {
                try {
                  // Build a verifier model (use the same model as the agent, or a cheaper one)
                  const verifierModel = resolveModel(
                    agentConfig.model || DEFAULT_MODEL,
                    apiKeys
                  );

                  const turnResult = await workflowEngine.tryAdvance(
                    workflowContext.executionId,
                    workflowContext.currentStepIndex,
                    workflowContext.definition,
                    verifierModel
                  );

                  if (turnResult.advanced && turnResult.nextStep) {
                    emit({
                      type: "tool_status",
                      content: `Workflow step complete! Moving to: ${turnResult.nextStep.name}`,
                    });

                    // Update workflow context for next iteration
                    const newFacts = await workflowEngine.getActiveWorkflow(conversationId!);
                    if (newFacts) {
                      workflowContext = {
                        engine: workflowEngine,
                        definition: workflowContext.definition,
                        executionId: workflowContext.executionId,
                        currentStep: turnResult.nextStep,
                        currentStepIndex: workflowContext.currentStepIndex + 1,
                        facts: newFacts.state.facts,
                      };
                    }
                  } else if (turnResult.completed) {
                    emit({
                      type: "tool_status",
                      content: `Workflow "${workflowContext.definition.name}" completed!`,
                    });
                    workflowContext = undefined;
                  } else if (turnResult.failed) {
                    emit({
                      type: "tool_status",
                      content: turnResult.systemMessage || "Workflow failed.",
                    });
                    workflowContext = undefined;
                  }
                  // On retry (not advanced), the agent will continue on the same step next turn
                } catch (err) {
                  console.error("Workflow advancement error:", err);
                }
              }

              // Check for handoffs in the completed steps
              const steps = await result.steps;
              const handoffSlug = detectHandoff(steps as any);

              if (handoffSlug && handoffCount < MAX_HANDOFFS) {
                handoffCount++;
                // Create new agent instance for handoff target
                agentInstance = await deps.agentFactory.createAgent(
                  auth.user.id,
                  handoffSlug,
                  updateStatus,
                  apiKeys,
                  {
                    conversationId,
                    generateEmbedding: embeddingService
                      ? (text) => embeddingService.generate(text)
                      : undefined,
                    googleSearchApiKey,
                    googleSearchEngineId,
                    googleServiceAccountKey,
                    domain,
                  }
                );

                // Reload full message history for the new agent
                messages = await session.getMessages();
                continue;
              }

              break;
            }

            // Send done event
            const doneData = JSON.stringify({ type: "done" });
            if (!isClosed) {
              try {
                controller.enqueue(encoder.encode(`data: ${doneData}\n\n`));
              } catch (err) {
                console.error(`[chat] Failed to send done:`, err);
                isClosed = true;
              }
            }
            if (!isClosed) {
              try {
                controller.close();
                isClosed = true;
              } catch (err) {
                console.error(`[chat] Failed to close:`, err);
                isClosed = true;
              }
            }
          } catch (error) {
            console.error("Streaming error after", partCount, "parts:", error);
            if (!isClosed) {
              const errorData = JSON.stringify({
                type: "error",
                error: error instanceof Error ? error.message : "Stream failed",
              });
              try {
                controller.enqueue(encoder.encode(`data: ${errorData}\n\n`));
              } catch {
                // Controller already closed
              }
              try {
                controller.close();
              } catch {
                // Already closed
              }
              isClosed = true;
            }
          }
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    } catch (error) {
      console.error("Chat stream error:", error);
      return new Response(
        JSON.stringify({
          error:
            error instanceof Error
              ? error.message
              : "Failed to process message",
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
  };

  /**
   * POST /api/chat/:slug
   * Send a message to an agent (non-streaming)
   */
  const sendMessage = async (req: BunRequest): Promise<Response> => {
    const auth = await deps.authenticate(req);
    if (!auth) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    try {
      const url = new URL(req.url);
      const pathParts = url.pathname.split("/");
      const slug = pathParts[pathParts.length - 1]; // /api/chat/:slug
      if (!slug) {
        return new Response(
          JSON.stringify({ error: "Agent slug is required" }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      const body: SendMessageRequest = await req.json();
      const { message, conversation_id } = body;

      if (!message || !message.trim()) {
        return new Response(JSON.stringify({ error: "Message is required" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Get agent configuration first to check pool_type
      const agentConfig = await deps.agentFactory.getAgentConfig(auth.user.id, slug, getDomain(auth.user.email));

      // Build API keys — use team settings for team agents, personal otherwise
      let apiKeys: ApiKeys;
      let googleSearchApiKey: string | undefined;
      let googleSearchEngineId: string | undefined;
      let googleServiceAccountKey: string | undefined;

      if (agentConfig.pool_type === 'team' && agentConfig.domain && deps.teamRepository) {
        const teamSettings = await deps.teamRepository.getSettings(agentConfig.domain);
        apiKeys = {};
        if (teamSettings?.openai_api_key) apiKeys.openai = await decrypt(teamSettings.openai_api_key, deps.encryptionSecret);
        if (teamSettings?.anthropic_api_key) apiKeys.anthropic = await decrypt(teamSettings.anthropic_api_key, deps.encryptionSecret);
        if (teamSettings?.google_ai_api_key) apiKeys.google = await decrypt(teamSettings.google_ai_api_key, deps.encryptionSecret);
        if (teamSettings?.google_search_api_key) googleSearchApiKey = await decrypt(teamSettings.google_search_api_key, deps.encryptionSecret);
        googleSearchEngineId = teamSettings?.google_search_engine_id;
        if (teamSettings?.google_service_account_key) googleServiceAccountKey = await decrypt(teamSettings.google_service_account_key, deps.encryptionSecret);
        if (teamSettings?.ollama_url) apiKeys.ollama_url = teamSettings.ollama_url;
      } else {
        apiKeys = await buildApiKeys(auth.user, deps.encryptionSecret);
        if (auth.user.google_search_api_key) {
          googleSearchApiKey = await decrypt(auth.user.google_search_api_key, deps.encryptionSecret);
        }
        googleSearchEngineId = auth.user.google_search_engine_id;
        if (auth.user.google_service_account_key) {
          googleServiceAccountKey = await decrypt(auth.user.google_service_account_key, deps.encryptionSecret);
        }
      }

      if (!hasAnyProviderCreds(apiKeys)) {
        return new Response(
          JSON.stringify({
            error: "No API keys configured. Please add at least one API key in your profile.",
          }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      // Get or create conversation
      let conversationId = conversation_id;
      if (!conversationId) {
        const conversation = await deps.conversationRepository.create({
          user_id: auth.user.id,
          agent_id: agentConfig.id,
          title: message.substring(0, 100),
        });
        conversationId = conversation.id;
      }

      // Verify conversation ownership
      const conversation = await deps.conversationRepository.findById(conversationId);
      if (!conversation || conversation.user_id !== auth.user.id) {
        return new Response(
          JSON.stringify({ error: "Conversation not found" }),
          { status: 404, headers: { "Content-Type": "application/json" } }
        );
      }

      // Create database session
      const session = new DatabaseSession(conversationId, deps.conversationRepository);

      // Create embedding service
      const embeddingService = apiKeys.openai ? new EmbeddingService(apiKeys.openai) : null;

      // Create agent instance
      const agentInstance = await deps.agentFactory.createAgent(
        auth.user.id,
        slug,
        () => {}, // no-op status for non-streaming
        apiKeys,
        {
          conversationId,
          generateEmbedding: embeddingService
            ? (text) => embeddingService.generate(text)
            : undefined,
          googleSearchApiKey,
          googleSearchEngineId,
          googleServiceAccountKey,
          domain: getDomain(auth.user.email),
        }
      );

      // Save user message and load history
      await session.addUserMessage(message);
      const messages = await session.getMessages();

      // Run the agent
      const result = await agentInstance.agent.generate({
        messages,
      });

      if (!result.text) {
        throw new Error("Agent did not return any output");
      }

      // Save response messages
      await session.saveResponseMessages(result.response.messages as ModelMessage[]);

      return Response.json({
        conversation_id: conversationId,
        message: result.text,
      });
    } catch (error) {
      console.error("Chat error:", error);
      return new Response(
        JSON.stringify({
          error:
            error instanceof Error
              ? error.message
              : "Failed to process message",
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
  };

  /**
   * GET /api/chat/:slug/history
   * Get conversation history for an agent
   */
  const getHistory = async (req: BunRequest): Promise<Response> => {
    const auth = await deps.authenticate(req);
    if (!auth) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    try {
      const url = new URL(req.url);
      const pathParts = url.pathname.split("/");
      const slug = pathParts[pathParts.length - 2]; // /api/chat/:slug/history
      if (!slug) {
        return new Response(
          JSON.stringify({ error: "Agent slug is required" }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      const agentConfig = await deps.agentFactory.getAgentConfig(auth.user.id, slug, getDomain(auth.user.email));
      const conversations = await deps.conversationRepository.listByAgent(
        auth.user.id,
        agentConfig.id
      );

      return Response.json({ conversations });
    } catch (error) {
      console.error("Get history error:", error);
      return new Response(
        JSON.stringify({
          error:
            error instanceof Error ? error.message : "Failed to get history",
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
  };

  /**
   * GET /api/chat/:slug/conversation/:id
   * Get messages for a specific conversation
   */
  const getConversation = async (req: BunRequest): Promise<Response> => {
    const auth = await deps.authenticate(req);
    if (!auth) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    try {
      const url = new URL(req.url);
      const pathParts = url.pathname.split("/");
      const conversationId = parseInt(pathParts[pathParts.length - 1] ?? "");
      if (isNaN(conversationId)) {
        return new Response(
          JSON.stringify({ error: "Invalid conversation ID" }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      const conversation = await deps.conversationRepository.findById(conversationId);
      if (!conversation || conversation.user_id !== auth.user.id) {
        return new Response(
          JSON.stringify({ error: "Conversation not found" }),
          { status: 404, headers: { "Content-Type": "application/json" } }
        );
      }

      const messages = await deps.conversationRepository.listMessages(conversationId);

      return Response.json({
        conversation,
        messages,
      });
    } catch (error) {
      console.error("Get conversation error:", error);
      return new Response(
        JSON.stringify({
          error:
            error instanceof Error
              ? error.message
              : "Failed to get conversation",
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
  };

  return {
    sendMessage,
    sendMessageStream,
    getHistory,
    getConversation,
  };
}
