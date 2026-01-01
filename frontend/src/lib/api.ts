/**
 * API client for backend communication
 * Handles authentication and request/response formatting
 */

const API_BASE = "";  // Same origin

interface ApiRequestOptions extends RequestInit {
  body?: any;
}

/**
 * Make an authenticated API request
 */
async function apiRequest<T>(
  endpoint: string,
  options: ApiRequestOptions = {}
): Promise<T> {
  const { body, headers, ...restOptions } = options;

  const config: RequestInit = {
    ...restOptions,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    credentials: "same-origin", // Include cookies
  };

  if (body) {
    config.body = JSON.stringify(body);
  }

  const response = await fetch(`${API_BASE}${endpoint}`, config);

  // Handle non-JSON responses
  const contentType = response.headers.get("content-type");
  const isJson = contentType?.includes("application/json");

  if (!response.ok) {
    const error = isJson ? await response.json() : { error: response.statusText };
    throw new Error(error.error || "Request failed");
  }

  return isJson ? await response.json() : ({} as T);
}

/**
 * API client methods
 */
export const api = {
  // Health check
  health: () => apiRequest<{ status: string; database?: string }>("/api/health"),

  // Authentication
  auth: {
    login: () => {
      window.location.href = "/api/auth/login";
    },
    logout: () => apiRequest("/api/auth/logout", { method: "POST" }),
  },

  // User profile
  user: {
    getProfile: () =>
      apiRequest<{
        id: number;
        email: string;
        name: string;
        avatar_url?: string;
        has_openai_key: boolean;
        has_google_search_key: boolean;
        google_search_engine_id?: string;
      }>("/api/user/profile"),

    updateProfile: (data: { name?: string; avatar_url?: string }) =>
      apiRequest("/api/user/profile", {
        method: "PUT",
        body: data,
      }),

    updateCredentials: (data: {
      openai_api_key?: string;
      google_search_api_key?: string;
      google_search_engine_id?: string;
    }) =>
      apiRequest("/api/user/credentials", {
        method: "PUT",
        body: data,
      }),
  },

  // MCP Servers
  mcpServers: {
    list: () =>
      apiRequest<
        Array<{
          id: number;
          user_id: number;
          name: string;
          url: string;
          created_at: string;
        }>
      >("/api/user/mcp-servers"),

    create: (data: { name: string; url: string }) =>
      apiRequest("/api/user/mcp-servers", {
        method: "POST",
        body: data,
      }),

    delete: (id: number) =>
      apiRequest(`/api/user/mcp-servers/${id}`, {
        method: "DELETE",
      }),
  },

  // Agents
  agents: {
    list: () =>
      apiRequest<
        Array<{
          id: number;
          user_id: number;
          slug: string;
          name: string;
          purpose?: string;
          system_prompt: string;
          internet_search_enabled: boolean;
          created_at: string;
          updated_at: string;
        }>
      >("/api/agents"),

    get: (slug: string) =>
      apiRequest<{
        id: number;
        user_id: number;
        slug: string;
        name: string;
        purpose?: string;
        system_prompt: string;
        internet_search_enabled: boolean;
        created_at: string;
        updated_at: string;
      }>(`/api/agents/${slug}`),

    create: (data: {
      slug: string;
      name: string;
      purpose?: string;
      system_prompt: string;
      internet_search_enabled?: boolean;
    }) =>
      apiRequest("/api/agents", {
        method: "POST",
        body: data,
      }),

    update: (
      slug: string,
      data: {
        name?: string;
        purpose?: string;
        system_prompt?: string;
        internet_search_enabled?: boolean;
      }
    ) =>
      apiRequest(`/api/agents/${slug}`, {
        method: "PUT",
        body: data,
      }),

    delete: (slug: string) =>
      apiRequest(`/api/agents/${slug}`, {
        method: "DELETE",
      }),

    // Tools
    getTools: (slug: string) =>
      apiRequest<{
        built_in_tools: string[];
        mcp_tools: number[];
      }>(`/api/agents/${slug}/tools`),

    addBuiltInTool: (slug: string, toolId: string) =>
      apiRequest(`/api/agents/${slug}/tools/built-in`, {
        method: "POST",
        body: { tool_id: toolId },
      }),

    removeBuiltInTool: (slug: string, toolId: string) =>
      apiRequest(`/api/agents/${slug}/tools/built-in/${toolId}`, {
        method: "DELETE",
      }),

    addMcpTool: (slug: string, mcpServerId: number) =>
      apiRequest(`/api/agents/${slug}/tools/mcp`, {
        method: "POST",
        body: { mcp_server_id: mcpServerId },
      }),

    removeMcpTool: (slug: string, mcpServerId: number) =>
      apiRequest(`/api/agents/${slug}/tools/mcp/${mcpServerId}`, {
        method: "DELETE",
      }),

    // Handoffs
    getHandoffs: (slug: string) =>
      apiRequest<{
        handoff_agent_ids: number[];
      }>(`/api/agents/${slug}/handoffs`),

    addHandoff: (slug: string, toAgentSlug: string) =>
      apiRequest(`/api/agents/${slug}/handoffs`, {
        method: "POST",
        body: { to_agent_slug: toAgentSlug },
      }),

    removeHandoff: (slug: string, toAgentSlug: string) =>
      apiRequest(`/api/agents/${slug}/handoffs/${toAgentSlug}`, {
        method: "DELETE",
      }),
  },
};
