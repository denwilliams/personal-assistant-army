import type { ModelMessage } from "ai";
import type { Schedule } from "../types/models";
import type { ScheduleRepository } from "../repositories/ScheduleRepository";
import type { ConversationRepository } from "../repositories/ConversationRepository";
import type { UserRepository } from "../repositories/UserRepository";
import type { AgentFactory } from "./AgentFactory";
import { DatabaseSession } from "./DatabaseSession";
import { decrypt } from "../utils/encryption";
import { computeNextRun } from "../utils/schedule";
import { EmbeddingService } from "./EmbeddingService";
import type { ApiKeys } from "./ModelResolver";

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
    // Skip any runs missed while the process was down so they don't all fire
    // on startup. Recurring schedules advance to their next future occurrence;
    // one-shot schedules whose time has already passed are disabled.
    this.skipOverdueOnStartup().catch((err) => {
      console.error("Scheduler startup skip error:", err);
    });
    this.tick(intervalMs);
  }

  private async skipOverdueOnStartup() {
    const overdue = await this.deps.scheduleRepository.listDue();
    if (overdue.length === 0) return;

    console.log(
      `Scheduler: advancing ${overdue.length} overdue schedule(s) past missed runs`
    );

    for (const schedule of overdue) {
      try {
        if (schedule.schedule_type === "once") {
          // One-shot schedule missed during downtime — disable without executing.
          await this.deps.scheduleRepository.update(schedule.id, {
            enabled: false,
          });
          console.log(
            `  - Schedule ${schedule.id} (once): missed at ${
              schedule.next_run_at
                ? new Date(schedule.next_run_at).toISOString()
                : "unknown"
            }, disabled`
          );
        } else {
          // Recurring schedule — advance next_run_at to the next future occurrence.
          const nextRun = computeNextRun(schedule);
          await this.deps.scheduleRepository.updateNextRun(
            schedule.id,
            nextRun,
            schedule.last_run_at ?? Date.now()
          );
          console.log(
            `  - Schedule ${schedule.id} (${schedule.schedule_type}): advanced to ${
              nextRun ? new Date(nextRun).toISOString() : "null"
            }`
          );
        }
      } catch (err) {
        console.error(
          `Failed to advance overdue schedule ${schedule.id}:`,
          err
        );
      }
    }
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

    // Track conversationId outside the try so we can persist it on error paths too
    let conversationId: number | null = null;

    try {
      // Advance next_run BEFORE execution
      const nextRun = computeNextRun(schedule);
      await this.deps.scheduleRepository.updateNextRun(
        schedule.id,
        nextRun,
        Date.now()
      );

      // Disable one-shot schedules immediately
      if (schedule.schedule_type === "once") {
        await this.deps.scheduleRepository.update(schedule.id, {
          enabled: false,
        });
      }

      // Load user for API keys
      const user = await this.deps.userRepository.findById(schedule.user_id);
      if (!user) throw new Error("User not found");

      // Build API keys
      const apiKeys: ApiKeys = {};
      if (user.openai_api_key) {
        apiKeys.openai = await decrypt(user.openai_api_key, this.deps.encryptionSecret);
      }
      if (user.anthropic_api_key) {
        apiKeys.anthropic = await decrypt(user.anthropic_api_key, this.deps.encryptionSecret);
      }
      if (user.google_ai_api_key) {
        apiKeys.google = await decrypt(user.google_ai_api_key, this.deps.encryptionSecret);
      }
      if (user.openwebui_url) {
        apiKeys.openwebui_url = user.openwebui_url;
      }
      if (user.openwebui_api_key) {
        apiKeys.openwebui_key = await decrypt(user.openwebui_api_key, this.deps.encryptionSecret);
      }

      if (!apiKeys.openai && !apiKeys.anthropic && !apiKeys.google && !(apiKeys.openwebui_url && apiKeys.openwebui_key)) {
        throw new Error("No API keys configured");
      }

      // Resolve the agent slug from agent_id
      const agentConfig = await this.deps.agentFactory.getAgentConfigById(
        schedule.user_id,
        schedule.agent_id
      );

      // Get or create conversation
      conversationId = schedule.conversation_id;
      if (schedule.conversation_mode === "new" || !conversationId) {
        const conversation = await this.deps.conversationRepository.create({
          user_id: schedule.user_id,
          agent_id: schedule.agent_id,
          title: `[Scheduled] ${schedule.description || schedule.prompt.substring(0, 50)}`,
          source: "scheduled",
        });
        conversationId = conversation.id;
      }

      // Create agent config
      const embeddingService = apiKeys.openai ? new EmbeddingService(apiKeys.openai) : null;

      // Decrypt Google search credentials if available
      let googleSearchApiKey: string | undefined;
      if (user.google_search_api_key) {
        googleSearchApiKey = await decrypt(user.google_search_api_key, this.deps.encryptionSecret);
      }

      const agentInstance = await this.deps.agentFactory.createAgent(
        user.id,
        agentConfig.slug,
        () => {}, // no-op status for scheduled execution
        apiKeys,
        {
          conversationId,
          generateEmbedding: embeddingService
            ? (text) => embeddingService.generate(text)
            : undefined,
          googleSearchApiKey,
          googleSearchEngineId: user.google_search_engine_id,
          domain: user.email.split("@")[1] || "",
          notifierOverride: schedule.notifier ?? undefined,
          notifierDestinationOverride: schedule.notifier_destination ?? undefined,
        }
      );

      // Create session and add user message
      const session = new DatabaseSession(conversationId, this.deps.conversationRepository);
      await session.addUserMessage(schedule.prompt);
      const messages = await session.getMessages();

      // Run the agent
      const result = await agentInstance.agent.generate({
        messages,
      });

      // Save response messages
      await session.saveResponseMessages(result.response.messages as ModelMessage[]);

      // Success
      await this.deps.scheduleRepository.updateExecution(execution.id, {
        status: "success",
        completed_at: Date.now(),
        conversation_id: conversationId,
      });

      console.log(`Schedule ${schedule.id} executed successfully`);
    } catch (err) {
      console.error(`Schedule ${schedule.id} execution failed:`, err);

      await this.deps.scheduleRepository.updateExecution(execution.id, {
        status: "error",
        error_message:
          err instanceof Error ? err.message : String(err),
        completed_at: Date.now(),
        conversation_id: conversationId ?? undefined,
      });
    }
  }
}
