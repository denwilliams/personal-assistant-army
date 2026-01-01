import { sql } from "bun";
import type { Session } from "../../auth/types";
import type { SessionRepository } from "../SessionRepository";

export class PostgresSessionRepository implements SessionRepository {
  async create(userId: number, expiresAt: Date): Promise<Session> {
    // Generate a random session ID
    const sessionId = crypto.randomUUID();

    const result = await sql`
      INSERT INTO sessions (id, user_id, expires_at)
      VALUES (${sessionId}, ${userId}, ${expiresAt})
      RETURNING id, user_id as "userId", expires_at as "expiresAt", created_at as "createdAt"
    `;
    return result[0];
  }

  async findById(sessionId: string): Promise<Session | null> {
    const result = await sql`
      SELECT id, user_id as "userId", expires_at as "expiresAt", created_at as "createdAt"
      FROM sessions
      WHERE id = ${sessionId} AND expires_at > CURRENT_TIMESTAMP
    `;
    return result[0] || null;
  }

  async delete(sessionId: string): Promise<void> {
    await sql`
      DELETE FROM sessions WHERE id = ${sessionId}
    `;
  }

  async deleteExpired(): Promise<void> {
    await sql`
      DELETE FROM sessions WHERE expires_at <= CURRENT_TIMESTAMP
    `;
  }

  async deleteByUserId(userId: number): Promise<void> {
    await sql`
      DELETE FROM sessions WHERE user_id = ${userId}
    `;
  }
}
