import { sql } from "bun";
import type { AgentMemory } from "../../types/models";
import type { MemoryRepository, SetMemoryData } from "../MemoryRepository";

export class PostgresMemoryRepository implements MemoryRepository {
  async set(agentId: number, data: SetMemoryData): Promise<AgentMemory> {
    const now = Date.now();
    const tier = data.tier || "working";
    const author = data.author || "agent";

    const result = await sql`
      INSERT INTO agent_memories (agent_id, key, value, tier, author, access_count, last_accessed_at)
      VALUES (${agentId}, ${data.key}, ${data.value}, ${tier}, ${author}, 1, ${now})
      ON CONFLICT (agent_id, key)
      DO UPDATE SET
        value = ${data.value},
        tier = COALESCE(${data.tier}::varchar, agent_memories.tier),
        access_count = agent_memories.access_count + 1,
        last_accessed_at = ${now},
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `;
    return result[0];
  }

  async get(agentId: number, key: string): Promise<AgentMemory | null> {
    const result = await sql`
      SELECT * FROM agent_memories
      WHERE agent_id = ${agentId} AND key = ${key}
    `;
    return result[0] || null;
  }

  async delete(agentId: number, key: string): Promise<void> {
    await sql`
      DELETE FROM agent_memories
      WHERE agent_id = ${agentId} AND key = ${key}
    `;
  }

  async listByTier(agentId: number, tier: 'core' | 'working' | 'reference'): Promise<AgentMemory[]> {
    return await sql`
      SELECT * FROM agent_memories
      WHERE agent_id = ${agentId} AND tier = ${tier}
      ORDER BY last_accessed_at DESC
    `;
  }

  async listByAgent(agentId: number): Promise<AgentMemory[]> {
    return await sql`
      SELECT * FROM agent_memories
      WHERE agent_id = ${agentId}
      ORDER BY
        CASE tier WHEN 'core' THEN 0 WHEN 'working' THEN 1 WHEN 'reference' THEN 2 END,
        last_accessed_at DESC
    `;
  }

  async countByTier(agentId: number, tier: 'core' | 'working' | 'reference'): Promise<number> {
    const result = await sql`
      SELECT COUNT(*)::int as count FROM agent_memories
      WHERE agent_id = ${agentId} AND tier = ${tier}
    `;
    return result[0].count;
  }

  async changeTier(agentId: number, key: string, newTier: 'core' | 'working' | 'reference'): Promise<AgentMemory> {
    const now = Date.now();
    const result = await sql`
      UPDATE agent_memories
      SET tier = ${newTier}, last_accessed_at = ${now}, updated_at = CURRENT_TIMESTAMP
      WHERE agent_id = ${agentId} AND key = ${key}
      RETURNING *
    `;
    if (!result[0]) throw new Error(`Memory not found: ${key}`);
    return result[0];
  }

  async demoteLRU(agentId: number, _fromTier: 'working', count: number = 1): Promise<AgentMemory[]> {
    return await sql`
      UPDATE agent_memories SET tier = 'reference', updated_at = CURRENT_TIMESTAMP
      WHERE id IN (
        SELECT id FROM agent_memories
        WHERE agent_id = ${agentId} AND tier = 'working'
        ORDER BY last_accessed_at ASC
        LIMIT ${count}
      )
      RETURNING *
    `;
  }

  async bumpAccess(agentId: number, keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    const now = Date.now();
    await sql`
      UPDATE agent_memories SET last_accessed_at = ${now}
      WHERE agent_id = ${agentId} AND key = ANY(${sql.array(keys, "text")})
    `;
  }

  async bumpActiveAccess(agentId: number, keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    const now = Date.now();
    await sql`
      UPDATE agent_memories SET access_count = access_count + 1, last_accessed_at = ${now}
      WHERE agent_id = ${agentId} AND key = ANY(${sql.array(keys, "text")})
    `;
  }

  async search(agentId: number, pattern: string): Promise<AgentMemory[]> {
    const likePattern = `%${pattern}%`;
    return await sql`
      SELECT * FROM agent_memories
      WHERE agent_id = ${agentId} AND (key ILIKE ${likePattern} OR value ILIKE ${likePattern})
      ORDER BY last_accessed_at DESC
      LIMIT 10
    `;
  }

  async semanticSearch(agentId: number, embedding: number[], limit: number = 5): Promise<(AgentMemory & { similarity: number })[]> {
    const vectorStr = `[${embedding.join(",")}]`;
    return await sql`
      SELECT *,
        1 - (embedding <=> ${vectorStr}::vector) AS similarity
      FROM agent_memories
      WHERE agent_id = ${agentId} AND embedding IS NOT NULL
      ORDER BY embedding <=> ${vectorStr}::vector ASC
      LIMIT ${limit}
    `;
  }

  async setEmbedding(agentId: number, key: string, embedding: number[]): Promise<void> {
    const vectorStr = `[${embedding.join(",")}]`;
    await sql`
      UPDATE agent_memories SET embedding = ${vectorStr}::vector
      WHERE agent_id = ${agentId} AND key = ${key}
    `;
  }
}
