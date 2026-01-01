import type { Session } from "../auth/types";

export interface SessionRepository {
  create(userId: number, expiresAt: Date): Promise<Session>;
  findById(sessionId: string): Promise<Session | null>;
  delete(sessionId: string): Promise<void>;
  deleteExpired(): Promise<void>;
  deleteByUserId(userId: number): Promise<void>;
}
