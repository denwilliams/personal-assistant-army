import type { Skill } from "../types/models";

export interface CreateSkillData {
  user_id: number;
  agent_id: number | null;
  name: string;
  summary: string;
  content: string;
  scope: 'agent' | 'user';
  author: 'user' | 'agent';
  universal?: boolean;
}

export interface UpdateSkillData {
  summary?: string;
  content?: string;
  universal?: boolean;
}

export interface SkillRepository {
  create(data: CreateSkillData): Promise<Skill>;
  update(id: number, data: UpdateSkillData): Promise<Skill>;
  delete(id: number): Promise<void>;
  findById(id: number): Promise<Skill | null>;
  findByName(userId: number, agentId: number | null, name: string): Promise<Skill | null>;

  /**
   * All skills available to an agent:
   * - Agent-scoped skills for this agent
   * - Universal user-level skills (unless explicitly excluded via agent_skills.enabled=false)
   * - Standard user-level skills explicitly linked (agent_skills.enabled=true)
   */
  listForAgent(userId: number, agentId: number): Promise<Skill[]>;

  /** All user-level skills */
  listByUser(userId: number): Promise<Skill[]>;

  /** All agent-scoped skills for a specific agent */
  listByAgent(agentId: number): Promise<Skill[]>;

  /** Link or unlink a user-level skill for a specific agent */
  setAgentSkillEnabled(agentId: number, skillId: number, enabled: boolean): Promise<void>;

  /**
   * Check if a user-level skill is enabled for an agent.
   * Universal skills default to true; standard skills default to false.
   */
  isEnabledForAgent(agentId: number, skillId: number): Promise<boolean>;
}
