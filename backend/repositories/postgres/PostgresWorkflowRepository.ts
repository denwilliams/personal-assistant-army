import { sql } from "bun";
import type { Workflow, WorkflowStep } from "../../types/models";
import type {
  WorkflowRepository,
  CreateWorkflowData,
  UpdateWorkflowData,
} from "../WorkflowRepository";

function normalizeSteps(raw: unknown): WorkflowStep[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw as WorkflowStep[];
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as WorkflowStep[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function hydrate(row: any): Workflow {
  return { ...row, steps: normalizeSteps(row.steps) } as Workflow;
}

export class PostgresWorkflowRepository implements WorkflowRepository {
  async create(data: CreateWorkflowData): Promise<Workflow> {
    const stepsJson = JSON.stringify(data.steps);
    const result = await sql`
      INSERT INTO workflows (user_id, agent_id, name, summary, steps, scope, author)
      VALUES (${data.user_id}, ${data.agent_id}, ${data.name}, ${data.summary}, ${stepsJson}::jsonb, ${data.scope}, ${data.author})
      RETURNING *
    `;
    return hydrate(result[0]);
  }

  async update(id: number, data: UpdateWorkflowData): Promise<Workflow> {
    if (data.summary === undefined && data.steps === undefined) {
      const existing = await this.findById(id);
      if (!existing) throw new Error("Workflow not found");
      return existing;
    }

    if (data.summary !== undefined && data.steps !== undefined) {
      const stepsJson = JSON.stringify(data.steps);
      const result = await sql`
        UPDATE workflows
        SET summary = ${data.summary}, steps = ${stepsJson}::jsonb, updated_at = CURRENT_TIMESTAMP
        WHERE id = ${id}
        RETURNING *
      `;
      return hydrate(result[0]);
    } else if (data.summary !== undefined) {
      const result = await sql`
        UPDATE workflows
        SET summary = ${data.summary}, updated_at = CURRENT_TIMESTAMP
        WHERE id = ${id}
        RETURNING *
      `;
      return hydrate(result[0]);
    } else {
      const stepsJson = JSON.stringify(data.steps!);
      const result = await sql`
        UPDATE workflows
        SET steps = ${stepsJson}::jsonb, updated_at = CURRENT_TIMESTAMP
        WHERE id = ${id}
        RETURNING *
      `;
      return hydrate(result[0]);
    }
  }

  async delete(id: number): Promise<void> {
    await sql`DELETE FROM workflows WHERE id = ${id}`;
  }

  async findById(id: number): Promise<Workflow | null> {
    const result = await sql`SELECT * FROM workflows WHERE id = ${id}`;
    return result[0] ? hydrate(result[0]) : null;
  }

  async findByName(
    userId: number,
    agentId: number | null,
    name: string
  ): Promise<Workflow | null> {
    if (agentId === null) {
      const result = await sql`
        SELECT * FROM workflows
        WHERE user_id = ${userId} AND agent_id IS NULL AND name = ${name}
      `;
      return result[0] ? hydrate(result[0]) : null;
    }
    const result = await sql`
      SELECT * FROM workflows
      WHERE user_id = ${userId} AND agent_id = ${agentId} AND name = ${name}
    `;
    return result[0] ? hydrate(result[0]) : null;
  }

  async listForAgent(userId: number, agentId: number): Promise<Workflow[]> {
    const result = await sql`
      SELECT w.* FROM workflows w
      WHERE w.user_id = ${userId}
        AND (
          (w.scope = 'agent' AND w.agent_id = ${agentId})
          OR
          (w.scope = 'user' AND w.agent_id IS NULL AND NOT EXISTS (
            SELECT 1 FROM agent_workflows aw2
            WHERE aw2.agent_id = ${agentId} AND aw2.workflow_id = w.id AND aw2.enabled = FALSE
          ))
        )
      ORDER BY w.name ASC
    `;
    return result.map(hydrate);
  }

  async listByUser(userId: number): Promise<Workflow[]> {
    const result = await sql`
      SELECT * FROM workflows
      WHERE user_id = ${userId} AND scope = 'user' AND agent_id IS NULL
      ORDER BY name ASC
    `;
    return result.map(hydrate);
  }

  async listByAgent(agentId: number): Promise<Workflow[]> {
    const result = await sql`
      SELECT * FROM workflows
      WHERE agent_id = ${agentId} AND scope = 'agent'
      ORDER BY name ASC
    `;
    return result.map(hydrate);
  }

  async setAgentWorkflowEnabled(
    agentId: number,
    workflowId: number,
    enabled: boolean
  ): Promise<void> {
    await sql`
      INSERT INTO agent_workflows (agent_id, workflow_id, enabled)
      VALUES (${agentId}, ${workflowId}, ${enabled})
      ON CONFLICT (agent_id, workflow_id)
      DO UPDATE SET enabled = ${enabled}
    `;
  }

  async isEnabledForAgent(agentId: number, workflowId: number): Promise<boolean> {
    const result = await sql`
      SELECT enabled FROM agent_workflows
      WHERE agent_id = ${agentId} AND workflow_id = ${workflowId}
    `;
    if (!result[0]) return true;
    return result[0].enabled;
  }
}
