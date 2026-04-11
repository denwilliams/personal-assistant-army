// Database models

export interface User {
  id: number;
  google_id: string;
  email: string;
  name?: string;
  avatar_url?: string;
  openai_api_key?: string; // Encrypted
  anthropic_api_key?: string; // Encrypted
  google_ai_api_key?: string; // Encrypted
  google_search_api_key?: string; // Encrypted
  google_search_engine_id?: string;
  timezone?: string; // IANA timezone format (e.g., 'America/New_York')
  created_at: Date;
  updated_at: Date;
}

export type PoolType = 'personal' | 'team';

export interface Agent {
  id: number;
  user_id: number;
  slug: string;
  name: string;
  purpose?: string;
  system_prompt: string;
  model?: string; // "provider:model-id" e.g. "openai:gpt-4.1-mini"
  internet_search_enabled: boolean;
  is_favorite: boolean;
  pool_type: PoolType;
  domain?: string; // email domain for team agents
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
  type: 'memory' | 'internet_search' | 'mqtt';
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
  raw_data?: any; // Full message object from AI SDK
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
  tier: 'core' | 'working' | 'reference';
  author: 'user' | 'agent';
  access_count: number;
  last_accessed_at: number; // epoch ms
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

export interface WorkflowStep {
  title: string;
  instructions: string;
}

export interface Workflow {
  id: number;
  user_id: number;
  agent_id: number | null;
  name: string;
  summary: string;
  steps: WorkflowStep[];
  scope: 'agent' | 'user';
  author: 'user' | 'agent';
  created_at: Date;
  updated_at: Date;
}

export interface AgentWorkflow {
  id: number;
  agent_id: number;
  workflow_id: number;
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
  next_run_at: number | null; // epoch ms
  last_run_at: number | null; // epoch ms
  created_at: Date;
  updated_at: Date;
}

export interface ScheduleExecution {
  id: number;
  schedule_id: number;
  conversation_id: number | null;
  status: 'running' | 'success' | 'error' | 'retry';
  error_message: string | null;
  started_at: number; // epoch ms
  completed_at: number | null; // epoch ms
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
  channel: 'email' | 'webhook' | 'pushover';
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
  pushover_user_key: string | null;
  pushover_api_token: string | null;
  pushover_enabled: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface MqttBrokerConfig {
  id: number;
  user_id: number;
  host: string;
  port: number;
  username: string | null; // Encrypted
  password: string | null; // Encrypted
  use_tls: boolean;
  client_id: string | null;
  enabled: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface MqttSubscription {
  id: number;
  user_id: number;
  agent_id: number;
  topic: string;
  qos: number;
  prompt_template: string;
  conversation_mode: 'new' | 'continue';
  conversation_id: number | null;
  rate_limit_window_ms: number;
  rate_limit_max_triggers: number;
  enabled: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface MqttMessage {
  id: number;
  user_id: number;
  topic: string;
  payload: string | null;
  qos: number;
  retained: boolean;
  received_at: number; // epoch ms
}

export interface MqttEventExecution {
  id: number;
  subscription_id: number;
  conversation_id: number | null;
  mqtt_message_id: number | null;
  status: 'running' | 'success' | 'error' | 'rate_limited';
  error_message: string | null;
  started_at: number; // epoch ms
  completed_at: number | null; // epoch ms
}

export interface TeamSettings {
  id: number;
  domain: string;
  openai_api_key?: string;
  anthropic_api_key?: string;
  google_ai_api_key?: string;
  google_search_api_key?: string;
  google_search_engine_id?: string;
  timezone: string;
  created_at: string;
  updated_at: string;
}

export interface TeamMcpServer {
  id: number;
  domain: string;
  name: string;
  url: string;
  headers: Record<string, string> | null;
  created_at: string;
}

export interface TeamUrlTool {
  id: number;
  domain: string;
  name: string;
  description?: string;
  url: string;
  method: string;
  headers: Record<string, string> | null;
  created_at: string;
  updated_at: string;
}

export interface TeamNotificationSettings {
  id: number;
  domain: string;
  notification_email?: string;
  webhook_urls: Array<{ name: string; url: string }>;
  email_enabled: boolean;
  pushover_user_key?: string;
  pushover_api_token?: string;
  pushover_enabled: boolean;
  created_at: string;
  updated_at: string;
}
