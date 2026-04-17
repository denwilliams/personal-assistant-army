import { sql } from "bun";
import type { TeamSettings, TeamMcpServer, TeamUrlTool, TeamNotificationSettings } from "../../types/models";
import type { TeamRepository } from "../TeamRepository";

type McpRecord = Omit<TeamMcpServer, "headers"> & { headers: string | null };
type UrlRecord = Omit<TeamUrlTool, "headers"> & { headers: string | null };
type NotifRecord = Omit<TeamNotificationSettings, "webhook_urls"> & { webhook_urls: string | null };

function parseJson<T>(str: string | null, fallback: T): T {
  if (!str) return fallback;
  try {
    return JSON.parse(str) as T;
  } catch {
    return fallback;
  }
}

function parseMcp(row: McpRecord | null | undefined): TeamMcpServer | null {
  if (!row) return null;
  return { ...row, headers: parseJson<Record<string, string> | null>(row.headers, null) };
}

function parseUrl(row: UrlRecord | null | undefined): TeamUrlTool | null {
  if (!row) return null;
  return { ...row, headers: parseJson<Record<string, string> | null>(row.headers, null) };
}

function parseNotif(row: any | null | undefined): TeamNotificationSettings | null {
  if (!row) return null;
  return {
    ...row,
    webhook_urls: parseJsonField<Array<{ name: string; url: string }>>(row.webhook_urls, []),
    email_addresses: parseJsonField<Array<{ name: string; email: string }>>(row.email_addresses, []),
  };
}

function parseJsonField<T>(val: unknown, fallback: T): T {
  if (Array.isArray(val) || (val && typeof val === 'object')) return val as T;
  if (typeof val === 'string') {
    try { return JSON.parse(val) as T; } catch { return fallback; }
  }
  return fallback;
}

export class PostgresTeamRepository implements TeamRepository {
  // ── Settings ──────────────────────────────────────────────────────────────

  async getSettings(domain: string): Promise<TeamSettings | null> {
    const rows = await sql`SELECT * FROM team_settings WHERE domain = ${domain}`;
    return (rows[0] as TeamSettings) ?? null;
  }

  async upsertSettings(domain: string, data: {
    openai_api_key?: string;
    anthropic_api_key?: string;
    google_ai_api_key?: string;
    google_search_api_key?: string;
    google_search_engine_id?: string;
    google_service_account_key?: string;
    openwebui_url?: string;
    openwebui_api_key?: string;
    timezone?: string;
  }): Promise<TeamSettings> {
    const rows = await sql`
      INSERT INTO team_settings (
        domain, openai_api_key, anthropic_api_key, google_ai_api_key,
        google_search_api_key, google_search_engine_id, google_service_account_key,
        openwebui_url, openwebui_api_key, timezone
      )
      VALUES (
        ${domain},
        ${data.openai_api_key ?? null},
        ${data.anthropic_api_key ?? null},
        ${data.google_ai_api_key ?? null},
        ${data.google_search_api_key ?? null},
        ${data.google_search_engine_id ?? null},
        ${data.google_service_account_key ?? null},
        ${data.openwebui_url ?? null},
        ${data.openwebui_api_key ?? null},
        ${data.timezone ?? 'UTC'}
      )
      ON CONFLICT (domain) DO UPDATE SET
        openai_api_key        = COALESCE(EXCLUDED.openai_api_key, team_settings.openai_api_key),
        anthropic_api_key     = COALESCE(EXCLUDED.anthropic_api_key, team_settings.anthropic_api_key),
        google_ai_api_key     = COALESCE(EXCLUDED.google_ai_api_key, team_settings.google_ai_api_key),
        google_search_api_key = COALESCE(EXCLUDED.google_search_api_key, team_settings.google_search_api_key),
        google_search_engine_id = COALESCE(EXCLUDED.google_search_engine_id, team_settings.google_search_engine_id),
        google_service_account_key = COALESCE(EXCLUDED.google_service_account_key, team_settings.google_service_account_key),
        openwebui_url         = COALESCE(EXCLUDED.openwebui_url, team_settings.openwebui_url),
        openwebui_api_key     = COALESCE(EXCLUDED.openwebui_api_key, team_settings.openwebui_api_key),
        timezone              = COALESCE(EXCLUDED.timezone, team_settings.timezone),
        updated_at            = CURRENT_TIMESTAMP
      RETURNING *
    `;
    return rows[0] as TeamSettings;
  }

  // ── MCP Servers ───────────────────────────────────────────────────────────

  async listMcpServers(domain: string): Promise<TeamMcpServer[]> {
    const rows = await sql`SELECT * FROM team_mcp_servers WHERE domain = ${domain} ORDER BY created_at DESC`;
    return (rows as McpRecord[]).map((r) => parseMcp(r)!);
  }

  async findMcpServerById(id: number): Promise<TeamMcpServer | null> {
    const rows = await sql`SELECT * FROM team_mcp_servers WHERE id = ${id}`;
    return parseMcp(rows[0] as McpRecord | undefined);
  }

  async createMcpServer(domain: string, name: string, url: string, headers?: Record<string, string>): Promise<TeamMcpServer> {
    const rows = await sql`
      INSERT INTO team_mcp_servers (domain, name, url, headers)
      VALUES (${domain}, ${name}, ${url}, ${headers ? JSON.stringify(headers) : null})
      RETURNING *
    `;
    return parseMcp(rows[0] as McpRecord)!;
  }

  async updateMcpServer(id: number, data: { name?: string; url?: string; headers?: Record<string, string> | null }): Promise<TeamMcpServer> {
    const updates: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (data.name !== undefined) { updates.push(`name = $${idx++}`); values.push(data.name); }
    if (data.url !== undefined) { updates.push(`url = $${idx++}`); values.push(data.url); }
    if (data.headers !== undefined) { updates.push(`headers = $${idx++}`); values.push(data.headers === null ? null : JSON.stringify(data.headers)); }

    if (updates.length === 0) {
      const rows = await sql`SELECT * FROM team_mcp_servers WHERE id = ${id}`;
      return parseMcp(rows[0] as McpRecord)!;
    }

    values.push(id);
    const rows = await sql.unsafe(
      `UPDATE team_mcp_servers SET ${updates.join(", ")} WHERE id = $${idx} RETURNING *`,
      values
    );
    return parseMcp(rows[0] as McpRecord)!;
  }

  async deleteMcpServer(id: number): Promise<void> {
    await sql`DELETE FROM team_mcp_servers WHERE id = ${id}`;
  }

  // ── URL Tools ─────────────────────────────────────────────────────────────

  async listUrlTools(domain: string): Promise<TeamUrlTool[]> {
    const rows = await sql`SELECT * FROM team_url_tools WHERE domain = ${domain} ORDER BY created_at DESC`;
    return (rows as UrlRecord[]).map((r) => parseUrl(r)!);
  }

  async findUrlToolById(id: number): Promise<TeamUrlTool | null> {
    const rows = await sql`SELECT * FROM team_url_tools WHERE id = ${id}`;
    return parseUrl(rows[0] as UrlRecord | undefined);
  }

  async createUrlTool(domain: string, data: { name: string; description?: string; url: string; method: string; headers?: Record<string, string> }): Promise<TeamUrlTool> {
    const rows = await sql`
      INSERT INTO team_url_tools (domain, name, description, url, method, headers)
      VALUES (
        ${domain},
        ${data.name},
        ${data.description ?? null},
        ${data.url},
        ${data.method},
        ${data.headers ? JSON.stringify(data.headers) : null}
      )
      RETURNING *
    `;
    return parseUrl(rows[0] as UrlRecord)!;
  }

  async updateUrlTool(id: number, data: { name?: string; description?: string; url?: string; method?: string; headers?: Record<string, string> | null }): Promise<TeamUrlTool> {
    const updates: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (data.name !== undefined) { updates.push(`name = $${idx++}`); values.push(data.name); }
    if (data.description !== undefined) { updates.push(`description = $${idx++}`); values.push(data.description ?? null); }
    if (data.url !== undefined) { updates.push(`url = $${idx++}`); values.push(data.url); }
    if (data.method !== undefined) { updates.push(`method = $${idx++}`); values.push(data.method); }
    if (data.headers !== undefined) { updates.push(`headers = $${idx++}`); values.push(data.headers === null ? null : JSON.stringify(data.headers)); }

    if (updates.length > 0) {
      updates.push(`updated_at = CURRENT_TIMESTAMP`);
    } else {
      const rows = await sql`SELECT * FROM team_url_tools WHERE id = ${id}`;
      return parseUrl(rows[0] as UrlRecord)!;
    }

    values.push(id);
    const rows = await sql.unsafe(
      `UPDATE team_url_tools SET ${updates.join(", ")} WHERE id = $${idx} RETURNING *`,
      values
    );
    return parseUrl(rows[0] as UrlRecord)!;
  }

  async deleteUrlTool(id: number): Promise<void> {
    await sql`DELETE FROM team_url_tools WHERE id = ${id}`;
  }

  // ── Notification Settings ─────────────────────────────────────────────────

  async getNotificationSettings(domain: string): Promise<TeamNotificationSettings | null> {
    const rows = await sql`SELECT * FROM team_notification_settings WHERE domain = ${domain}`;
    return parseNotif(rows[0] as NotifRecord | undefined);
  }

  async upsertNotificationSettings(domain: string, data: Partial<Pick<TeamNotificationSettings, 'notification_email' | 'email_addresses' | 'webhook_urls' | 'email_enabled' | 'pushover_user_key' | 'pushover_api_token' | 'pushover_enabled'>>): Promise<TeamNotificationSettings> {
    const rows = await sql`
      INSERT INTO team_notification_settings (domain, notification_email, email_addresses, webhook_urls, email_enabled, pushover_user_key, pushover_api_token, pushover_enabled)
      VALUES (
        ${domain},
        ${data.notification_email ?? null},
        ${data.email_addresses ? JSON.stringify(data.email_addresses) : '[]'},
        ${data.webhook_urls ? JSON.stringify(data.webhook_urls) : '[]'},
        ${data.email_enabled ?? true},
        ${data.pushover_user_key ?? null},
        ${data.pushover_api_token ?? null},
        ${data.pushover_enabled ?? false}
      )
      ON CONFLICT (domain) DO UPDATE SET
        notification_email  = COALESCE(EXCLUDED.notification_email, team_notification_settings.notification_email),
        email_addresses     = EXCLUDED.email_addresses,
        webhook_urls        = EXCLUDED.webhook_urls,
        email_enabled       = EXCLUDED.email_enabled,
        pushover_user_key   = COALESCE(EXCLUDED.pushover_user_key, team_notification_settings.pushover_user_key),
        pushover_api_token  = COALESCE(EXCLUDED.pushover_api_token, team_notification_settings.pushover_api_token),
        pushover_enabled    = EXCLUDED.pushover_enabled,
        updated_at          = CURRENT_TIMESTAMP
      RETURNING *
    `;
    return parseNotif(rows[0])!;
  }
}
