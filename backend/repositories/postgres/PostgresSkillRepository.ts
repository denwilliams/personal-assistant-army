import { sql } from "bun";
import type { Skill } from "../../types/models";
import type { SkillRepository, CreateSkillData, UpdateSkillData } from "../SkillRepository";

export class PostgresSkillRepository implements SkillRepository {
  async create(data: CreateSkillData): Promise<Skill> {
    const result = await sql`
      INSERT INTO skills (user_id, agent_id, name, summary, content, scope, author)
      VALUES (${data.user_id}, ${data.agent_id}, ${data.name}, ${data.summary}, ${data.content}, ${data.scope}, ${data.author})
      RETURNING *
    `;
    return result[0];
  }

  async update(id: number, data: UpdateSkillData): Promise<Skill> {
    // Build dynamic update - only set fields that are provided
    const sets: string[] = [];
    const values: any[] = [];

    if (data.summary !== undefined) {
      sets.push("summary");
      values.push(data.summary);
    }
    if (data.content !== undefined) {
      sets.push("content");
      values.push(data.content);
    }

    if (sets.length === 0) {
      const existing = await this.findById(id);
      if (!existing) throw new Error("Skill not found");
      return existing;
    }

    // Since Bun.sql uses tagged templates, we handle each combo explicitly
    if (data.summary !== undefined && data.content !== undefined) {
      const result = await sql`
        UPDATE skills
        SET summary = ${data.summary}, content = ${data.content}, updated_at = CURRENT_TIMESTAMP
        WHERE id = ${id}
        RETURNING *
      `;
      return result[0];
    } else if (data.summary !== undefined) {
      const result = await sql`
        UPDATE skills
        SET summary = ${data.summary}, updated_at = CURRENT_TIMESTAMP
        WHERE id = ${id}
        RETURNING *
      `;
      return result[0];
    } else {
      const result = await sql`
        UPDATE skills
        SET content = ${data.content!}, updated_at = CURRENT_TIMESTAMP
        WHERE id = ${id}
        RETURNING *
      `;
      return result[0];
    }
  }

  async delete(id: number): Promise<void> {
    await sql`DELETE FROM skills WHERE id = ${id}`;
  }

  async findById(id: number): Promise<Skill | null> {
    const result = await sql`SELECT * FROM skills WHERE id = ${id}`;
    return result[0] || null;
  }

  async findByName(userId: number, agentId: number | null, name: string): Promise<Skill | null> {
    if (agentId === null) {
      const result = await sql`
        SELECT * FROM skills
        WHERE user_id = ${userId} AND agent_id IS NULL AND name = ${name}
      `;
      return result[0] || null;
    }
    const result = await sql`
      SELECT * FROM skills
      WHERE user_id = ${userId} AND agent_id = ${agentId} AND name = ${name}
    `;
    return result[0] || null;
  }

  async listForAgent(userId: number, agentId: number): Promise<Skill[]> {
    // Return: agent-scoped skills for this agent + user-level skills that aren't disabled
    const result = await sql`
      SELECT s.* FROM skills s
      WHERE s.user_id = ${userId}
        AND (
          (s.scope = 'agent' AND s.agent_id = ${agentId})
          OR
          (s.scope = 'user' AND s.agent_id IS NULL AND NOT EXISTS (
            SELECT 1 FROM agent_skills as2
            WHERE as2.agent_id = ${agentId} AND as2.skill_id = s.id AND as2.enabled = FALSE
          ))
        )
      ORDER BY s.name ASC
    `;
    return result;
  }

  async listByUser(userId: number): Promise<Skill[]> {
    const result = await sql`
      SELECT * FROM skills
      WHERE user_id = ${userId} AND scope = 'user' AND agent_id IS NULL
      ORDER BY name ASC
    `;
    return result;
  }

  async listByAgent(agentId: number): Promise<Skill[]> {
    const result = await sql`
      SELECT * FROM skills
      WHERE agent_id = ${agentId} AND scope = 'agent'
      ORDER BY name ASC
    `;
    return result;
  }

  async setAgentSkillEnabled(agentId: number, skillId: number, enabled: boolean): Promise<void> {
    await sql`
      INSERT INTO agent_skills (agent_id, skill_id, enabled)
      VALUES (${agentId}, ${skillId}, ${enabled})
      ON CONFLICT (agent_id, skill_id)
      DO UPDATE SET enabled = ${enabled}
    `;
  }

  async isEnabledForAgent(agentId: number, skillId: number): Promise<boolean> {
    const result = await sql`
      SELECT enabled FROM agent_skills
      WHERE agent_id = ${agentId} AND skill_id = ${skillId}
    `;
    // Default to true if no override exists
    if (!result[0]) return true;
    return result[0].enabled;
  }
}
