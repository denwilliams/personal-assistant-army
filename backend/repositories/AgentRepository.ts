import type { Agent } from "../types/models";

export interface CreateAgentData {
  user_id: number;
  slug: string;
  name: string;
  purpose?: string;
  system_prompt: string;
  internet_search_enabled?: boolean;
}

export interface UpdateAgentData {
  name?: string;
  purpose?: string;
  system_prompt?: string;
  internet_search_enabled?: boolean;
  slack_bot_token?: string;
  slack_enabled?: boolean;
}

export interface AgentRepository {
  listByUser(userId: number): Promise<Agent[]>;
  findById(id: number): Promise<Agent | null>;
  findBySlug(userId: number, slug: string): Promise<Agent | null>;
  findBySlackBotToken(slackBotToken: string): Promise<Agent | null>;
  create(data: CreateAgentData): Promise<Agent>;
  update(id: number, data: UpdateAgentData): Promise<Agent>;
  delete(id: number): Promise<void>;
  setFavorite(agentId: number, isFavorite: boolean): Promise<void>;
  addBuiltInTool(agentId: number, toolName: string): Promise<void>;
  removeBuiltInTool(agentId: number, toolName: string): Promise<void>;
  listBuiltInTools(agentId: number): Promise<string[]>;
  addMcpTool(agentId: number, mcpServerId: number): Promise<void>;
  removeMcpTool(agentId: number, mcpServerId: number): Promise<void>;
  listMcpTools(agentId: number): Promise<number[]>;
  addUrlTool(agentId: number, urlToolId: number): Promise<void>;
  removeUrlTool(agentId: number, urlToolId: number): Promise<void>;
  listUrlTools(agentId: number): Promise<number[]>;
  addAgentTool(agentId: number, toolAgentId: number): Promise<void>;
  removeAgentTool(agentId: number, toolAgentId: number): Promise<void>;
  listAgentTools(agentId: number): Promise<Agent[]>;
  addHandoff(fromAgentId: number, toAgentId: number): Promise<void>;
  removeHandoff(fromAgentId: number, toAgentId: number): Promise<void>;
  listHandoffs(fromAgentId: number): Promise<Agent[]>;
}
