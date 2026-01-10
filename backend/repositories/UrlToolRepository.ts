import type { UrlTool } from "../types/models";

export interface CreateUrlToolData {
  user_id: number;
  name: string;
  description?: string;
  url: string;
  method: string;
  headers?: Record<string, string>;
}

export interface UpdateUrlToolData {
  name?: string;
  description?: string;
  url?: string;
  method?: string;
  headers?: Record<string, string> | null;
}

export interface UrlToolRepository {
  listByUser(userId: number): Promise<UrlTool[]>;
  findById(id: number): Promise<UrlTool | null>;
  create(data: CreateUrlToolData): Promise<UrlTool>;
  update(id: number, data: UpdateUrlToolData): Promise<UrlTool>;
  delete(id: number): Promise<void>;
}
