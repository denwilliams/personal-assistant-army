import type { AgentMemory } from "../types/models";

/**
 * Repository interface for agent memory operations
 */
export interface MemoryRepository {
  /**
   * Store or update a memory value for an agent
   */
  set(agentId: number, key: string, value: string): Promise<AgentMemory>;

  /**
   * Retrieve a memory value for an agent
   */
  get(agentId: number, key: string): Promise<AgentMemory | null>;

  /**
   * List all memories for an agent
   */
  listByAgent(agentId: number): Promise<AgentMemory[]>;

  /**
   * Delete a specific memory
   */
  delete(agentId: number, key: string): Promise<void>;

  /**
   * Search memories by key pattern
   */
  search(agentId: number, pattern: string): Promise<AgentMemory[]>;
}
