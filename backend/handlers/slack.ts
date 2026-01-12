import { run, setDefaultOpenAIKey } from "@openai/agents";
import type { AgentFactory } from "../services/AgentFactory";
import type { ConversationRepository } from "../repositories/ConversationRepository";
import type { AgentRepository } from "../repositories/AgentRepository";
import type { SlackService } from "../services/SlackService";
import type { BunRequest } from "bun";
import { decrypt } from "../utils/encryption";
import type { UserRepository } from "../repositories/UserRepository";
import { DatabaseSession } from "../services/DatabaseSession";

interface SlackHandlerDependencies {
  agentFactory: AgentFactory;
  conversationRepository: ConversationRepository;
  agentRepository: AgentRepository;
  userRepository: UserRepository;
  slackService: SlackService;
  encryptionSecret: string;
}

interface SlackEvent {
  type: string;
  channel?: string;
  user?: string;
  text?: string;
  ts?: string;
  thread_ts?: string;
  bot_id?: string;
  subtype?: string;
}

interface SlackEventPayload {
  token: string;
  team_id: string;
  api_app_id: string;
  event: SlackEvent;
  type: string;
  event_id: string;
  event_time: number;
  authed_users?: string[];
  challenge?: string; // For URL verification
}

interface UserContext {
  id: number;
  email: string;
  name?: string;
  avatar_url?: string;
  google_search_api_key?: string;
  google_search_engine_id?: string;
}

/**
 * Factory function to create Slack event handlers
 */
export function createSlackHandlers(deps: SlackHandlerDependencies) {
  /**
   * POST /api/slack/events/:agentId
   * Slack event webhook handler for a specific agent
   */
  const handleSlackEvent = async (req: BunRequest): Promise<Response> => {
    try {
      const url = new URL(req.url);
      const pathParts = url.pathname.split("/");
      const agentIdStr = pathParts[pathParts.length - 1]; // /api/slack/events/:agentId
      const agentId = parseInt(agentIdStr, 10);

      if (!agentId || isNaN(agentId)) {
        return new Response(
          JSON.stringify({ error: "Invalid agent ID" }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      const payload: SlackEventPayload = await req.json();

      // Handle URL verification challenge
      if (payload.type === "url_verification") {
        return new Response(JSON.stringify({ challenge: payload.challenge }), {
          headers: { "Content-Type": "application/json" },
        });
      }

      // Only handle event_callback type
      if (payload.type !== "event_callback") {
        return new Response(JSON.stringify({ ok: true }), {
          headers: { "Content-Type": "application/json" },
        });
      }

      const event = payload.event;

      // Ignore bot messages to prevent loops
      if (event.bot_id || event.subtype === "bot_message") {
        return new Response(JSON.stringify({ ok: true }), {
          headers: { "Content-Type": "application/json" },
        });
      }

      // Only handle message events
      if (event.type !== "message") {
        return new Response(JSON.stringify({ ok: true }), {
          headers: { "Content-Type": "application/json" },
        });
      }

      // Get agent configuration
      const agent = await deps.agentRepository.findById(agentId);
      if (!agent) {
        console.error(`Agent not found: ${agentId}`);
        return new Response(JSON.stringify({ error: "Agent not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Check if Slack is enabled for this agent
      if (!agent.slack_enabled || !agent.slack_bot_token) {
        console.error(`Slack not enabled for agent: ${agentId}`);
        return new Response(
          JSON.stringify({ error: "Slack not enabled for this agent" }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      // Get the user who owns this agent
      const user = await deps.userRepository.findById(agent.user_id);
      if (!user || !user.openai_api_key) {
        console.error(`User not found or OpenAI key missing: ${agent.user_id}`);
        return new Response(
          JSON.stringify({ error: "User configuration error" }),
          {
            status: 500,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      const message = event.text || "";
      const channel = event.channel || "";
      const threadTs = event.thread_ts || event.ts || "";

      if (!message.trim() || !channel || !threadTs) {
        return new Response(JSON.stringify({ ok: true }), {
          headers: { "Content-Type": "application/json" },
        });
      }

      // Process the message asynchronously (don't block Slack's webhook)
      processSlackMessage({
        agent,
        user,
        message,
        channel,
        threadTs,
        deps,
      }).catch((error) => {
        console.error("Error processing Slack message:", error);
      });

      // Respond immediately to Slack to acknowledge receipt
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      console.error("Slack webhook error:", error);
      return new Response(
        JSON.stringify({
          error: error instanceof Error ? error.message : "Webhook failed",
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
  };

  return {
    handleSlackEvent,
  };
}

/**
 * Process a Slack message and send response
 */
async function processSlackMessage({
  agent,
  user,
  message,
  channel,
  threadTs,
  deps,
}: {
  agent: any;
  user: any;
  message: string;
  channel: string;
  threadTs: string;
  deps: SlackHandlerDependencies;
}) {
  try {
    // Decrypt bot token and OpenAI key
    const botToken = await decrypt(agent.slack_bot_token, deps.encryptionSecret);
    const openaiApiKey = await decrypt(user.openai_api_key, deps.encryptionSecret);

    // Find or create conversation based on Slack thread
    let conversation = await deps.conversationRepository.findByExternalId(
      user.id,
      agent.id,
      "slack",
      threadTs
    );

    if (!conversation) {
      conversation = await deps.conversationRepository.create({
        user_id: user.id,
        agent_id: agent.id,
        title: message.substring(0, 100),
        source: "slack",
        external_id: threadTs,
      });
    }

    // Create database-backed session for conversation history
    const session = new DatabaseSession(
      conversation.id,
      deps.conversationRepository
    );

    // Create agent instance
    const agentInstance = await deps.agentFactory.createAgent<UserContext>(
      user,
      agent.slug
    );

    // Set OpenAI API key
    setDefaultOpenAIKey(openaiApiKey);

    // Run agent (non-streaming for Slack)
    const result = await run(agentInstance, message, {
      stream: false,
      context: user as UserContext,
      session,
    });

    if (!result.finalOutput) {
      throw new Error("Agent did not return any output");
    }

    // Send response to Slack
    await deps.slackService.sendMessage(botToken, {
      channel,
      text: result.finalOutput,
      thread_ts: threadTs,
    });

    // Session automatically saves messages via DatabaseSession
  } catch (error) {
    console.error("Error in processSlackMessage:", error);

    // Try to send error message to Slack
    try {
      const botToken = await decrypt(agent.slack_bot_token, deps.encryptionSecret);
      await deps.slackService.sendMessage(botToken, {
        channel,
        text: `Sorry, I encountered an error: ${error instanceof Error ? error.message : "Unknown error"}`,
        thread_ts: threadTs,
      });
    } catch (sendError) {
      console.error("Failed to send error message to Slack:", sendError);
    }
  }
}
