import type { McpServer } from "../types/models";

export interface McpServerRepository {
  listByUser(userId: number): Promise<McpServer[]>;
  findById(id: number): Promise<McpServer | null>;
  create(userId: number, name: string, url: string, headers?: Record<string, string>): Promise<McpServer>;
  delete(id: number): Promise<void>;
}
