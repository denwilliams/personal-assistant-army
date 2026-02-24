import { run, setDefaultOpenAIKey } from "@openai/agents";
import type { Schedule } from "../types/models";
import type { ScheduleRepository } from "../repositories/ScheduleRepository";
import type { ConversationRepository } from "../repositories/ConversationRepository";
import type { UserRepository } from "../repositories/UserRepository";
import type { AgentFactory } from "./AgentFactory";
import { DatabaseSession } from "./DatabaseSession";
import { decrypt } from "../utils/encryption";
import { computeNextRun } from "../utils/schedule";

interface SchedulerServiceDeps {
  scheduleRepository: ScheduleRepository;
  agentFactory: AgentFactory;
  conversationRepository: ConversationRepository;
  userRepository: UserRepository;
  encryptionSecret: string;
}

export class SchedulerService {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;

  constructor(private deps: SchedulerServiceDeps) {}

  start(intervalMs = 30_000) {
    console.log(`Scheduler started (polling every ${intervalMs / 1000}s)`);
    this.tick(intervalMs);
  }

  stop() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    console.log("Scheduler stopped");
  }

  private tick(intervalMs: number) {
    this.timer = setTimeout(async () => {
      if (!this.running) {
        this.running = true;
        try {
          await this.poll();
        } catch (err) {
          console.error("Scheduler poll error:", err);
        } finally {
          this.running = false;
        }
      }
      this.tick(intervalMs);
    }, intervalMs);
  }

  private async poll() {
    const dueSchedules = await this.deps.scheduleRepository.listDue();
    if (dueSchedules.length > 0) {
      console.log(`Scheduler: ${dueSchedules.length} schedule(s) due for execution`);
    }

    // Execute each schedule serially to avoid API key conflicts
    for (const schedule of dueSchedules) {
      await this.executeSchedule(schedule);
    }
  }

  private async executeSchedule(schedule: Schedule) {
    console.log(
      `Executing schedule ${schedule.id}: ${schedule.description || schedule.prompt.substring(0, 50)}`
    );

    const execution = await this.deps.scheduleRepository.logExecution({
      schedule_id: schedule.id,
      status: "running",
    });

    try {
      // Advance next_run BEFORE execution so the schedule isn't picked up again
      // while the agent is still running (execution can take minutes).
      const nextRun = computeNextRun(schedule);
      await this.deps.scheduleRepository.updateNextRun(
        schedule.id,
        nextRun,
        new Date()
      );

      // Disable one-shot schedules immediately
      if (schedule.schedule_type === "once") {
        await this.deps.scheduleRepository.update(schedule.id, {
          enabled: false,
        });
      }

      // Load user for API key
      const user = await this.deps.userRepository.findById(schedule.user_id);
      if (!user) throw new Error("User not found");
      if (!user.openai_api_key) throw new Error("No OpenAI API key configured");

      const openaiApiKey = await decrypt(
        user.openai_api_key,
        this.deps.encryptionSecret
      );

      // Resolve the agent slug from agent_id
      const agentConfig = await this.deps.agentFactory.getAgentConfigById(
        schedule.user_id,
        schedule.agent_id
      );

      // Get or create conversation
      let conversationId = schedule.conversation_id;
      if (schedule.conversation_mode === "new" || !conversationId) {
        const conversation = await this.deps.conversationRepository.create({
          user_id: schedule.user_id,
          agent_id: schedule.agent_id,
          title: `[Scheduled] ${schedule.description || schedule.prompt.substring(0, 50)}`,
        });
        conversationId = conversation.id;
      }

      // Create agent and run (non-streaming for scheduled execution)
      const context = { ...user, updateStatus: () => {} };
      const agent = await this.deps.agentFactory.createAgent(context, agentConfig.slug, {
        conversationId,
      });

      setDefaultOpenAIKey(openaiApiKey);

      const session = new DatabaseSession(
        conversationId,
        this.deps.conversationRepository
      );

      await run(agent, schedule.prompt, {
        context,
        session,
      });

      // Success
      await this.deps.scheduleRepository.updateExecution(execution.id, {
        status: "success",
        completed_at: new Date(),
      });

      console.log(`Schedule ${schedule.id} executed successfully`);
    } catch (err) {
      console.error(`Schedule ${schedule.id} execution failed:`, err);

      await this.deps.scheduleRepository.updateExecution(execution.id, {
        status: "error",
        error_message:
          err instanceof Error ? err.message : String(err),
        completed_at: new Date(),
      });
    }
  }
}
