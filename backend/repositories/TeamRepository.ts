import type { TeamSettings, TeamMcpServer, TeamUrlTool, TeamNotificationSettings } from "../types/models";

export interface TeamRepository {
  // Settings (API keys + timezone)
  getSettings(domain: string): Promise<TeamSettings | null>;
  upsertSettings(domain: string, data: {
    openai_api_key?: string;
    anthropic_api_key?: string;
    google_ai_api_key?: string;
    google_search_api_key?: string;
    google_search_engine_id?: string;
    google_service_account_key?: string;
    openwebui_url?: string;
    openwebui_api_key?: string;
    timezone?: string;
  }): Promise<TeamSettings>;

  // MCP servers
  listMcpServers(domain: string): Promise<TeamMcpServer[]>;
  findMcpServerById(id: number): Promise<TeamMcpServer | null>;
  createMcpServer(domain: string, name: string, url: string, headers?: Record<string, string>): Promise<TeamMcpServer>;
  updateMcpServer(id: number, data: { name?: string; url?: string; headers?: Record<string, string> | null }): Promise<TeamMcpServer>;
  deleteMcpServer(id: number): Promise<void>;

  // URL tools
  listUrlTools(domain: string): Promise<TeamUrlTool[]>;
  findUrlToolById(id: number): Promise<TeamUrlTool | null>;
  createUrlTool(domain: string, data: { name: string; description?: string; url: string; method: string; headers?: Record<string, string> }): Promise<TeamUrlTool>;
  updateUrlTool(id: number, data: { name?: string; description?: string; url?: string; method?: string; headers?: Record<string, string> | null }): Promise<TeamUrlTool>;
  deleteUrlTool(id: number): Promise<void>;

  // Notification settings
  getNotificationSettings(domain: string): Promise<TeamNotificationSettings | null>;
  upsertNotificationSettings(domain: string, data: Partial<Pick<TeamNotificationSettings, 'notification_email' | 'email_addresses' | 'webhook_urls' | 'email_enabled' | 'pushover_user_key' | 'pushover_api_token' | 'pushover_enabled'>>): Promise<TeamNotificationSettings>;
}
