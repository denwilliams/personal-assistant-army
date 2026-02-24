import type { Skill } from "../types/models";

export interface CreateSkillData {
  user_id: number;
  agent_id: number | null;
  name: string;
  summary: string;
  content: string;
  scope: 'agent' | 'user';
  author: 'user' | 'agent';
}

export interface UpdateSkillData {
  summary?: string;
  content?: string;
}

export interface SkillRepository {
  create(data: CreateSkillData): Promise<Skill>;
  update(id: number, data: UpdateSkillData): Promise<Skill>;
  delete(id: number): Promise<void>;
  findById(id: number): Promise<Skill | null>;
  findByName(userId: number, agentId: number | null, name: string): Promise<Skill | null>;

  /** All skills available to an agent (its own agent-scoped + enabled user-level) */
  listForAgent(userId: number, agentId: number): Promise<Skill[]>;

  /** All user-level skills */
  listByUser(userId: number): Promise<Skill[]>;

  /** All agent-scoped skills for a specific agent */
  listByAgent(agentId: number): Promise<Skill[]>;

  /** Toggle a user-level skill for a specific agent */
  setAgentSkillEnabled(agentId: number, skillId: number, enabled: boolean): Promise<void>;

  /** Check if a user-level skill is enabled for an agent (default: true if no override) */
  isEnabledForAgent(agentId: number, skillId: number): Promise<boolean>;
}
