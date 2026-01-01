import type { User } from "../types/models";

export interface UserRepository {
  findById(id: number): Promise<User | null>;
  findByGoogleId(googleId: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  create(data: {
    google_id: string;
    email: string;
    name?: string;
    avatar_url?: string;
  }): Promise<User>;
  update(id: number, data: Partial<Omit<User, 'id' | 'created_at'>>): Promise<User>;
  updateApiKeys(userId: number, data: {
    openai_api_key?: string;
    google_search_api_key?: string;
    google_search_engine_id?: string;
  }): Promise<void>;
}
