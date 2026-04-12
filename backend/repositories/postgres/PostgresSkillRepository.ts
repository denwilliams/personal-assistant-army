import { sql } from "bun";
import type { Skill } from "../../types/models";
import type { SkillRepository, CreateSkillData, UpdateSkillData } from "../SkillRepository";

export class PostgresSkillRepository implements SkillRepository {
  async create(data: CreateSkillData): Promise<Skill> {
    const universal = data.universal ?? false;
    const result = await sql`
      INSERT INTO skills (user_id, agent_id, name, summary, content, scope, author, universal)
      VALUES (${data.user_id}, ${data.agent_id}, ${data.name}, ${data.summary}, ${data.content}, ${data.scope}, ${data.author}, ${universal})
      RETURNING *
    `;
    return result[0];
  }

  async update(id: number, data: UpdateSkillData): Promise<Skill> {
    const existing = await this.findById(id);
    if (!existing) throw new Error("Skill not found");

    if (data.summary === undefined && data.content === undefined && data.universal === undefined) {
      return existing;
    }

    const summary = data.summary ?? existing.summary;
    const content = data.content ?? existing.content;
    const universal = data.universal ?? existing.universal;

    const result = await sql`
      UPDATE skills
      SET summary = ${summary}, content = ${content}, universal = ${universal}, updated_at = CURRENT_TIMESTAMP
      WHERE id = ${id}
      RETURNING *
    `;
    return result[0];
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
    // 3-tier skill availability:
    // 1. Agent-scoped skills: always available to their owning agent
    // 2. Universal user-level skills: available unless explicitly excluded (agent_skills.enabled=false)
    // 3. Standard user-level skills: only available if explicitly linked (agent_skills.enabled=true)
    const result = await sql`
      SELECT s.* FROM skills s
      WHERE s.user_id = ${userId}
        AND (
          (s.scope = 'agent' AND s.agent_id = ${agentId})
          OR
          (s.scope = 'user' AND s.agent_id IS NULL AND s.universal = TRUE AND NOT EXISTS (
            SELECT 1 FROM agent_skills ask
            WHERE ask.agent_id = ${agentId} AND ask.skill_id = s.id AND ask.enabled = FALSE
          ))
          OR
          (s.scope = 'user' AND s.agent_id IS NULL AND s.universal = FALSE AND EXISTS (
            SELECT 1 FROM agent_skills ask
            WHERE ask.agent_id = ${agentId} AND ask.skill_id = s.id AND ask.enabled = TRUE
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
    const override = await sql`
      SELECT enabled FROM agent_skills
      WHERE agent_id = ${agentId} AND skill_id = ${skillId}
    `;
    if (override[0]) return override[0].enabled;

    // No override — default depends on whether skill is universal
    const skill = await sql`
      SELECT universal FROM skills WHERE id = ${skillId}
    `;
    if (!skill[0]) return false;
    // Universal skills default to enabled; standard skills default to disabled
    return skill[0].universal;
  }
}
