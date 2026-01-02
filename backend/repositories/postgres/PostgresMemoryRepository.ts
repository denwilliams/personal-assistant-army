import { sql } from "bun";
import type { AgentMemory } from "../../types/models";
import type { MemoryRepository } from "../MemoryRepository";

export class PostgresMemoryRepository implements MemoryRepository {
  async set(agentId: number, key: string, value: string): Promise<AgentMemory> {
    const result = await sql`
      INSERT INTO agent_memories (agent_id, key, value)
      VALUES (${agentId}, ${key}, ${value})
      ON CONFLICT (agent_id, key)
      DO UPDATE SET value = ${value}, updated_at = CURRENT_TIMESTAMP
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

  async listByAgent(agentId: number): Promise<AgentMemory[]> {
    const result = await sql`
      SELECT * FROM agent_memories
      WHERE agent_id = ${agentId}
      ORDER BY key ASC
    `;
    return result;
  }

  async delete(agentId: number, key: string): Promise<void> {
    await sql`
      DELETE FROM agent_memories
      WHERE agent_id = ${agentId} AND key = ${key}
    `;
  }

  async search(agentId: number, pattern: string): Promise<AgentMemory[]> {
    const result = await sql`
      SELECT * FROM agent_memories
      WHERE agent_id = ${agentId} AND key LIKE ${pattern}
      ORDER BY key ASC
    `;
    return result;
  }
}
