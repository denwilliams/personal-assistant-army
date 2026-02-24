import type { AgentMemory } from "../types/models";

export interface SetMemoryData {
  key: string;
  value: string;
  tier?: 'core' | 'working' | 'reference';
  author?: 'user' | 'agent';
}

export interface MemoryRepository {
  // Core CRUD
  set(agentId: number, data: SetMemoryData): Promise<AgentMemory>;
  get(agentId: number, key: string): Promise<AgentMemory | null>;
  delete(agentId: number, key: string): Promise<void>;

  // Tier-aware listing
  listByTier(agentId: number, tier: 'core' | 'working' | 'reference'): Promise<AgentMemory[]>;
  listByAgent(agentId: number): Promise<AgentMemory[]>;
  countByTier(agentId: number, tier: 'core' | 'working' | 'reference'): Promise<number>;

  // Tier management
  changeTier(agentId: number, key: string, newTier: 'core' | 'working' | 'reference'): Promise<AgentMemory>;
  demoteLRU(agentId: number, fromTier: 'working', count?: number): Promise<AgentMemory[]>;

  // Access tracking
  bumpAccess(agentId: number, keys: string[]): Promise<void>;
  bumpActiveAccess(agentId: number, keys: string[]): Promise<void>;

  // Search
  search(agentId: number, pattern: string): Promise<AgentMemory[]>;
  semanticSearch(agentId: number, embedding: number[], limit?: number): Promise<(AgentMemory & { similarity: number })[]>;

  // Embedding management
  setEmbedding(agentId: number, key: string, embedding: number[]): Promise<void>;
}
