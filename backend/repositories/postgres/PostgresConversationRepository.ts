import { sql } from "bun";
import type { Conversation, Message } from "../../types/models";
import type { ConversationRepository } from "../ConversationRepository";

export class PostgresConversationRepository implements ConversationRepository {
  async listByUser(userId: number): Promise<Conversation[]> {
    return await sql`
      SELECT * FROM conversations WHERE user_id = ${userId} ORDER BY updated_at DESC
    `;
  }

  async listByAgent(agentId: number): Promise<Conversation[]> {
    return await sql`
      SELECT * FROM conversations WHERE agent_id = ${agentId} ORDER BY updated_at DESC
    `;
  }

  async findById(id: number): Promise<Conversation | null> {
    const result = await sql`
      SELECT * FROM conversations WHERE id = ${id}
    `;
    return result[0] || null;
  }

  async create(userId: number, agentId: number): Promise<Conversation> {
    const result = await sql`
      INSERT INTO conversations (user_id, agent_id)
      VALUES (${userId}, ${agentId})
      RETURNING *
    `;
    return result[0];
  }

  async addMessage(
    conversationId: number,
    role: 'user' | 'assistant' | 'system',
    content: string,
    agentId?: number
  ): Promise<Message> {
    const result = await sql`
      INSERT INTO messages (conversation_id, role, content, agent_id)
      VALUES (${conversationId}, ${role}, ${content}, ${agentId || null})
      RETURNING *
    `;

    // Update conversation updated_at
    await sql`
      UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ${conversationId}
    `;

    return result[0];
  }

  async listMessages(conversationId: number, limit: number = 100, offset: number = 0): Promise<Message[]> {
    return await sql`
      SELECT * FROM messages
      WHERE conversation_id = ${conversationId}
      ORDER BY created_at ASC
      LIMIT ${limit} OFFSET ${offset}
    `;
  }
}
