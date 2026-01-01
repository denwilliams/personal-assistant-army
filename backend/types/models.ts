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
  created_at: Date;
  updated_at: Date;
}

export interface McpServer {
  id: number;
  user_id: number;
  name: string;
  url: string;
  headers?: Record<string, string>; // Custom HTTP headers for MCP requests
  created_at: Date;
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
