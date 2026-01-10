import { sql } from "bun";
import type { UrlTool } from "../../types/models";
import type {
  UrlToolRepository,
  CreateUrlToolData,
  UpdateUrlToolData,
} from "../UrlToolRepository";

type UrlToolRecord = Omit<UrlTool, "headers"> & { headers: string | null };

export class PostgresUrlToolRepository implements UrlToolRepository {
  async listByUser(userId: number): Promise<UrlTool[]> {
    const rows = await sql`
      SELECT * FROM url_tools WHERE user_id = ${userId} ORDER BY created_at DESC
    `;
    return rows.map(includeParsedHeaders);
  }

  async findById(id: number): Promise<UrlTool | null> {
    const result = await sql`
      SELECT * FROM url_tools WHERE id = ${id}
    `;
    return includeParsedHeaders<UrlToolRecord>(result[0]);
  }

  async create(data: CreateUrlToolData): Promise<UrlTool> {
    const result = await sql`
      INSERT INTO url_tools (user_id, name, description, url, method, headers)
      VALUES (
        ${data.user_id},
        ${data.name},
        ${data.description || null},
        ${data.url},
        ${data.method},
        ${data.headers ? JSON.stringify(data.headers) : null}
      )
      RETURNING *
    `;
    return includeParsedHeaders<UrlToolRecord>(result[0])!;
  }

  async update(id: number, data: UpdateUrlToolData): Promise<UrlTool> {
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (data.name !== undefined) {
      updates.push(`name = $${paramIndex++}`);
      values.push(data.name);
    }
    if (data.description !== undefined) {
      updates.push(`description = $${paramIndex++}`);
      values.push(data.description || null);
    }
    if (data.url !== undefined) {
      updates.push(`url = $${paramIndex++}`);
      values.push(data.url);
    }
    if (data.method !== undefined) {
      updates.push(`method = $${paramIndex++}`);
      values.push(data.method);
    }
    if (data.headers !== undefined) {
      updates.push(`headers = $${paramIndex++}`);
      values.push(data.headers === null ? null : JSON.stringify(data.headers));
    }

    if (updates.length > 0) {
      updates.push(`updated_at = CURRENT_TIMESTAMP`);
    }

    if (updates.length === 0) {
      // No updates, just return current record
      const result = await sql`SELECT * FROM url_tools WHERE id = ${id}`;
      return includeParsedHeaders<UrlToolRecord>(result[0])!;
    }

    values.push(id);
    const result = await sql.unsafe(
      `UPDATE url_tools SET ${updates.join(
        ", "
      )} WHERE id = $${paramIndex} RETURNING *`,
      values
    );
    return includeParsedHeaders<UrlToolRecord>(result[0])!;
  }

  async delete(id: number): Promise<void> {
    await sql`DELETE FROM url_tools WHERE id = ${id}`;
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
