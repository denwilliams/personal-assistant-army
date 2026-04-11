import type { Workflow, WorkflowStep } from "../types/models";

export interface CreateWorkflowData {
  user_id: number;
  agent_id: number | null;
  name: string;
  summary: string;
  steps: WorkflowStep[];
  scope: 'agent' | 'user';
  author: 'user' | 'agent';
}

export interface UpdateWorkflowData {
  summary?: string;
  steps?: WorkflowStep[];
}

export interface WorkflowRepository {
  create(data: CreateWorkflowData): Promise<Workflow>;
  update(id: number, data: UpdateWorkflowData): Promise<Workflow>;
  delete(id: number): Promise<void>;
  findById(id: number): Promise<Workflow | null>;
  findByName(userId: number, agentId: number | null, name: string): Promise<Workflow | null>;

  /** All workflows available to an agent (its own agent-scoped + enabled user-level) */
  listForAgent(userId: number, agentId: number): Promise<Workflow[]>;

  /** All user-level workflows */
  listByUser(userId: number): Promise<Workflow[]>;

  /** All agent-scoped workflows for a specific agent */
  listByAgent(agentId: number): Promise<Workflow[]>;

  /** Toggle a user-level workflow for a specific agent */
  setAgentWorkflowEnabled(agentId: number, workflowId: number, enabled: boolean): Promise<void>;

  /** Check if a user-level workflow is enabled for an agent (default: true if no override) */
  isEnabledForAgent(agentId: number, workflowId: number): Promise<boolean>;
}
