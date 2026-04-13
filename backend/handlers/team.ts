import type { BunRequest } from "bun";
import type { TeamRepository } from "../repositories/TeamRepository";
import type { User } from "../types/models";
import { encrypt, decrypt } from "../utils/encryption";

const PERSONAL_DOMAINS = new Set([
  "gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "icloud.com",
  "me.com", "mac.com", "aol.com", "protonmail.com", "proton.me",
  "live.com", "msn.com", "mail.com", "ymail.com", "googlemail.com",
]);

function getUserDomain(email: string): string {
  return email.split("@")[1] ?? "";
}

function isPersonalDomain(domain: string): boolean {
  if (!domain || domain === "localhost") return true;
  if (domain.startsWith("demo-")) return true;
  return PERSONAL_DOMAINS.has(domain.toLowerCase());
}

const VALID_HTTP_METHODS = ["GET", "POST", "PUT", "DELETE", "PATCH"];

interface TeamHandlerDependencies {
  teamRepository: TeamRepository;
  authenticate: (req: BunRequest) => Promise<{ user: User; session: { id: string; userId: number } } | null>;
  encryptionSecret: string;
}

export function createTeamHandlers(deps: TeamHandlerDependencies) {
  /**
   * GET /api/team/settings
   */
  const getSettings = async (req: BunRequest): Promise<Response> => {
    const auth = await deps.authenticate(req);
    if (!auth) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const domain = getUserDomain(auth.user.email);
    if (isPersonalDomain(domain)) {
      return Response.json({ error: "Team settings not available for personal email domains." }, { status: 403 });
    }

    try {
      const settings = await deps.teamRepository.getSettings(domain);
      return Response.json({
        domain,
        timezone: settings?.timezone ?? "UTC",
        has_openai_key: !!settings?.openai_api_key,
        has_anthropic_key: !!settings?.anthropic_api_key,
        has_google_ai_key: !!settings?.google_ai_api_key,
        has_google_search_key: !!settings?.google_search_api_key,
        has_google_service_account_key: !!settings?.google_service_account_key,
        google_search_engine_id: settings?.google_search_engine_id ?? null,
        created_at: settings?.created_at ?? null,
        updated_at: settings?.updated_at ?? null,
      });
    } catch (err) {
      console.error("Error getting team settings:", err);
      return Response.json({ error: "Failed to get team settings" }, { status: 500 });
    }
  };

  /**
   * PUT /api/team/settings — update non-secret fields (timezone)
   */
  const updateSettings = async (req: BunRequest): Promise<Response> => {
    const auth = await deps.authenticate(req);
    if (!auth) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const domain = getUserDomain(auth.user.email);
    if (isPersonalDomain(domain)) {
      return Response.json({ error: "Team settings not available for personal email domains." }, { status: 403 });
    }

    try {
      const body = await req.json();
      const { timezone } = body;

      const settings = await deps.teamRepository.upsertSettings(domain, { timezone });
      return Response.json({
        domain,
        timezone: settings.timezone,
        has_openai_key: !!settings.openai_api_key,
        has_anthropic_key: !!settings.anthropic_api_key,
        has_google_ai_key: !!settings.google_ai_api_key,
        has_google_search_key: !!settings.google_search_api_key,
        has_google_service_account_key: !!settings.google_service_account_key,
        google_search_engine_id: settings.google_search_engine_id ?? null,
        updated_at: settings.updated_at,
      });
    } catch (err) {
      console.error("Error updating team settings:", err);
      return Response.json({ error: "Failed to update team settings" }, { status: 500 });
    }
  };

  /**
   * PUT /api/team/credentials — update encrypted API keys
   */
  const updateCredentials = async (req: BunRequest): Promise<Response> => {
    const auth = await deps.authenticate(req);
    if (!auth) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const domain = getUserDomain(auth.user.email);
    if (isPersonalDomain(domain)) {
      return Response.json({ error: "Team settings not available for personal email domains." }, { status: 403 });
    }

    try {
      const body = await req.json();
      const { openai_api_key, anthropic_api_key, google_ai_api_key, google_search_api_key, google_search_engine_id, google_service_account_key } = body;

      const encryptedData: Record<string, string | undefined> = {};

      if (openai_api_key) {
        encryptedData.openai_api_key = await encrypt(openai_api_key, deps.encryptionSecret);
      }
      if (anthropic_api_key) {
        encryptedData.anthropic_api_key = await encrypt(anthropic_api_key, deps.encryptionSecret);
      }
      if (google_ai_api_key) {
        encryptedData.google_ai_api_key = await encrypt(google_ai_api_key, deps.encryptionSecret);
      }
      if (google_search_api_key) {
        encryptedData.google_search_api_key = await encrypt(google_search_api_key, deps.encryptionSecret);
      }
      if (google_search_engine_id !== undefined) {
        encryptedData.google_search_engine_id = google_search_engine_id;
      }
      if (google_service_account_key) {
        encryptedData.google_service_account_key = await encrypt(google_service_account_key, deps.encryptionSecret);
      }

      await deps.teamRepository.upsertSettings(domain, encryptedData);
      return Response.json({ success: true });
    } catch (err) {
      console.error("Error updating team credentials:", err);
      return Response.json({ error: "Failed to update team credentials" }, { status: 500 });
    }
  };

  // ── MCP Servers ──────────────────────────────────────────────────────────

  /**
   * GET /api/team/mcp-servers
   */
  const listMcpServers = async (req: BunRequest): Promise<Response> => {
    const auth = await deps.authenticate(req);
    if (!auth) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const domain = getUserDomain(auth.user.email);
    if (isPersonalDomain(domain)) {
      return Response.json({ error: "Team settings not available for personal email domains." }, { status: 403 });
    }

    try {
      const servers = await deps.teamRepository.listMcpServers(domain);
      return Response.json(servers);
    } catch (err) {
      console.error("Error listing team MCP servers:", err);
      return Response.json({ error: "Failed to list team MCP servers" }, { status: 500 });
    }
  };

  /**
   * POST /api/team/mcp-servers
   */
  const createMcpServer = async (req: BunRequest): Promise<Response> => {
    const auth = await deps.authenticate(req);
    if (!auth) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const domain = getUserDomain(auth.user.email);
    if (isPersonalDomain(domain)) {
      return Response.json({ error: "Team settings not available for personal email domains." }, { status: 403 });
    }

    try {
      const body = await req.json();
      const { name, url, headers } = body;

      if (!name || !url) {
        return Response.json({ error: "Name and URL are required" }, { status: 400 });
      }

      try { new URL(url); } catch {
        return Response.json({ error: "Invalid URL format" }, { status: 400 });
      }

      const server = await deps.teamRepository.createMcpServer(domain, name, url, headers);
      return Response.json(server, { status: 201 });
    } catch (err) {
      console.error("Error creating team MCP server:", err);
      if (err instanceof Error && err.message.includes("unique")) {
        return Response.json({ error: "MCP server with this name already exists" }, { status: 409 });
      }
      return Response.json({ error: "Failed to create team MCP server" }, { status: 500 });
    }
  };

  /**
   * PUT /api/team/mcp-servers/:id
   */
  const updateMcpServer = async (req: BunRequest): Promise<Response> => {
    const auth = await deps.authenticate(req);
    if (!auth) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const domain = getUserDomain(auth.user.email);
    if (isPersonalDomain(domain)) {
      return Response.json({ error: "Team settings not available for personal email domains." }, { status: 403 });
    }

    try {
      const url = new URL(req.url);
      const pathParts = url.pathname.split("/");
      const id = parseInt(pathParts[pathParts.length - 1] ?? "");
      if (isNaN(id)) return Response.json({ error: "Invalid server ID" }, { status: 400 });

      const server = await deps.teamRepository.findMcpServerById(id);
      if (!server) return Response.json({ error: "Server not found" }, { status: 404 });
      if (server.domain !== domain) return Response.json({ error: "Forbidden" }, { status: 403 });

      const body = await req.json();
      if (body.url) {
        try { new URL(body.url); } catch {
          return Response.json({ error: "Invalid URL format" }, { status: 400 });
        }
      }

      const updated = await deps.teamRepository.updateMcpServer(id, { name: body.name, url: body.url, headers: body.headers });
      return Response.json(updated);
    } catch (err) {
      console.error("Error updating team MCP server:", err);
      return Response.json({ error: "Failed to update team MCP server" }, { status: 500 });
    }
  };

  /**
   * DELETE /api/team/mcp-servers/:id
   */
  const deleteMcpServer = async (req: BunRequest): Promise<Response> => {
    const auth = await deps.authenticate(req);
    if (!auth) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const domain = getUserDomain(auth.user.email);
    if (isPersonalDomain(domain)) {
      return Response.json({ error: "Team settings not available for personal email domains." }, { status: 403 });
    }

    try {
      const url = new URL(req.url);
      const pathParts = url.pathname.split("/");
      const id = parseInt(pathParts[pathParts.length - 1] ?? "");
      if (isNaN(id)) return Response.json({ error: "Invalid server ID" }, { status: 400 });

      const server = await deps.teamRepository.findMcpServerById(id);
      if (!server) return Response.json({ error: "Server not found" }, { status: 404 });
      if (server.domain !== domain) return Response.json({ error: "Forbidden" }, { status: 403 });

      await deps.teamRepository.deleteMcpServer(id);
      return Response.json({ success: true });
    } catch (err) {
      console.error("Error deleting team MCP server:", err);
      return Response.json({ error: "Failed to delete team MCP server" }, { status: 500 });
    }
  };

  // ── URL Tools ────────────────────────────────────────────────────────────

  /**
   * GET /api/team/url-tools
   */
  const listUrlTools = async (req: BunRequest): Promise<Response> => {
    const auth = await deps.authenticate(req);
    if (!auth) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const domain = getUserDomain(auth.user.email);
    if (isPersonalDomain(domain)) {
      return Response.json({ error: "Team settings not available for personal email domains." }, { status: 403 });
    }

    try {
      const tools = await deps.teamRepository.listUrlTools(domain);
      return Response.json(tools);
    } catch (err) {
      console.error("Error listing team URL tools:", err);
      return Response.json({ error: "Failed to list team URL tools" }, { status: 500 });
    }
  };

  /**
   * POST /api/team/url-tools
   */
  const createUrlTool = async (req: BunRequest): Promise<Response> => {
    const auth = await deps.authenticate(req);
    if (!auth) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const domain = getUserDomain(auth.user.email);
    if (isPersonalDomain(domain)) {
      return Response.json({ error: "Team settings not available for personal email domains." }, { status: 403 });
    }

    try {
      const body = await req.json();
      const { name, description, url, method, headers } = body;

      if (!name || !url || !method) {
        return Response.json({ error: "Name, URL, and method are required" }, { status: 400 });
      }

      try { new URL(url); } catch {
        return Response.json({ error: "Invalid URL format" }, { status: 400 });
      }

      const upperMethod = method.toUpperCase();
      if (!VALID_HTTP_METHODS.includes(upperMethod)) {
        return Response.json({ error: `Invalid HTTP method. Must be one of: ${VALID_HTTP_METHODS.join(", ")}` }, { status: 400 });
      }

      const tool = await deps.teamRepository.createUrlTool(domain, { name, description, url, method: upperMethod, headers });
      return Response.json(tool, { status: 201 });
    } catch (err) {
      console.error("Error creating team URL tool:", err);
      if (err instanceof Error && err.message.includes("unique")) {
        return Response.json({ error: "URL tool with this name already exists" }, { status: 409 });
      }
      return Response.json({ error: "Failed to create team URL tool" }, { status: 500 });
    }
  };

  /**
   * PUT /api/team/url-tools/:id
   */
  const updateUrlTool = async (req: BunRequest): Promise<Response> => {
    const auth = await deps.authenticate(req);
    if (!auth) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const domain = getUserDomain(auth.user.email);
    if (isPersonalDomain(domain)) {
      return Response.json({ error: "Team settings not available for personal email domains." }, { status: 403 });
    }

    try {
      const reqUrl = new URL(req.url);
      const pathParts = reqUrl.pathname.split("/");
      const id = parseInt(pathParts[pathParts.length - 1] ?? "");
      if (isNaN(id)) return Response.json({ error: "Invalid tool ID" }, { status: 400 });

      const existing = await deps.teamRepository.findUrlToolById(id);
      if (!existing) return Response.json({ error: "Tool not found" }, { status: 404 });
      if (existing.domain !== domain) return Response.json({ error: "Forbidden" }, { status: 403 });

      const body = await req.json();

      if (body.url) {
        try { new URL(body.url); } catch {
          return Response.json({ error: "Invalid URL format" }, { status: 400 });
        }
      }

      if (body.method) {
        const m = body.method.toUpperCase();
        if (!VALID_HTTP_METHODS.includes(m)) {
          return Response.json({ error: `Invalid HTTP method. Must be one of: ${VALID_HTTP_METHODS.join(", ")}` }, { status: 400 });
        }
        body.method = m;
      }

      const updated = await deps.teamRepository.updateUrlTool(id, {
        name: body.name,
        description: body.description,
        url: body.url,
        method: body.method,
        headers: body.headers,
      });
      return Response.json(updated);
    } catch (err) {
      console.error("Error updating team URL tool:", err);
      return Response.json({ error: "Failed to update team URL tool" }, { status: 500 });
    }
  };

  /**
   * DELETE /api/team/url-tools/:id
   */
  const deleteUrlTool = async (req: BunRequest): Promise<Response> => {
    const auth = await deps.authenticate(req);
    if (!auth) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const domain = getUserDomain(auth.user.email);
    if (isPersonalDomain(domain)) {
      return Response.json({ error: "Team settings not available for personal email domains." }, { status: 403 });
    }

    try {
      const reqUrl = new URL(req.url);
      const pathParts = reqUrl.pathname.split("/");
      const id = parseInt(pathParts[pathParts.length - 1] ?? "");
      if (isNaN(id)) return Response.json({ error: "Invalid tool ID" }, { status: 400 });

      const existing = await deps.teamRepository.findUrlToolById(id);
      if (!existing) return Response.json({ error: "Tool not found" }, { status: 404 });
      if (existing.domain !== domain) return Response.json({ error: "Forbidden" }, { status: 403 });

      await deps.teamRepository.deleteUrlTool(id);
      return Response.json({ success: true });
    } catch (err) {
      console.error("Error deleting team URL tool:", err);
      return Response.json({ error: "Failed to delete team URL tool" }, { status: 500 });
    }
  };

  // ── Notification Settings ────────────────────────────────────────────────

  /**
   * GET /api/team/notification-settings
   */
  const getNotificationSettings = async (req: BunRequest): Promise<Response> => {
    const auth = await deps.authenticate(req);
    if (!auth) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const domain = getUserDomain(auth.user.email);
    if (isPersonalDomain(domain)) {
      return Response.json({ error: "Team settings not available for personal email domains." }, { status: 403 });
    }

    try {
      const settings = await deps.teamRepository.getNotificationSettings(domain);
      return Response.json({
        settings: settings ?? {
          notification_email: null,
          email_addresses: [],
          webhook_urls: [],
          email_enabled: true,
          pushover_user_key: null,
          pushover_api_token: null,
          pushover_enabled: false,
        },
      });
    } catch (err) {
      console.error("Error getting team notification settings:", err);
      return Response.json({ error: "Failed to get team notification settings" }, { status: 500 });
    }
  };

  /**
   * PUT /api/team/notification-settings
   */
  const updateNotificationSettings = async (req: BunRequest): Promise<Response> => {
    const auth = await deps.authenticate(req);
    if (!auth) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const domain = getUserDomain(auth.user.email);
    if (isPersonalDomain(domain)) {
      return Response.json({ error: "Team settings not available for personal email domains." }, { status: 403 });
    }

    try {
      const body = await req.json();
      const { notification_email, email_addresses, webhook_urls, email_enabled, pushover_user_key, pushover_api_token, pushover_enabled } = body;

      if (webhook_urls) {
        for (const webhook of webhook_urls) {
          if (!webhook.url || !webhook.url.startsWith("https://")) {
            return Response.json({ error: `Webhook URL must use HTTPS: ${webhook.url}` }, { status: 400 });
          }
          if (!webhook.name) {
            return Response.json({ error: "Webhook must have a name" }, { status: 400 });
          }
        }
      }

      if (email_addresses) {
        for (const entry of email_addresses) {
          if (!entry.name || !entry.email) {
            return Response.json({ error: "Each email address must have a name and email" }, { status: 400 });
          }
        }
      }

      const settings = await deps.teamRepository.upsertNotificationSettings(domain, {
        notification_email,
        email_addresses,
        webhook_urls,
        email_enabled,
        pushover_user_key,
        pushover_api_token,
        pushover_enabled,
      });
      return Response.json({ settings });
    } catch (err) {
      console.error("Error updating team notification settings:", err);
      return Response.json({ error: "Failed to update team notification settings" }, { status: 500 });
    }
  };

  return {
    getSettings,
    updateSettings,
    updateCredentials,
    listMcpServers,
    createMcpServer,
    updateMcpServer,
    deleteMcpServer,
    listUrlTools,
    createUrlTool,
    updateUrlTool,
    deleteUrlTool,
    getNotificationSettings,
    updateNotificationSettings,
  };
}
