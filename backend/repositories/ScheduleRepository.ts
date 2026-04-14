import type { Schedule, ScheduleExecution, NotifierChannel } from "../types/models";

export interface CreateScheduleData {
  user_id: number;
  agent_id: number;
  prompt: string;
  description?: string;
  schedule_type: 'once' | 'interval' | 'cron';
  schedule_value: string;
  timezone: string;
  conversation_mode: 'new' | 'continue';
  conversation_id?: number;
  author: 'user' | 'agent';
  next_run_at?: number; // epoch ms
  notifier?: NotifierChannel | null;
  notifier_destination?: string | null;
}

export interface ScheduleRepository {
  create(data: CreateScheduleData): Promise<Schedule>;
  update(id: number, data: Partial<Pick<Schedule, 'prompt' | 'description' | 'enabled' | 'schedule_value' | 'schedule_type' | 'notifier' | 'notifier_destination'>>): Promise<Schedule>;
  delete(id: number): Promise<void>;
  findById(id: number): Promise<Schedule | null>;
  listByUser(userId: number): Promise<Schedule[]>;
  listByAgent(agentId: number): Promise<Schedule[]>;
  countByUser(userId: number): Promise<number>;

  /** Get all enabled schedules due for execution */
  listDue(): Promise<Schedule[]>;

  /** Update next_run_at after execution */
  updateNextRun(id: number, nextRunAt: number | null, lastRunAt: number): Promise<void>;

  /** Log an execution */
  logExecution(data: {
    schedule_id: number;
    conversation_id?: number;
    status: 'running' | 'success' | 'error' | 'retry';
    error_message?: string;
  }): Promise<ScheduleExecution>;

  /** Update execution status */
  updateExecution(id: number, data: {
    status: 'success' | 'error' | 'retry';
    error_message?: string;
    completed_at?: number;
    conversation_id?: number;
  }): Promise<void>;

  /** Get execution history for a schedule */
  listExecutions(scheduleId: number, limit?: number): Promise<ScheduleExecution[]>;
}
