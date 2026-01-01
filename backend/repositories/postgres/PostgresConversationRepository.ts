import { sql } from "bun";
import type { Conversation, Message } from "../../types/models";
import type {
  ConversationRepository,
  CreateConversationData,
  CreateMessageData,
} from "../ConversationRepository";

export class PostgresConversationRepository implements ConversationRepository {
  async listByUser(userId: number): Promise<Conversation[]> {
    return await sql`
      SELECT c.*
      FROM conversations c
      WHERE c.user_id = ${userId}
      ORDER BY c.updated_at DESC
    `;
  }

  async listByAgent(userId: number, agentId: number): Promise<Conversation[]> {
    return await sql`
      SELECT c.*
      FROM conversations c
      WHERE c.user_id = ${userId} AND c.agent_id = ${agentId}
      ORDER BY c.updated_at DESC
    `;
  }

  async findById(id: number): Promise<Conversation | null> {
    const result = await sql`
      SELECT * FROM conversations WHERE id = ${id}
    `;
    return result[0] || null;
  }

  async create(data: CreateConversationData): Promise<Conversation> {
    const result = await sql`
      INSERT INTO conversations (user_id, agent_id, title)
      VALUES (${data.user_id}, ${data.agent_id}, ${data.title || null})
      RETURNING *
    `;
    return result[0];
  }

  async delete(id: number): Promise<void> {
    await sql`DELETE FROM conversations WHERE id = ${id}`;
  }

  async listMessages(conversationId: number): Promise<Message[]> {
    return await sql`
      SELECT * FROM messages
      WHERE conversation_id = ${conversationId}
      ORDER BY created_at ASC
    `;
  }

  async addMessage(data: CreateMessageData): Promise<Message> {
    const result = await sql`
      INSERT INTO messages (conversation_id, role, content, agent_id)
      VALUES (
        ${data.conversation_id},
        ${data.role},
        ${data.content},
        ${data.agent_id || null}
      )
      RETURNING *
    `;

    // Update conversation's updated_at timestamp
    await sql`
      UPDATE conversations
      SET updated_at = CURRENT_TIMESTAMP
      WHERE id = ${data.conversation_id}
    `;

    return result[0];
  }

  async deleteMessage(id: number): Promise<void> {
    await sql`DELETE FROM messages WHERE id = ${id}`;
  }
}
