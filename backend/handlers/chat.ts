import { run } from "@openai/agents";
import type { User } from "../types/models";
import type { AgentFactory } from "../services/AgentFactory";
import type { ConversationRepository } from "../repositories/ConversationRepository";
import { decrypt } from "../utils/encryption";
import type { BunRequest } from "bun";

interface ChatHandlerDependencies {
  agentFactory: AgentFactory;
  conversationRepository: ConversationRepository;
  authenticate: (req: BunRequest) => Promise<{ user: User; session: { id: string; userId: number } } | null>;
  encryptionSecret: string;
}

interface SendMessageRequest {
  message: string;
  conversation_id?: number;
}

/**
 * Factory function to create chat handlers
 */
export function createChatHandlers(deps: ChatHandlerDependencies) {
  /**
   * POST /api/chat/:slug
   * Send a message to an agent
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

      const body: SendMessageRequest = await req.json();
      const { message, conversation_id } = body;

      if (!message || !message.trim()) {
        return new Response(JSON.stringify({ error: "Message is required" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Get agent configuration
      const agentConfig = await deps.agentFactory.getAgentConfig(auth.user.id, slug);

      // Get user's OpenAI API key
      if (!auth.user.openai_api_key) {
        return new Response(
          JSON.stringify({ error: "OpenAI API key not configured. Please add it in your profile." }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      const openaiApiKey = await decrypt(auth.user.openai_api_key, deps.encryptionSecret);

      // Set OpenAI API key for this request
      process.env.OPENAI_API_KEY = openaiApiKey;

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
      const conversation = await deps.conversationRepository.findById(conversationId);
      if (!conversation || conversation.user_id !== auth.user.id) {
        return new Response(JSON.stringify({ error: "Conversation not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Save user message
      await deps.conversationRepository.addMessage({
        conversation_id: conversationId,
        role: "user",
        content: message,
      });

      // Create agent instance
      const agent = await deps.agentFactory.createAgent(auth.user.id, slug, openaiApiKey);

      // Get conversation history
      const messages = await deps.conversationRepository.listMessages(conversationId);

      // Build message history for OpenAI (excluding the message we just added, we'll add it in run())
      const history = messages
        .slice(0, -1) // Exclude the last message (the one we just added)
        .map((msg) => ({
          role: msg.role as "user" | "assistant" | "system",
          content: msg.content,
        }));

      // Run agent with message
      const result = await run(agent, message, {
        // Pass conversation history if available
        ...(history.length > 0 && { messages: history }),
      });

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
          error: error instanceof Error ? error.message : "Failed to process message",
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

      // Get agent
      const agentConfig = await deps.agentFactory.getAgentConfig(auth.user.id, slug);

      // Get conversations for this agent
      const conversations = await deps.conversationRepository.listByAgent(auth.user.id, agentConfig.id);

      return Response.json({ conversations });
    } catch (error) {
      console.error("Get history error:", error);
      return new Response(
        JSON.stringify({
          error: error instanceof Error ? error.message : "Failed to get history",
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
      const conversationId = parseInt(pathParts[pathParts.length - 1]); // /api/chat/:slug/conversation/:id

      const conversation = await deps.conversationRepository.findById(conversationId);
      if (!conversation || conversation.user_id !== auth.user.id) {
        return new Response(JSON.stringify({ error: "Conversation not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
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
          error: error instanceof Error ? error.message : "Failed to get conversation",
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
    getHistory,
    getConversation,
  };
}
