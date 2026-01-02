import { sql } from "bun";
import type { User } from "../../types/models";
import type { UserRepository } from "../UserRepository";

export class PostgresUserRepository implements UserRepository {
  async findById(id: number): Promise<User | null> {
    const result = await sql`
      SELECT * FROM users WHERE id = ${id}
    `;
    return result[0] || null;
  }

  async findByGoogleId(googleId: string): Promise<User | null> {
    const result = await sql`
      SELECT * FROM users WHERE google_id = ${googleId}
    `;
    return result[0] || null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const result = await sql`
      SELECT * FROM users WHERE email = ${email}
    `;
    return result[0] || null;
  }

  async create(data: {
    google_id: string;
    email: string;
    name?: string;
    avatar_url?: string;
  }): Promise<User> {
    const result = await sql`
      INSERT INTO users (google_id, email, name, avatar_url)
      VALUES (${data.google_id}, ${data.email}, ${data.name || null}, ${data.avatar_url || null})
      RETURNING *
    `;
    return result[0];
  }

  async update(id: number, data: Partial<Omit<User, 'id' | 'created_at'>>): Promise<User> {
    const updates: string[] = [];
    const values: any[] = [];

    if (data.name !== undefined) {
      updates.push(`name = $${values.length + 1}`);
      values.push(data.name);
    }
    if (data.avatar_url !== undefined) {
      updates.push(`avatar_url = $${values.length + 1}`);
      values.push(data.avatar_url);
    }
    if (data.timezone !== undefined) {
      updates.push(`timezone = $${values.length + 1}`);
      values.push(data.timezone);
    }

    updates.push(`updated_at = CURRENT_TIMESTAMP`);

    const result = await sql`
      UPDATE users
      SET ${sql.unsafe(updates.join(', '))}
      WHERE id = ${id}
      RETURNING *
    `;
    return result[0];
  }

  async updateApiKeys(userId: number, data: {
    openai_api_key?: string;
    google_search_api_key?: string;
    google_search_engine_id?: string;
  }): Promise<void> {
    const updates: string[] = [];

    if (data.openai_api_key !== undefined) {
      await sql`
        UPDATE users
        SET openai_api_key = ${data.openai_api_key}, updated_at = CURRENT_TIMESTAMP
        WHERE id = ${userId}
      `;
    }
    if (data.google_search_api_key !== undefined) {
      await sql`
        UPDATE users
        SET google_search_api_key = ${data.google_search_api_key}, updated_at = CURRENT_TIMESTAMP
        WHERE id = ${userId}
      `;
    }
    if (data.google_search_engine_id !== undefined) {
      await sql`
        UPDATE users
        SET google_search_engine_id = ${data.google_search_engine_id}, updated_at = CURRENT_TIMESTAMP
        WHERE id = ${userId}
      `;
    }
  }
}
