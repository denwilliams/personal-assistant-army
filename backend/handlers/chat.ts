import { streamText, generateText, stepCountIs, type ModelMessage } from "ai";
import type { User } from "../types/models";
import type { AgentFactory, AgentRunConfig } from "../services/AgentFactory";
import type { ConversationRepository } from "../repositories/ConversationRepository";
import { decrypt } from "../utils/encryption";
import type { BunRequest } from "bun";
import { DatabaseSession } from "../services/DatabaseSession";
import type { ToolStatusUpdate } from "../tools/context";
import { EmbeddingService } from "../services/EmbeddingService";
import { resolveModel, type ApiKeys } from "../services/ModelResolver";

function getDomain(email: string): string {
  return email.split("@")[1] || "";
}

interface ChatHandlerDependencies {
  agentFactory: AgentFactory;
  conversationRepository: ConversationRepository;
  authenticate: (
    req: BunRequest
  ) => Promise<{ user: User; session: { id: string; userId: number } } | null>;
  encryptionSecret: string;
}

interface SendMessageRequest {
  message: string;
  conversation_id?: number;
}

const MAX_STEPS = 10;
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

  return keys;
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

      // Build API keys
      const apiKeys = await buildApiKeys(auth.user, deps.encryptionSecret);
      if (!apiKeys.openai && !apiKeys.anthropic && !apiKeys.google) {
        return new Response(
          JSON.stringify({
            error: "No API keys configured. Please add at least one API key in your profile.",
          }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      // Get agent configuration
      const agentConfig = await deps.agentFactory.getAgentConfig(auth.user.id, slug, getDomain(auth.user.email));

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

      // Decrypt Google search credentials if available
      let googleSearchApiKey: string | undefined;
      if (auth.user.google_search_api_key) {
        googleSearchApiKey = await decrypt(auth.user.google_search_api_key, deps.encryptionSecret);
      }

      // Create Server-Sent Events stream
      const stream = new ReadableStream({
        async start(controller) {
          const encoder = new TextEncoder();

          const emit: Emitter = (data) => {
            const chunk = JSON.stringify(data);
            controller.enqueue(encoder.encode(`data: ${chunk}\n\n`));
          };

          const updateStatus: ToolStatusUpdate = (msg) => {
            emit({ type: "tool_status", content: msg });
          };

          try {
            // Create embedding service (uses OpenAI for embeddings regardless of chat model)
            const embeddingService = apiKeys.openai
              ? new EmbeddingService(apiKeys.openai)
              : null;

            // Create agent run config
            const domain = getDomain(auth.user.email);
            let agentRunConfig = await deps.agentFactory.createAgent(
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
                googleSearchEngineId: auth.user.google_search_engine_id,
                domain,
              }
            );

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
            let currentAgentSlug = slug;

            while (true) {
              const model = resolveModel(agentRunConfig.model, apiKeys);

              emit({ type: "started" });
              emit({
                type: "agent_update",
                agent: { name: agentRunConfig.name },
              });

              const result = streamText({
                model,
                system: agentRunConfig.system,
                messages,
                tools: agentRunConfig.tools,
                stopWhen: stepCountIs(MAX_STEPS),
              });

              // Stream events to client
              for await (const part of result.fullStream) {
                switch (part.type) {
                  case "text-delta":
                    emit({ type: "text", content: (part as any).text ?? (part as any).delta ?? "" });
                    break;

                  case "tool-call":
                    emit({
                      type: "tool_call",
                      name: part.toolName,
                      agent: agentRunConfig.name,
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

                  case "error":
                    console.error("Stream part error:", (part as any).error);
                    break;
                }
              }

              emit({ type: "stopped" });

              // Get response messages for saving and handoff detection
              const response = await result.response;
              const responseMessages = response.messages as ModelMessage[];

              // Save all response messages to the database
              await session.saveResponseMessages(responseMessages);

              // Check for handoffs in the completed steps
              const steps = await result.steps;
              const handoffSlug = detectHandoff(steps as any);

              if (handoffSlug && handoffCount < MAX_HANDOFFS) {
                handoffCount++;
                currentAgentSlug = handoffSlug;

                // Create new agent config for handoff target
                agentRunConfig = await deps.agentFactory.createAgent(
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
                    googleSearchEngineId: auth.user.google_search_engine_id,
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
            controller.enqueue(encoder.encode(`data: ${doneData}\n\n`));

            controller.close();
          } catch (error) {
            console.error("Streaming error:", error);
            const errorData = JSON.stringify({
              type: "error",
              error: error instanceof Error ? error.message : "Stream failed",
            });
            controller.enqueue(encoder.encode(`data: ${errorData}\n\n`));
            controller.close();
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

      // Build API keys
      const apiKeys = await buildApiKeys(auth.user, deps.encryptionSecret);
      if (!apiKeys.openai && !apiKeys.anthropic && !apiKeys.google) {
        return new Response(
          JSON.stringify({
            error: "No API keys configured. Please add at least one API key in your profile.",
          }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      // Get agent configuration
      const agentConfig = await deps.agentFactory.getAgentConfig(auth.user.id, slug, getDomain(auth.user.email));

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

      // Decrypt Google search credentials
      let googleSearchApiKey: string | undefined;
      if (auth.user.google_search_api_key) {
        googleSearchApiKey = await decrypt(auth.user.google_search_api_key, deps.encryptionSecret);
      }

      // Create embedding service
      const embeddingService = apiKeys.openai ? new EmbeddingService(apiKeys.openai) : null;

      // Create agent run config
      const agentRunConfig = await deps.agentFactory.createAgent(
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
          googleSearchEngineId: auth.user.google_search_engine_id,
          domain: getDomain(auth.user.email),
        }
      );

      // Save user message and load history
      await session.addUserMessage(message);
      const messages = await session.getMessages();

      // Run the agent
      const model = resolveModel(agentRunConfig.model, apiKeys);
      const result = await generateText({
        model,
        system: agentRunConfig.system,
        messages,
        tools: agentRunConfig.tools,
        stopWhen: stepCountIs(MAX_STEPS),
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
