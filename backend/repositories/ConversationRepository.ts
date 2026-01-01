import type { Conversation, Message } from "../types/models";

export interface ConversationRepository {
  listByUser(userId: number): Promise<Conversation[]>;
  listByAgent(agentId: number): Promise<Conversation[]>;
  findById(id: number): Promise<Conversation | null>;
  create(userId: number, agentId: number): Promise<Conversation>;
  addMessage(conversationId: number, role: 'user' | 'assistant' | 'system', content: string, agentId?: number): Promise<Message>;
  listMessages(conversationId: number, limit?: number, offset?: number): Promise<Message[]>;
}
