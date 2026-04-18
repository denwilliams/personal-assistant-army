import type { BunRequest } from "bun";
import type { SlackRepository } from "../repositories/SlackRepository";
import type { AgentRepository } from "../repositories/AgentRepository";
import type { User } from "../types/models";
import { encrypt } from "../utils/encryption";

interface SlackHandlerDependencies {
  slackRepository: SlackRepository;
  agentRepository: AgentRepository;
  authenticate: (
    req: BunRequest
  ) => Promise<{ user: User; session: { id: string; userId: number } } | null>;
  encryptionSecret: string;
  getStatus?: (userId: number) => { connected: boolean };
  reconnect?: (userId: number) => Promise<void>;
  disconnect?: (userId: number) => Promise<void>;
}

/**
 * Slack bot management handlers.
 * Configures a user-wide Slack bot (Socket Mode) plus per-channel agent assignments.
 */
export function createSlackHandlers(deps: SlackHandlerDependencies) {
  const getConfig = async (req: BunRequest): Promise<Response> => {
    const auth = await deps.authenticate(req);
    if (!auth) return Response.json({ error: "Unauthorized" }, { status: 401 });

    try {
      const config = await deps.slackRepository.getConfig(auth.user.id);
      if (!config) {
        return Response.json({ config: null });
      }
      return Response.json({
        config: {
          id: config.id,
          has_bot_token: !!config.bot_token,
          has_app_token: !!config.app_token,
          default_agent_id: config.default_agent_id,
          enabled: config.enabled,
          created_at: config.created_at,
          updated_at: config.updated_at,
        },
      });
    } catch (err) {
      console.error("Error getting Slack config:", err);
      return Response.json({ error: "Failed to get Slack config" }, { status: 500 });
    }
  };

  const upsertConfig = async (req: BunRequest): Promise<Response> => {
    const auth = await deps.authenticate(req);
    if (!auth) return Response.json({ error: "Unauthorized" }, { status: 401 });

    try {
      const body = await req.json();
      const { bot_token, app_token, default_agent_id, enabled } = body;

      // Validate default agent belongs to user (if provided)
      if (default_agent_id !== undefined && default_agent_id !== null) {
        const agent = await deps.agentRepository.findById(default_agent_id);
        if (!agent || agent.user_id !== auth.user.id) {
          return Response.json({ error: "Invalid default agent" }, { status: 400 });
        }
      }

      let encryptedBotToken: string | undefined;
      let encryptedAppToken: string | undefined;
      if (bot_token) {
        if (!/^xoxb-/.test(bot_token)) {
          return Response.json({ error: "bot_token must start with xoxb-" }, { status: 400 });
        }
        encryptedBotToken = await encrypt(bot_token, deps.encryptionSecret);
      }
      if (app_token) {
        if (!/^xapp-/.test(app_token)) {
          return Response.json({ error: "app_token must start with xapp-" }, { status: 400 });
        }
        encryptedAppToken = await encrypt(app_token, deps.encryptionSecret);
      }

      const config = await deps.slackRepository.upsertConfig({
        user_id: auth.user.id,
        bot_token: encryptedBotToken,
        app_token: encryptedAppToken,
        default_agent_id: default_agent_id === undefined ? undefined : default_agent_id,
        enabled: enabled === undefined ? undefined : enabled,
      });

      // Kick the connection so new tokens take effect
      if (deps.reconnect && config.enabled) {
        await deps.reconnect(auth.user.id);
      } else if (deps.disconnect && !config.enabled) {
        await deps.disconnect(auth.user.id);
      }

      return Response.json({
        config: {
          id: config.id,
          has_bot_token: !!config.bot_token,
          has_app_token: !!config.app_token,
          default_agent_id: config.default_agent_id,
          enabled: config.enabled,
          created_at: config.created_at,
          updated_at: config.updated_at,
        },
      });
    } catch (err) {
      console.error("Error saving Slack config:", err);
      const msg = err instanceof Error ? err.message : "Failed to save Slack config";
      return Response.json({ error: msg }, { status: 500 });
    }
  };

  const deleteConfig = async (req: BunRequest): Promise<Response> => {
    const auth = await deps.authenticate(req);
    if (!auth) return Response.json({ error: "Unauthorized" }, { status: 401 });

    try {
      if (deps.disconnect) await deps.disconnect(auth.user.id);
      await deps.slackRepository.deleteConfig(auth.user.id);
      return Response.json({ success: true });
    } catch (err) {
      console.error("Error deleting Slack config:", err);
      return Response.json({ error: "Failed to delete Slack config" }, { status: 500 });
    }
  };

  const getStatus = async (req: BunRequest): Promise<Response> => {
    const auth = await deps.authenticate(req);
    if (!auth) return Response.json({ error: "Unauthorized" }, { status: 401 });
    const status = deps.getStatus ? deps.getStatus(auth.user.id) : { connected: false };
    return Response.json(status);
  };

  const reconnect = async (req: BunRequest): Promise<Response> => {
    const auth = await deps.authenticate(req);
    if (!auth) return Response.json({ error: "Unauthorized" }, { status: 401 });
    try {
      if (deps.reconnect) await deps.reconnect(auth.user.id);
      return Response.json({ success: true });
    } catch (err) {
      return Response.json(
        { error: err instanceof Error ? err.message : "Reconnect failed" },
        { status: 500 }
      );
    }
  };

  const listChannels = async (req: BunRequest): Promise<Response> => {
    const auth = await deps.authenticate(req);
    if (!auth) return Response.json({ error: "Unauthorized" }, { status: 401 });
    const channels = await deps.slackRepository.listChannelAgents(auth.user.id);
    return Response.json({ channels });
  };

  const upsertChannel = async (req: BunRequest): Promise<Response> => {
    const auth = await deps.authenticate(req);
    if (!auth) return Response.json({ error: "Unauthorized" }, { status: 401 });

    try {
      const body = await req.json();
      const { channel_id, channel_name, agent_id } = body;

      if (!channel_id || !agent_id) {
        return Response.json(
          { error: "channel_id and agent_id are required" },
          { status: 400 }
        );
      }

      const agent = await deps.agentRepository.findById(agent_id);
      if (!agent || agent.user_id !== auth.user.id) {
        return Response.json({ error: "Invalid agent" }, { status: 400 });
      }

      const mapping = await deps.slackRepository.upsertChannelAgent({
        user_id: auth.user.id,
        channel_id,
        channel_name: channel_name ?? null,
        agent_id,
      });
      return Response.json({ channel: mapping });
    } catch (err) {
      console.error("Error upserting Slack channel mapping:", err);
      return Response.json({ error: "Failed to save channel mapping" }, { status: 500 });
    }
  };

  const deleteChannel = async (req: BunRequest): Promise<Response> => {
    const auth = await deps.authenticate(req);
    if (!auth) return Response.json({ error: "Unauthorized" }, { status: 401 });

    try {
      const url = new URL(req.url);
      const parts = url.pathname.split("/");
      const id = parseInt(parts[parts.length - 1] ?? "");
      if (isNaN(id)) {
        return Response.json({ error: "Invalid channel mapping id" }, { status: 400 });
      }
      await deps.slackRepository.deleteChannelAgent(auth.user.id, id);
      return Response.json({ success: true });
    } catch (err) {
      console.error("Error deleting Slack channel mapping:", err);
      return Response.json({ error: "Failed to delete channel mapping" }, { status: 500 });
    }
  };

  return {
    getConfig,
    upsertConfig,
    deleteConfig,
    getStatus,
    reconnect,
    listChannels,
    upsertChannel,
    deleteChannel,
  };
}
