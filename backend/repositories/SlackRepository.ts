import type { SlackConfig, SlackChannelAgent } from "../types/models";

export interface UpsertSlackConfigData {
  user_id: number;
  bot_token?: string | null; // Encrypted, undefined means keep existing, null means clear
  app_token?: string | null;
  default_agent_id?: number | null;
  enabled?: boolean;
}

export interface UpsertChannelAgentData {
  user_id: number;
  channel_id: string;
  channel_name?: string | null;
  agent_id: number;
}

export interface SlackRepository {
  // Bot config
  getConfig(userId: number): Promise<SlackConfig | null>;
  upsertConfig(data: UpsertSlackConfigData): Promise<SlackConfig>;
  deleteConfig(userId: number): Promise<void>;
  listEnabledConfigs(): Promise<SlackConfig[]>;

  // Channel-agent mappings
  listChannelAgents(userId: number): Promise<SlackChannelAgent[]>;
  findChannelAgent(userId: number, channelId: string): Promise<SlackChannelAgent | null>;
  upsertChannelAgent(data: UpsertChannelAgentData): Promise<SlackChannelAgent>;
  deleteChannelAgent(userId: number, id: number): Promise<void>;
}
