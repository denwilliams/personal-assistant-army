import { sql } from "bun";
import type { SlackConfig, SlackChannelAgent } from "../../types/models";
import type {
  SlackRepository,
  UpsertSlackConfigData,
  UpsertChannelAgentData,
} from "../SlackRepository";

export class PostgresSlackRepository implements SlackRepository {
  async getConfig(userId: number): Promise<SlackConfig | null> {
    const result = await sql`
      SELECT * FROM slack_configs WHERE user_id = ${userId}
    `;
    return result[0] || null;
  }

  async upsertConfig(data: UpsertSlackConfigData): Promise<SlackConfig> {
    const existing = await this.getConfig(data.user_id);

    if (!existing) {
      if (!data.bot_token || !data.app_token) {
        throw new Error("bot_token and app_token are required to create a Slack config");
      }
      const result = await sql`
        INSERT INTO slack_configs (user_id, bot_token, app_token, default_agent_id, enabled)
        VALUES (${data.user_id}, ${data.bot_token}, ${data.app_token}, ${data.default_agent_id ?? null}, ${data.enabled ?? true})
        RETURNING *
      `;
      return result[0];
    }

    // Update — keep existing tokens when undefined
    const botToken = data.bot_token === undefined ? existing.bot_token : data.bot_token;
    const appToken = data.app_token === undefined ? existing.app_token : data.app_token;
    const defaultAgentId = data.default_agent_id === undefined ? existing.default_agent_id : data.default_agent_id;
    const enabled = data.enabled === undefined ? existing.enabled : data.enabled;

    const result = await sql`
      UPDATE slack_configs SET
        bot_token = ${botToken},
        app_token = ${appToken},
        default_agent_id = ${defaultAgentId},
        enabled = ${enabled},
        updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ${data.user_id}
      RETURNING *
    `;
    return result[0];
  }

  async deleteConfig(userId: number): Promise<void> {
    await sql`DELETE FROM slack_configs WHERE user_id = ${userId}`;
  }

  async listEnabledConfigs(): Promise<SlackConfig[]> {
    return await sql`SELECT * FROM slack_configs WHERE enabled = TRUE`;
  }

  async listChannelAgents(userId: number): Promise<SlackChannelAgent[]> {
    return await sql`
      SELECT * FROM slack_channel_agents
      WHERE user_id = ${userId}
      ORDER BY created_at ASC
    `;
  }

  async findChannelAgent(userId: number, channelId: string): Promise<SlackChannelAgent | null> {
    const result = await sql`
      SELECT * FROM slack_channel_agents
      WHERE user_id = ${userId} AND channel_id = ${channelId}
    `;
    return result[0] || null;
  }

  async upsertChannelAgent(data: UpsertChannelAgentData): Promise<SlackChannelAgent> {
    const result = await sql`
      INSERT INTO slack_channel_agents (user_id, channel_id, channel_name, agent_id)
      VALUES (${data.user_id}, ${data.channel_id}, ${data.channel_name ?? null}, ${data.agent_id})
      ON CONFLICT (user_id, channel_id) DO UPDATE SET
        channel_name = EXCLUDED.channel_name,
        agent_id = EXCLUDED.agent_id
      RETURNING *
    `;
    return result[0];
  }

  async deleteChannelAgent(userId: number, id: number): Promise<void> {
    await sql`
      DELETE FROM slack_channel_agents
      WHERE id = ${id} AND user_id = ${userId}
    `;
  }
}
