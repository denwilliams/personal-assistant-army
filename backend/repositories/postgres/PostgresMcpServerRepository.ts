import { sql } from "bun";
import type { McpServer } from "../../types/models";
import type {
  McpServerRepository,
  UpdateMcpServerData,
} from "../McpServerRepository";

type McpServerRecord = Omit<McpServer, "headers"> & { headers: string | null };

export class PostgresMcpServerRepository implements McpServerRepository {
  async listByUser(userId: number): Promise<McpServer[]> {
    const rows = await sql`
      SELECT * FROM mcp_servers WHERE user_id = ${userId} ORDER BY created_at DESC
    `;
    return rows.map(includeParsedHeaders);
  }

  async findById(id: number): Promise<McpServer | null> {
    const result = await sql`
      SELECT * FROM mcp_servers WHERE id = ${id}
    `;
    return includeParsedHeaders<McpServerRecord>(result[0]);
  }

  async create(
    userId: number,
    name: string,
    url: string,
    headers?: Record<string, string>
  ): Promise<McpServer> {
    const result = await sql`
      INSERT INTO mcp_servers (user_id, name, url, headers)
      VALUES (${userId}, ${name}, ${url}, ${
      headers ? JSON.stringify(headers) : null
    })
      RETURNING *
    `;
    return includeParsedHeaders<McpServerRecord>(result[0])!;
  }

  async update(id: number, data: UpdateMcpServerData): Promise<McpServer> {
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (data.name !== undefined) {
      updates.push(`name = $${paramIndex++}`);
      values.push(data.name);
    }
    if (data.url !== undefined) {
      updates.push(`url = $${paramIndex++}`);
      values.push(data.url);
    }
    if (data.headers !== undefined) {
      updates.push(`headers = $${paramIndex++}`);
      values.push(data.headers === null ? null : JSON.stringify(data.headers));
    }

    if (updates.length === 0) {
      // No updates, just return current record
      const result = await sql`SELECT * FROM mcp_servers WHERE id = ${id}`;
      return includeParsedHeaders<McpServerRecord>(result[0])!;
    }

    values.push(id);
    const result = await sql.unsafe(
      `UPDATE mcp_servers SET ${updates.join(
        ", "
      )} WHERE id = $${paramIndex} RETURNING *`,
      values
    );
    return includeParsedHeaders<McpServerRecord>(result[0])!;
  }

  async delete(id: number): Promise<void> {
    await sql`DELETE FROM mcp_servers WHERE id = ${id}`;
  }
}

function includeParsedHeaders<T extends { headers: string | null }>(
  item: T | undefined | null
): Omit<T, "headers"> & { headers: Record<string, string> | null } | null {
  if (!item) {
    return null;
  }
  return {
    ...item,
    headers: parseHeaders(item.headers) || null,
  };
}

function parseHeaders(
  headersStr: string | null
): Record<string, string> | null {
  if (!headersStr) {
    return null;
  }
  try {
    return JSON.parse(headersStr);
  } catch {
    return null;
  }
}
