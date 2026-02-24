// Database models

export interface User {
  id: number;
  google_id: string;
  email: string;
  name?: string;
  avatar_url?: string;
  openai_api_key?: string; // Encrypted
  google_search_api_key?: string; // Encrypted
  google_search_engine_id?: string;
  timezone?: string; // IANA timezone format (e.g., 'America/New_York')
  created_at: Date;
  updated_at: Date;
}

export interface Agent {
  id: number;
  user_id: number;
  slug: string;
  name: string;
  purpose?: string;
  system_prompt: string;
  internet_search_enabled: boolean;
  is_favorite: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface McpServer {
  id: number;
  user_id: number;
  name: string;
  url: string;
  headers: Record<string, string> | null; // Custom HTTP headers for MCP requests
  created_at: Date;
}

export interface UrlTool {
  id: number;
  user_id: number;
  name: string;
  description?: string;
  url: string;
  method: string; // GET, POST, PUT, DELETE, PATCH
  headers: Record<string, string> | null; // Custom HTTP headers
  created_at: Date;
  updated_at: Date;
}

export interface BuiltInTool {
  id: number;
  name: string;
  description?: string;
  type: 'memory' | 'internet_search';
}

export interface Conversation {
  id: number;
  user_id: number;
  agent_id: number;
  created_at: Date;
  updated_at: Date;
}

export interface Message {
  id: number;
  conversation_id: number;
  role: 'user' | 'assistant' | 'system';
  content: string;
  raw_data?: any; // Full message object from OpenAI Agents SDK
  agent_id?: number;
  created_at: Date;
}

export interface Session {
  id: string;
  user_id: number;
  expires_at: Date;
  created_at: Date;
}

export interface AgentMemory {
  id: number;
  agent_id: number;
  key: string;
  value: string;
  created_at: Date;
  updated_at: Date;
}

export interface Skill {
  id: number;
  user_id: number;
  agent_id: number | null;
  name: string;
  summary: string;
  content: string;
  scope: 'agent' | 'user';
  author: 'user' | 'agent';
  created_at: Date;
  updated_at: Date;
}

export interface AgentSkill {
  id: number;
  agent_id: number;
  skill_id: number;
  enabled: boolean;
  created_at: Date;
}

export interface Schedule {
  id: number;
  user_id: number;
  agent_id: number;
  prompt: string;
  description: string | null;
  schedule_type: 'once' | 'interval' | 'cron';
  schedule_value: string;
  timezone: string;
  conversation_mode: 'new' | 'continue';
  conversation_id: number | null;
  author: 'user' | 'agent';
  enabled: boolean;
  next_run_at: Date | null;
  last_run_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface ScheduleExecution {
  id: number;
  schedule_id: number;
  conversation_id: number | null;
  status: 'running' | 'success' | 'error' | 'retry';
  error_message: string | null;
  started_at: Date;
  completed_at: Date | null;
  retry_count: number;
}

export interface Notification {
  id: number;
  user_id: number;
  agent_id: number;
  conversation_id: number | null;
  message: string;
  urgency: 'low' | 'normal' | 'high';
  read: boolean;
  created_at: Date;
}

export interface NotificationDelivery {
  id: number;
  notification_id: number;
  channel: 'email' | 'webhook';
  status: 'pending' | 'sent' | 'failed';
  error_message: string | null;
  attempts: number;
  created_at: Date;
  delivered_at: Date | null;
}

export interface WebhookConfig {
  url: string;
  name: string;
}

export interface UserNotificationSettings {
  id: number;
  user_id: number;
  notification_email: string | null;
  webhook_urls: WebhookConfig[];
  email_enabled: boolean;
  created_at: Date;
  updated_at: Date;
}
