import type { Conversation, Message } from "../types/models";

export interface CreateConversationData {
  user_id: number;
  agent_id: number;
  title?: string;
}

export interface CreateMessageData {
  conversation_id: number;
  role: "user" | "assistant" | "system";
  content: string;
  agent_id?: number; // For tracking which agent sent the message (handoffs)
}

export interface ConversationRepository {
  // Conversations
  listByUser(userId: number): Promise<Conversation[]>;
  listByAgent(userId: number, agentId: number): Promise<Conversation[]>;
  findById(id: number): Promise<Conversation | null>;
  create(data: CreateConversationData): Promise<Conversation>;
  delete(id: number): Promise<void>;

  // Messages
  listMessages(conversationId: number): Promise<Message[]>;
  addMessage(data: CreateMessageData): Promise<Message>;
  deleteMessage(id: number): Promise<void>;
}
