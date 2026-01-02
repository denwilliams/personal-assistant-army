import type { McpServer } from "../types/models";

export interface UpdateMcpServerData {
  name?: string;
  url?: string;
  headers?: Record<string, string> | null;
}

export interface McpServerRepository {
  listByUser(userId: number): Promise<McpServer[]>;
  findById(id: number): Promise<McpServer | null>;
  create(userId: number, name: string, url: string, headers?: Record<string, string>): Promise<McpServer>;
  update(id: number, data: UpdateMcpServerData): Promise<McpServer>;
  delete(id: number): Promise<void>;
}
