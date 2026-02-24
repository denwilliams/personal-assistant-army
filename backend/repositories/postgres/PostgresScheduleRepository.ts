import { sql } from "bun";
import type { Schedule, ScheduleExecution } from "../../types/models";
import type { ScheduleRepository, CreateScheduleData } from "../ScheduleRepository";

export class PostgresScheduleRepository implements ScheduleRepository {
  async create(data: CreateScheduleData): Promise<Schedule> {
    const result = await sql`
      INSERT INTO schedules (user_id, agent_id, prompt, description, schedule_type, schedule_value, timezone, conversation_mode, conversation_id, author, next_run_at)
      VALUES (${data.user_id}, ${data.agent_id}, ${data.prompt}, ${data.description ?? null}, ${data.schedule_type}, ${data.schedule_value}, ${data.timezone}, ${data.conversation_mode}, ${data.conversation_id ?? null}, ${data.author}, ${data.next_run_at ?? null})
      RETURNING *
    `;
    return result[0];
  }

  async update(id: number, data: Partial<Pick<Schedule, 'prompt' | 'description' | 'enabled' | 'schedule_value' | 'schedule_type'>>): Promise<Schedule> {
    // Handle each possible field combination with explicit queries
    // since Bun.sql uses tagged templates
    const current = await this.findById(id);
    if (!current) throw new Error("Schedule not found");

    const prompt = data.prompt ?? current.prompt;
    const description = data.description ?? current.description;
    const enabled = data.enabled ?? current.enabled;
    const scheduleValue = data.schedule_value ?? current.schedule_value;
    const scheduleType = data.schedule_type ?? current.schedule_type;

    const result = await sql`
      UPDATE schedules
      SET prompt = ${prompt}, description = ${description}, enabled = ${enabled},
          schedule_value = ${scheduleValue}, schedule_type = ${scheduleType},
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ${id}
      RETURNING *
    `;
    return result[0];
  }

  async delete(id: number): Promise<void> {
    await sql`DELETE FROM schedules WHERE id = ${id}`;
  }

  async findById(id: number): Promise<Schedule | null> {
    const result = await sql`SELECT * FROM schedules WHERE id = ${id}`;
    return result[0] || null;
  }

  async listByUser(userId: number): Promise<Schedule[]> {
    return await sql`
      SELECT * FROM schedules WHERE user_id = ${userId}
      ORDER BY created_at DESC
    `;
  }

  async listByAgent(agentId: number): Promise<Schedule[]> {
    return await sql`
      SELECT * FROM schedules WHERE agent_id = ${agentId}
      ORDER BY created_at DESC
    `;
  }

  async countByUser(userId: number): Promise<number> {
    const result = await sql`
      SELECT COUNT(*)::int as count FROM schedules
      WHERE user_id = ${userId} AND enabled = TRUE
    `;
    return result[0].count;
  }

  async listDue(): Promise<Schedule[]> {
    const now = new Date();
    const results = await sql`
      SELECT * FROM schedules
      WHERE enabled = TRUE AND next_run_at IS NOT NULL AND next_run_at <= ${now}
      ORDER BY next_run_at ASC
    `;
    if (results.length > 0) {
      for (const s of results) {
        console.log(
          `[listDue] schedule ${s.id}: next_run_at=${s.next_run_at?.toISOString?.() ?? s.next_run_at}, now=${now.toISOString()}`
        );
      }
    }
    return results;
  }

  async updateNextRun(id: number, nextRunAt: Date | null, lastRunAt: Date): Promise<void> {
    console.log(
      `[updateNextRun] schedule ${id}: setting next_run_at=${nextRunAt?.toISOString() ?? null}, last_run_at=${lastRunAt.toISOString()}`
    );
    await sql`
      UPDATE schedules
      SET next_run_at = ${nextRunAt}, last_run_at = ${lastRunAt}, updated_at = CURRENT_TIMESTAMP
      WHERE id = ${id}
    `;
    // Verify the write
    const verify = await sql`SELECT next_run_at FROM schedules WHERE id = ${id}`;
    console.log(
      `[updateNextRun] verify schedule ${id}: next_run_at in DB = ${verify[0]?.next_run_at}`
    );
  }

  async logExecution(data: {
    schedule_id: number;
    conversation_id?: number;
    status: 'running' | 'success' | 'error' | 'retry';
    error_message?: string;
  }): Promise<ScheduleExecution> {
    const result = await sql`
      INSERT INTO schedule_executions (schedule_id, conversation_id, status, error_message)
      VALUES (${data.schedule_id}, ${data.conversation_id ?? null}, ${data.status}, ${data.error_message ?? null})
      RETURNING *
    `;
    return result[0];
  }

  async updateExecution(id: number, data: {
    status: 'success' | 'error' | 'retry';
    error_message?: string;
    completed_at?: Date;
  }): Promise<void> {
    await sql`
      UPDATE schedule_executions
      SET status = ${data.status}, error_message = ${data.error_message ?? null},
          completed_at = ${data.completed_at ?? new Date()}
      WHERE id = ${id}
    `;
  }

  async listExecutions(scheduleId: number, limit = 20): Promise<ScheduleExecution[]> {
    return await sql`
      SELECT * FROM schedule_executions
      WHERE schedule_id = ${scheduleId}
      ORDER BY started_at DESC
      LIMIT ${limit}
    `;
  }
}
