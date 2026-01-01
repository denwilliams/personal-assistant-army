import {
  run,
  RunAgentUpdatedStreamEvent,
  RunHandoffCallItem,
  RunHandoffOutputItem,
  RunItemStreamEvent,
  RunRawModelStreamEvent,
  RunToolCallItem,
  setDefaultOpenAIKey,
  type RunItem,
} from "@openai/agents";
import type { User } from "../types/models";
import type { AgentFactory } from "../services/AgentFactory";
import type { ConversationRepository } from "../repositories/ConversationRepository";
import { decrypt } from "../utils/encryption";
import type { BunRequest } from "bun";
import { DatabaseSession } from "../services/DatabaseSession";

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

interface UserContext {
  id: number;
  email: string;
  name?: string;
  avatar_url?: string;
  google_search_api_key?: string; // Encrypted
  google_search_engine_id?: string;
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
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          }
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

      // Get agent configuration
      const agentConfig = await deps.agentFactory.getAgentConfig(
        auth.user.id,
        slug
      );

      // Get user's OpenAI API key
      if (!auth.user.openai_api_key) {
        return new Response(
          JSON.stringify({
            error:
              "OpenAI API key not configured. Please add it in your profile.",
          }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      const openaiApiKey = await decrypt(
        auth.user.openai_api_key,
        deps.encryptionSecret
      );

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
      const conversation = await deps.conversationRepository.findById(
        conversationId
      );
      if (!conversation || conversation.user_id !== auth.user.id) {
        return new Response(
          JSON.stringify({ error: "Conversation not found" }),
          {
            status: 404,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      // Create database-backed session for conversation history
      const session = new DatabaseSession(conversationId, deps.conversationRepository);

      // Create agent instance
      const agent = await deps.agentFactory.createAgent<UserContext>(
        auth.user,
        slug,
        openaiApiKey
      );

      // Set OpenAI API key
      setDefaultOpenAIKey(openaiApiKey);

      // Create Server-Sent Events stream
      const stream = new ReadableStream({
        async start(controller) {
          const encoder = new TextEncoder();

          // Send conversation_id first
          const initData = JSON.stringify({
            type: "init",
            conversation_id: conversationId,
          });
          controller.enqueue(encoder.encode(`data: ${initData}\n\n`));

          try {
            // Run agent with streaming enabled and session for history management
            const streamedResult = await run(agent, message, {
              stream: true,
              context: auth.user,
              session,
            });

            let fullOutput = "";

            // Stream events to client
            const emit = (
              data: {
                type:
                  | "text"
                  | "tool_call"
                  | "agent_update"
                  | "started"
                  | "stopped";
              } & Record<string, any>
            ) => {
              const chunk = JSON.stringify(data);
              controller.enqueue(encoder.encode(`data: ${chunk}\n\n`));
            };
            for await (const event of streamedResult) {
              switch (event.type) {
                case "agent_updated_stream_event":
                  // there is a new agent running
                  handleAgentUpdatedStreamEvent(event, emit);
                  break;

                case "raw_model_stream_event":
                  // raw events directly passed through from the LLM
                  fullOutput += handleRawModelStreamEvent(event, emit);
                  break;

                case "run_item_stream_event":
                  // events that wrap a RunItem (tool calls, handoffs, etc.)
                  handleRunItemStreamEvent(event, emit);
                  break;
              }
            }

            // Session automatically saves messages, no need to manually save

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
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          }
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

      // Get agent configuration
      const agentConfig = await deps.agentFactory.getAgentConfig(
        auth.user.id,
        slug
      );

      // Get user's OpenAI API key
      if (!auth.user.openai_api_key) {
        return new Response(
          JSON.stringify({
            error:
              "OpenAI API key not configured. Please add it in your profile.",
          }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      const openaiApiKey = await decrypt(
        auth.user.openai_api_key,
        deps.encryptionSecret
      );

      // Set OpenAI API key for this request
      // TODO: get rid of this hackery
      // process.env.OPENAI_API_KEY = openaiApiKey;

      // Get or create conversation
      let conversationId = conversation_id;
      if (!conversationId) {
        const conversation = await deps.conversationRepository.create({
          user_id: auth.user.id,
          agent_id: agentConfig.id,
          title: message.substring(0, 100), // Use first message as title
        });
        conversationId = conversation.id;
      }

      // Verify conversation ownership
      const conversation = await deps.conversationRepository.findById(
        conversationId
      );
      if (!conversation || conversation.user_id !== auth.user.id) {
        return new Response(
          JSON.stringify({ error: "Conversation not found" }),
          {
            status: 404,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      // Save user message
      await deps.conversationRepository.addMessage({
        conversation_id: conversationId,
        role: "user",
        content: message,
      });

      // Create agent instance
      const agent = await deps.agentFactory.createAgent<UserContext>(
        auth.user,
        slug,
        openaiApiKey
      );

      // Run agent with the user's message
      // Note: For now, we're not passing conversation history to the SDK.
      // This can be enhanced later using the SDK's session management or by
      // manually constructing the input array with previous messages.

      // Get conversation history
      const messages = await deps.conversationRepository.listMessages(
        conversationId
      );

      // Build message history for OpenAI (excluding the message we just added, we'll add it in run())
      const history = messages
        .slice(0, -1) // Exclude the last message (the one we just added)
        .map((msg) => ({
          role: msg.role as "user" | "assistant" | "system",
          content: msg.content,
        }));

      // Hacky - surely there's a better way to pass the API key to the SDK
      setDefaultOpenAIKey(openaiApiKey);
      const result = await run(agent, message, {
        context: auth.user,
        // conversationId we are currently using the database ID, we should use the OpenAI one
        // previousResponseId
        // session: we need to implement a session storage
      });

      if (!result.finalOutput) {
        throw new Error("Agent did not return any output");
      }

      // Save assistant response
      await deps.conversationRepository.addMessage({
        conversation_id: conversationId,
        role: "assistant",
        content: result.finalOutput,
        agent_id: agentConfig.id,
      });

      // Clear the API key from env
      delete process.env.OPENAI_API_KEY;

      return Response.json({
        conversation_id: conversationId,
        message: result.finalOutput,
      });
    } catch (error) {
      console.error("Chat error:", error);

      // Clear the API key from env on error
      delete process.env.OPENAI_API_KEY;

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
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      // Get agent
      const agentConfig = await deps.agentFactory.getAgentConfig(
        auth.user.id,
        slug
      );

      // Get conversations for this agent
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
      const conversationId = parseInt(pathParts[pathParts.length - 1] ?? ""); // /api/chat/:slug/conversation/:id
      if (isNaN(conversationId)) {
        return new Response(
          JSON.stringify({ error: "Invalid conversation ID" }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      const conversation = await deps.conversationRepository.findById(
        conversationId
      );
      if (!conversation || conversation.user_id !== auth.user.id) {
        return new Response(
          JSON.stringify({ error: "Conversation not found" }),
          {
            status: 404,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      const messages = await deps.conversationRepository.listMessages(
        conversationId
      );

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

function handleRawModelStreamEvent(
  event: RunRawModelStreamEvent,
  emit: (
    data: {
      type: "text" | "tool_call" | "agent_update" | "started" | "stopped";
    } & Record<string, any>
  ) => void
): string {
  // Raw model stream events contain text deltas
  const rawEvent = event.data;

  switch (rawEvent.type) {
    case "model":
      // we seem to get one of these for every event - response start, done, delta
      break;
    case "output_text_delta":
      emit({
        type: "text",
        content: rawEvent.delta,
      });
      return rawEvent.delta;
    case "response_started":
      emit({
        type: "started",
      });
      break;
    case "response_done":
      emit({
        type: "stopped",
      });
      break;
  }

  return "";
}

function handleRunItemStreamEvent(
  event: RunItemStreamEvent,
  emit: (
    data: { type: "text" | "tool_call" | "agent_update" | "handoff" } & Record<string, any>
  ) => void
) {
  // Run item events (tool calls, handoffs, etc.)
  let toolCallItem = event.item;

  switch (event.name) {
    case "tool_called":
      toolCallItem = toolCallItem as RunToolCallItem;
      const agentName = toolCallItem.agent.name;
      const toolName = getToolName(toolCallItem);

      emit({
        type: "tool_call",
        name: toolName,
        agent: agentName,
        status: toolCallItem.rawItem.status,
      });
      break;
    case "tool_approval_requested":
      break;
    case "tool_output":
      break;

    case "handoff_requested":
      const handoffItem = event.item as RunHandoffCallItem;
      // console.log("Handoff requested to agent:", handoffItem.rawItem.name);
      emit({
        type: "handoff",
        name: handoffItem.rawItem.name,
      });
      break;
    case "handoff_occurred":
      const handoffOutputItem = event.item as RunHandoffOutputItem;
      console.log("Handoff complete:", handoffOutputItem.targetAgent.name);
      break;

    case "reasoning_item_created":
      break;

    case "message_output_created":
      break;
  }
}

function getToolName(item: RunToolCallItem): string {
  switch (item.rawItem.type) {
    case "computer_call":
      return item.rawItem.action.type;
    case "function_call":
      return item.rawItem.name;
    case "hosted_tool_call":
      return item.rawItem.name;
    case "apply_patch_call":
    case "shell_call":
    default:
      return item.rawItem.type;
  }
}

function handleAgentUpdatedStreamEvent(
  event: RunAgentUpdatedStreamEvent,
  emit: (
    data: { type: "text" | "tool_call" | "agent_update" } & Record<string, any>
  ) => void
) {
  // agent details changed, probably due to handoff
  emit({
    type: "agent_update",
    agent: {
      name: event.agent.name,
    },
  });
}
