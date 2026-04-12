/**
 * API client for backend communication
 * Handles authentication and request/response formatting
 */

const API_BASE = "";  // Same origin

// Memory types
export interface AgentMemory {
  id: number;
  agent_id: number;
  key: string;
  value: string;
  tier: "core" | "working" | "reference";
  author: "user" | "agent";
  access_count: number;
  last_accessed_at: number;
  created_at: string;
  updated_at: string;
}

export interface MemoryCounts {
  core: number;
  working: number;
  reference: number;
}

// Skills types
export interface Skill {
  id: number;
  user_id: number;
  agent_id: number | null;
  name: string;
  summary: string;
  content: string;
  scope: "agent" | "user";
  author: "user" | "agent";
  universal: boolean;
  created_at: string;
  updated_at: string;
}

// Schedules types
export type NotifierChannel = "email" | "webhook" | "pushover";

export interface Schedule {
  id: number;
  user_id: number;
  agent_id: number;
  agent_name?: string;
  agent_slug?: string;
  prompt: string;
  description: string | null;
  schedule_type: "once" | "interval" | "cron";
  schedule_value: string;
  timezone: string;
  conversation_mode: "new" | "continue";
  conversation_id: number | null;
  author: "user" | "agent";
  notifier: NotifierChannel | null;
  notifier_destination: string | null;
  enabled: boolean;
  next_run_at: number | null;
  last_run_at: number | null;
  created_at: string;
  updated_at: string;
}

export interface ScheduleExecution {
  id: number;
  schedule_id: number;
  conversation_id: number | null;
  status: "running" | "success" | "error" | "retry";
  error_message: string | null;
  started_at: number;
  completed_at: number | null;
  retry_count: number;
}

// Notifications types
export interface AppNotification {
  id: number;
  user_id: number;
  agent_id: number;
  agent_name?: string;
  conversation_id: number | null;
  message: string;
  urgency: "low" | "normal" | "high";
  read: boolean;
  created_at: string;
}

export interface WebhookConfig {
  url: string;
  name: string;
}

export interface EmailConfig {
  name: string;
  email: string;
}

export interface NotificationSettings {
  id: number;
  user_id: number;
  notification_email: string | null;
  email_addresses: EmailConfig[];
  webhook_urls: WebhookConfig[];
  email_enabled: boolean;
  pushover_user_key: string | null;
  pushover_api_token: string | null;
  pushover_enabled: boolean;
  created_at: string;
  updated_at: string;
}

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
    demoLogin: () => {
      window.location.href = "/api/auth/demo-login";
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
        has_anthropic_key: boolean;
        has_google_ai_key: boolean;
        has_google_search_key: boolean;
        google_search_engine_id?: string;
        timezone?: string;
      }>("/api/user/profile"),

    updateProfile: (data: { name?: string; avatar_url?: string; timezone?: string }) =>
      apiRequest("/api/user/profile", {
        method: "PUT",
        body: data,
      }),

    updateCredentials: (data: {
      openai_api_key?: string;
      anthropic_api_key?: string;
      google_ai_api_key?: string;
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
          headers?: Record<string, string>;
          created_at: string;
        }>
      >("/api/user/mcp-servers"),

    create: (data: { name: string; url: string; headers?: Record<string, string> }) =>
      apiRequest("/api/user/mcp-servers", {
        method: "POST",
        body: data,
      }),

    update: (id: number, data: { name?: string; url?: string; headers?: Record<string, string> }) =>
      apiRequest(`/api/user/mcp-servers/${id}`, {
        method: "PUT",
        body: data,
      }),

    delete: (id: number) =>
      apiRequest(`/api/user/mcp-servers/${id}`, {
        method: "DELETE",
      }),
  },

  // URL Tools
  urlTools: {
    list: () =>
      apiRequest<
        Array<{
          id: number;
          user_id: number;
          name: string;
          description?: string;
          url: string;
          method: string;
          headers?: Record<string, string>;
          created_at: string;
          updated_at: string;
        }>
      >("/api/user/url-tools"),

    create: (data: { name: string; description?: string; url: string; method: string; headers?: Record<string, string> }) =>
      apiRequest("/api/user/url-tools", {
        method: "POST",
        body: data,
      }),

    update: (id: number, data: { name?: string; description?: string; url?: string; method?: string; headers?: Record<string, string> }) =>
      apiRequest(`/api/user/url-tools/${id}`, {
        method: "PUT",
        body: data,
      }),

    delete: (id: number) =>
      apiRequest(`/api/user/url-tools/${id}`, {
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
          model?: string;
          internet_search_enabled: boolean;
          is_favorite: boolean;
          pool_type: "personal" | "team";
          domain?: string;
          default_notifier?: "email" | "webhook" | "pushover" | null;
          default_notifier_destination?: string | null;
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
        model?: string;
        internet_search_enabled: boolean;
        pool_type: "personal" | "team";
        domain?: string;
        default_notifier?: "email" | "webhook" | "pushover" | null;
        default_notifier_destination?: string | null;
        created_at: string;
        updated_at: string;
      }>(`/api/agents/${slug}`),

    create: (data: {
      slug: string;
      name: string;
      purpose?: string;
      system_prompt: string;
      model?: string;
      internet_search_enabled?: boolean;
      pool_type?: "personal" | "team";
      default_notifier?: "email" | "webhook" | "pushover" | null;
      default_notifier_destination?: string | null;
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
        model?: string;
        internet_search_enabled?: boolean;
        default_notifier?: "email" | "webhook" | "pushover" | null;
        default_notifier_destination?: string | null;
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

    setFavorite: (slug: string, isFavorite: boolean) =>
      apiRequest(`/api/agents/${slug}/favorite`, {
        method: "PATCH",
        body: { is_favorite: isFavorite },
      }),

    // Tools
    getTools: (slug: string) =>
      apiRequest<{
        built_in_tools: string[];
        mcp_tools: number[];
        url_tools: number[];
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

    addUrlTool: (slug: string, urlToolId: number) =>
      apiRequest(`/api/agents/${slug}/tools/url`, {
        method: "POST",
        body: { url_tool_id: urlToolId },
      }),

    removeUrlTool: (slug: string, urlToolId: number) =>
      apiRequest(`/api/agents/${slug}/tools/url/${urlToolId}`, {
        method: "DELETE",
      }),

    // Agent Tools
    getAgentTools: (slug: string) =>
      apiRequest<{
        agent_tool_ids: number[];
      }>(`/api/agents/${slug}/agent-tools`),

    addAgentTool: (slug: string, toolAgentSlug: string) =>
      apiRequest(`/api/agents/${slug}/agent-tools`, {
        method: "POST",
        body: { tool_agent_slug: toolAgentSlug },
      }),

    removeAgentTool: (slug: string, toolAgentSlug: string) =>
      apiRequest(`/api/agents/${slug}/agent-tools/${toolAgentSlug}`, {
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

    // Memories
    getMemories: (slug: string) =>
      apiRequest<{ memories: AgentMemory[]; counts: MemoryCounts }>(
        `/api/agents/${slug}/memories`
      ),

    createMemory: (slug: string, data: { key: string; value: string; tier?: string }) =>
      apiRequest<{ memory: AgentMemory }>(`/api/agents/${slug}/memories`, {
        method: "POST",
        body: data,
      }),

    updateMemory: (slug: string, key: string, data: { value?: string; tier?: string }) =>
      apiRequest<{ memory: AgentMemory }>(
        `/api/agents/${slug}/memories/${encodeURIComponent(key)}`,
        { method: "PUT", body: data }
      ),

    deleteMemory: (slug: string, key: string) =>
      apiRequest(`/api/agents/${slug}/memories/${encodeURIComponent(key)}`, {
        method: "DELETE",
      }),

    changeMemoryTier: (slug: string, key: string, tier: string) =>
      apiRequest<{ memory: AgentMemory }>(
        `/api/agents/${slug}/memories/${encodeURIComponent(key)}/tier`,
        { method: "PATCH", body: { tier } }
      ),
  },

  // Chat
  chat: {
    sendMessage: (
      slug: string,
      message: string,
      conversationId?: number
    ) =>
      apiRequest<{
        conversation_id: number;
        message: string;
      }>(`/api/chat/${slug}`, {
        method: "POST",
        body: { message, conversation_id: conversationId },
      }),

    /**
     * Send a message with streaming response using Server-Sent Events
     */
    sendMessageStream: async (
      slug: string,
      message: string,
      conversationId: number | undefined,
      onChunk: (chunk: { type: string; content?: string; conversation_id?: number }) => void
    ): Promise<void> => {
      const response = await fetch(`/api/chat/${slug}/stream`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "same-origin",
        body: JSON.stringify({ message, conversation_id: conversationId }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Stream failed");
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        throw new Error("No response body");
      }

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = JSON.parse(line.slice(6));
            onChunk(data);
          }
        }
      }
    },

    getHistory: (slug: string) =>
      apiRequest<
        Array<{
          id: number;
          user_id: number;
          agent_id: number;
          title?: string;
          created_at: string;
          updated_at: string;
        }>
      >(`/api/chat/${slug}/history`),

    getConversation: (slug: string, id: number) =>
      apiRequest<{
        conversation: {
          id: number;
          user_id: number;
          agent_id: number;
          title?: string;
          created_at: string;
          updated_at: string;
        };
        messages: Array<{
          id: number;
          conversation_id: number;
          role: "user" | "assistant" | "system";
          content: string;
          agent_id?: number;
          created_at: string;
        }>;
      }>(`/api/chat/${slug}/conversation/${id}`),
  },

  // Skills
  skills: {
    list: () =>
      apiRequest<{ skills: Skill[] }>("/api/skills").then((r) => r.skills),

    create: (data: { name: string; summary: string; content: string; universal?: boolean }) =>
      apiRequest<{ skill: Skill }>("/api/skills", {
        method: "POST",
        body: data,
      }),

    update: (id: number, data: { summary?: string; content?: string; universal?: boolean }) =>
      apiRequest<{ skill: Skill }>(`/api/skills/${id}`, {
        method: "PUT",
        body: data,
      }),

    delete: (id: number) =>
      apiRequest(`/api/skills/${id}`, { method: "DELETE" }),

    promote: (id: number) =>
      apiRequest<{ skill: Skill }>(`/api/skills/${id}/promote`, {
        method: "PATCH",
      }),

    listForAgent: (slug: string) =>
      apiRequest<{ skills: Skill[] }>(`/api/agents/${slug}/skills`).then((r) => r.skills),

    createForAgent: (slug: string, data: { name: string; summary: string; content: string }) =>
      apiRequest<{ skill: Skill }>(`/api/agents/${slug}/skills`, {
        method: "POST",
        body: data,
      }),

    toggleForAgent: (slug: string, skillId: number, enabled: boolean) =>
      apiRequest(`/api/agents/${slug}/skills/${skillId}/toggle`, {
        method: "PATCH",
        body: { enabled },
      }),
  },

  // Schedules
  schedules: {
    list: () =>
      apiRequest<{ schedules: Schedule[] }>("/api/schedules").then((r) => r.schedules),

    listForAgent: (slug: string) =>
      apiRequest<{ schedules: Schedule[] }>(`/api/agents/${slug}/schedules`).then((r) => r.schedules),

    create: (slug: string, data: {
      prompt: string;
      description?: string;
      schedule_type: "once" | "interval" | "cron";
      schedule_value: string;
      conversation_mode?: "new" | "continue";
      conversation_id?: number;
      notifier?: NotifierChannel | null;
      notifier_destination?: string | null;
    }) =>
      apiRequest<{ schedule: Schedule }>(`/api/agents/${slug}/schedules`, {
        method: "POST",
        body: data,
      }),

    update: (id: number, data: {
      prompt?: string;
      description?: string;
      schedule_type?: "once" | "interval" | "cron";
      schedule_value?: string;
      notifier?: NotifierChannel | null;
      notifier_destination?: string | null;
    }) =>
      apiRequest<{ schedule: Schedule }>(`/api/schedules/${id}`, {
        method: "PUT",
        body: data,
      }),

    delete: (id: number) =>
      apiRequest(`/api/schedules/${id}`, { method: "DELETE" }),

    toggle: (id: number, enabled: boolean) =>
      apiRequest<{ schedule: Schedule }>(`/api/schedules/${id}/toggle`, {
        method: "PATCH",
        body: { enabled },
      }),

    getExecutions: (id: number) =>
      apiRequest<{ executions: ScheduleExecution[] }>(`/api/schedules/${id}/executions`).then((r) => r.executions),

    trigger: (id: number) =>
      apiRequest(`/api/schedules/${id}/trigger`, { method: "POST" }),
  },

  // Notifications
  notifications: {
    list: (params?: { unread?: boolean; limit?: number; offset?: number }) => {
      const searchParams = new URLSearchParams();
      if (params?.unread) searchParams.set("unread", "true");
      if (params?.limit) searchParams.set("limit", String(params.limit));
      if (params?.offset) searchParams.set("offset", String(params.offset));
      const qs = searchParams.toString();
      return apiRequest<{ notifications: AppNotification[] }>(
        `/api/notifications${qs ? `?${qs}` : ""}`
      );
    },

    getUnreadCount: () =>
      apiRequest<{ count: number }>("/api/notifications/unread-count"),

    markRead: (id: number) =>
      apiRequest(`/api/notifications/${id}/read`, { method: "PATCH" }),

    markAllRead: () =>
      apiRequest("/api/notifications/read-all", { method: "POST" }),

    getSettings: () =>
      apiRequest<{ settings: NotificationSettings }>("/api/user/notification-settings").then((r) => r.settings),

    updateSettings: (data: {
      notification_email?: string;
      email_addresses?: EmailConfig[];
      webhook_urls?: WebhookConfig[];
      email_enabled?: boolean;
      pushover_user_key?: string;
      pushover_api_token?: string;
      pushover_enabled?: boolean;
    }) =>
      apiRequest<{ settings: NotificationSettings }>("/api/user/notification-settings", {
        method: "PUT",
        body: data,
      }),

    muteAgent: (slug: string, channels?: string[]) =>
      apiRequest(`/api/agents/${slug}/notifications/mute`, {
        method: "POST",
        body: { channels },
      }),

    unmuteAgent: (slug: string) =>
      apiRequest(`/api/agents/${slug}/notifications/mute`, {
        method: "DELETE",
      }),
  },

  // Team settings
  team: {
    getSettings: () =>
      apiRequest<{
        domain: string;
        timezone: string;
        has_openai_key: boolean;
        has_anthropic_key: boolean;
        has_google_ai_key: boolean;
        has_google_search_key: boolean;
        google_search_engine_id: string | null;
        created_at: string | null;
        updated_at: string | null;
      }>("/api/team/settings"),

    updateSettings: (data: { timezone?: string }) =>
      apiRequest("/api/team/settings", { method: "PUT", body: data }),

    updateCredentials: (data: {
      openai_api_key?: string;
      anthropic_api_key?: string;
      google_ai_api_key?: string;
      google_search_api_key?: string;
      google_search_engine_id?: string;
    }) =>
      apiRequest("/api/team/credentials", { method: "PUT", body: data }),

    listMcpServers: () =>
      apiRequest<Array<{
        id: number;
        domain: string;
        name: string;
        url: string;
        headers?: Record<string, string>;
        created_at: string;
      }>>("/api/team/mcp-servers"),

    createMcpServer: (data: { name: string; url: string; headers?: Record<string, string> }) =>
      apiRequest("/api/team/mcp-servers", { method: "POST", body: data }),

    updateMcpServer: (id: number, data: { name?: string; url?: string; headers?: Record<string, string> }) =>
      apiRequest(`/api/team/mcp-servers/${id}`, { method: "PUT", body: data }),

    deleteMcpServer: (id: number) =>
      apiRequest(`/api/team/mcp-servers/${id}`, { method: "DELETE" }),

    listUrlTools: () =>
      apiRequest<Array<{
        id: number;
        domain: string;
        name: string;
        description?: string;
        url: string;
        method: string;
        headers?: Record<string, string>;
        created_at: string;
        updated_at: string;
      }>>("/api/team/url-tools"),

    createUrlTool: (data: { name: string; description?: string; url: string; method: string; headers?: Record<string, string> }) =>
      apiRequest("/api/team/url-tools", { method: "POST", body: data }),

    updateUrlTool: (id: number, data: { name?: string; description?: string; url?: string; method?: string; headers?: Record<string, string> }) =>
      apiRequest(`/api/team/url-tools/${id}`, { method: "PUT", body: data }),

    deleteUrlTool: (id: number) =>
      apiRequest(`/api/team/url-tools/${id}`, { method: "DELETE" }),

    getNotificationSettings: () =>
      apiRequest<{ settings: NotificationSettings }>("/api/team/notification-settings").then((r) => r.settings),

    updateNotificationSettings: (data: {
      notification_email?: string;
      email_addresses?: EmailConfig[];
      webhook_urls?: WebhookConfig[];
      email_enabled?: boolean;
      pushover_user_key?: string;
      pushover_api_token?: string;
      pushover_enabled?: boolean;
    }) =>
      apiRequest<{ settings: NotificationSettings }>("/api/team/notification-settings", {
        method: "PUT",
        body: data,
      }),
  },

  // MQTT
  mqtt: {
    getBrokerConfig: () =>
      apiRequest<{
        config: {
          id: number;
          host: string;
          port: number;
          has_username: boolean;
          has_password: boolean;
          use_tls: boolean;
          client_id: string | null;
          enabled: boolean;
          created_at: string;
          updated_at: string;
        } | null;
      }>("/api/user/mqtt/broker"),

    upsertBrokerConfig: (data: {
      host: string;
      port?: number;
      username?: string;
      password?: string;
      use_tls?: boolean;
      client_id?: string;
      enabled?: boolean;
    }) =>
      apiRequest<{
        config: {
          id: number;
          host: string;
          port: number;
          has_username: boolean;
          has_password: boolean;
          use_tls: boolean;
          client_id: string | null;
          enabled: boolean;
        };
      }>("/api/user/mqtt/broker", {
        method: "PUT",
        body: data,
      }),

    deleteBrokerConfig: () =>
      apiRequest("/api/user/mqtt/broker", { method: "DELETE" }),

    getStatus: () =>
      apiRequest<{ connected: boolean; error?: string }>("/api/user/mqtt/status"),

    reconnect: () =>
      apiRequest("/api/user/mqtt/reconnect", { method: "POST" }),
  },
};
