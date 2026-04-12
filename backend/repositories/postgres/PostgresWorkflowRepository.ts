import { sql } from "bun";
import type {
  Workflow,
  AgentWorkflow,
  WorkflowExecution,
  WorkflowFact,
} from "../../types/models";
import type {
  WorkflowRepository,
  CreateWorkflowData,
  UpdateWorkflowData,
  CreateWorkflowExecutionData,
  SetFactData,
} from "../WorkflowRepository";

export class PostgresWorkflowRepository implements WorkflowRepository {
  // ── Workflows CRUD ──────────────────────────────────────────────────────

  async listByUser(userId: number): Promise<Workflow[]> {
    return await sql`
      SELECT * FROM workflows
      WHERE user_id = ${userId}
      ORDER BY updated_at DESC
    `;
  }

  async findById(id: number): Promise<Workflow | null> {
    const result = await sql`
      SELECT * FROM workflows WHERE id = ${id}
    `;
    return result[0] || null;
  }

  async findByName(userId: number, name: string): Promise<Workflow | null> {
    const result = await sql`
      SELECT * FROM workflows
      WHERE user_id = ${userId} AND name = ${name}
    `;
    return result[0] || null;
  }

  async create(data: CreateWorkflowData): Promise<Workflow> {
    const result = await sql`
      INSERT INTO workflows (user_id, name, description, yaml_content, version, tags, timeout_minutes)
      VALUES (
        ${data.user_id},
        ${data.name},
        ${data.description || null},
        ${data.yaml_content},
        ${data.version || '1.0.0'},
        ${JSON.stringify(data.tags || [])},
        ${data.timeout_minutes || 30}
      )
      RETURNING *
    `;
    return result[0];
  }

  async update(id: number, data: UpdateWorkflowData): Promise<Workflow> {
    const result = await sql`
      UPDATE workflows SET
        name = COALESCE(${data.name ?? null}, name),
        description = COALESCE(${data.description ?? null}, description),
        yaml_content = COALESCE(${data.yaml_content ?? null}, yaml_content),
        version = COALESCE(${data.version ?? null}, version),
        tags = COALESCE(${data.tags ? JSON.stringify(data.tags) : null}, tags),
        timeout_minutes = COALESCE(${data.timeout_minutes ?? null}, timeout_minutes),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ${id}
      RETURNING *
    `;
    return result[0];
  }

  async delete(id: number): Promise<void> {
    await sql`DELETE FROM workflows WHERE id = ${id}`;
  }

  // ── Agent-workflow assignments ──────────────────────────────────────────

  async listAgentWorkflows(agentId: number): Promise<(AgentWorkflow & { workflow: Workflow })[]> {
    const rows = await sql`
      SELECT aw.*, w.name as w_name, w.description as w_description, w.yaml_content as w_yaml_content,
             w.version as w_version, w.tags as w_tags, w.timeout_minutes as w_timeout_minutes,
             w.user_id as w_user_id, w.created_at as w_created_at, w.updated_at as w_updated_at
      FROM agent_workflows aw
      JOIN workflows w ON w.id = aw.workflow_id
      WHERE aw.agent_id = ${agentId}
      ORDER BY aw.created_at ASC
    `;
    return rows.map((row: any) => ({
      id: row.id,
      agent_id: row.agent_id,
      workflow_id: row.workflow_id,
      is_default: row.is_default,
      created_at: row.created_at,
      workflow: {
        id: row.workflow_id,
        user_id: row.w_user_id,
        name: row.w_name,
        description: row.w_description,
        yaml_content: row.w_yaml_content,
        version: row.w_version,
        tags: row.w_tags,
        timeout_minutes: row.w_timeout_minutes,
        created_at: row.w_created_at,
        updated_at: row.w_updated_at,
      },
    }));
  }

  async getDefaultWorkflow(agentId: number): Promise<Workflow | null> {
    const result = await sql`
      SELECT w.* FROM workflows w
      JOIN agent_workflows aw ON aw.workflow_id = w.id
      WHERE aw.agent_id = ${agentId} AND aw.is_default = TRUE
      LIMIT 1
    `;
    return result[0] || null;
  }

  async assignWorkflow(agentId: number, workflowId: number, isDefault: boolean): Promise<AgentWorkflow> {
    const result = await sql`
      INSERT INTO agent_workflows (agent_id, workflow_id, is_default)
      VALUES (${agentId}, ${workflowId}, ${isDefault})
      ON CONFLICT (agent_id, workflow_id) DO UPDATE SET is_default = ${isDefault}
      RETURNING *
    `;
    return result[0];
  }

  async unassignWorkflow(agentId: number, workflowId: number): Promise<void> {
    await sql`
      DELETE FROM agent_workflows
      WHERE agent_id = ${agentId} AND workflow_id = ${workflowId}
    `;
  }

  async setDefaultWorkflow(agentId: number, workflowId: number): Promise<void> {
    // Clear existing defaults for this agent
    await sql`
      UPDATE agent_workflows SET is_default = FALSE
      WHERE agent_id = ${agentId}
    `;
    // Set the new default
    await sql`
      UPDATE agent_workflows SET is_default = TRUE
      WHERE agent_id = ${agentId} AND workflow_id = ${workflowId}
    `;
  }

  // ── Workflow executions ─────────────────────────────────────────────────

  async getActiveExecution(conversationId: number): Promise<WorkflowExecution | null> {
    const result = await sql`
      SELECT * FROM workflow_executions
      WHERE conversation_id = ${conversationId} AND status = 'in_progress'
      ORDER BY created_at DESC
      LIMIT 1
    `;
    return result[0] || null;
  }

  async createExecution(data: CreateWorkflowExecutionData): Promise<WorkflowExecution> {
    const result = await sql`
      INSERT INTO workflow_executions (conversation_id, workflow_id, current_step_id, started_at)
      VALUES (${data.conversation_id}, ${data.workflow_id}, ${data.current_step_id}, ${data.started_at})
      RETURNING *
    `;
    return result[0];
  }

  async updateExecution(
    executionId: number,
    data: Partial<Pick<WorkflowExecution, 'current_step_index' | 'current_step_id' | 'status' | 'completed_at'>>
  ): Promise<WorkflowExecution> {
    const result = await sql`
      UPDATE workflow_executions SET
        current_step_index = COALESCE(${data.current_step_index ?? null}, current_step_index),
        current_step_id = COALESCE(${data.current_step_id ?? null}, current_step_id),
        status = COALESCE(${data.status ?? null}, status),
        completed_at = COALESCE(${data.completed_at ?? null}, completed_at),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ${executionId}
      RETURNING *
    `;
    return result[0];
  }

  // ── Workflow facts ──────────────────────────────────────────────────────

  async listFacts(executionId: number): Promise<WorkflowFact[]> {
    return await sql`
      SELECT * FROM workflow_facts
      WHERE execution_id = ${executionId}
      ORDER BY collected_at ASC
    `;
  }

  async listFactsByStep(executionId: number, stepId: string): Promise<WorkflowFact[]> {
    return await sql`
      SELECT * FROM workflow_facts
      WHERE execution_id = ${executionId} AND step_id = ${stepId}
      ORDER BY collected_at ASC
    `;
  }

  async setFact(data: SetFactData): Promise<WorkflowFact> {
    const result = await sql`
      INSERT INTO workflow_facts (execution_id, step_id, fact_name, fact_value, source, collected_at)
      VALUES (
        ${data.execution_id},
        ${data.step_id},
        ${data.fact_name},
        ${JSON.stringify(data.fact_value)},
        ${data.source},
        ${data.collected_at}
      )
      ON CONFLICT (execution_id, step_id, fact_name) DO UPDATE SET
        fact_value = ${JSON.stringify(data.fact_value)},
        source = ${data.source},
        collected_at = ${data.collected_at}
      RETURNING *
    `;
    return result[0];
  }
}
