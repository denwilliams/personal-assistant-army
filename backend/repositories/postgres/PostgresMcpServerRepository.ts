import { sql } from "bun";
import type { McpServer } from "../../types/models";
import type { McpServerRepository } from "../McpServerRepository";

export class PostgresMcpServerRepository implements McpServerRepository {
  async listByUser(userId: number): Promise<McpServer[]> {
    return await sql`
      SELECT * FROM mcp_servers WHERE user_id = ${userId} ORDER BY created_at DESC
    `;
  }

  async findById(id: number): Promise<McpServer | null> {
    const result = await sql`
      SELECT * FROM mcp_servers WHERE id = ${id}
    `;
    return result[0] || null;
  }

  async create(userId: number, name: string, url: string): Promise<McpServer> {
    const result = await sql`
      INSERT INTO mcp_servers (user_id, name, url)
      VALUES (${userId}, ${name}, ${url})
      RETURNING *
    `;
    return result[0];
  }

  async delete(id: number): Promise<void> {
    await sql`DELETE FROM mcp_servers WHERE id = ${id}`;
  }
}
