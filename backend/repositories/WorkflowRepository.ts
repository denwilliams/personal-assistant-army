import type {
  Workflow,
  AgentWorkflow,
  WorkflowExecution,
  WorkflowFact,
} from "../types/models";

export interface CreateWorkflowData {
  user_id: number;
  name: string;
  description?: string;
  yaml_content: string;
  version?: string;
  tags?: string[];
  timeout_minutes?: number;
}

export interface UpdateWorkflowData {
  name?: string;
  description?: string;
  yaml_content?: string;
  version?: string;
  tags?: string[];
  timeout_minutes?: number;
}

export interface CreateWorkflowExecutionData {
  conversation_id: number;
  workflow_id: number;
  current_step_id: string;
  started_at: number; // epoch ms
}

export interface SetFactData {
  execution_id: number;
  step_id: string;
  fact_name: string;
  fact_value: unknown;
  source: 'conversation' | 'tool' | 'default' | 'verifier';
  collected_at: number; // epoch ms
}

export interface WorkflowRepository {
  // Workflows CRUD
  listByUser(userId: number): Promise<Workflow[]>;
  findById(id: number): Promise<Workflow | null>;
  findByName(userId: number, name: string): Promise<Workflow | null>;
  create(data: CreateWorkflowData): Promise<Workflow>;
  update(id: number, data: UpdateWorkflowData): Promise<Workflow>;
  delete(id: number): Promise<void>;

  // Agent-workflow assignments
  listAgentWorkflows(agentId: number): Promise<(AgentWorkflow & { workflow: Workflow })[]>;
  getDefaultWorkflow(agentId: number): Promise<Workflow | null>;
  assignWorkflow(agentId: number, workflowId: number, isDefault: boolean): Promise<AgentWorkflow>;
  unassignWorkflow(agentId: number, workflowId: number): Promise<void>;
  setDefaultWorkflow(agentId: number, workflowId: number): Promise<void>;

  // Workflow executions
  getActiveExecution(conversationId: number): Promise<WorkflowExecution | null>;
  createExecution(data: CreateWorkflowExecutionData): Promise<WorkflowExecution>;
  updateExecution(
    executionId: number,
    data: Partial<Pick<WorkflowExecution, 'current_step_index' | 'current_step_id' | 'status' | 'completed_at'>>
  ): Promise<WorkflowExecution>;

  // Workflow facts
  listFacts(executionId: number): Promise<WorkflowFact[]>;
  listFactsByStep(executionId: number, stepId: string): Promise<WorkflowFact[]>;
  setFact(data: SetFactData): Promise<WorkflowFact>;
}
