import { tool } from "@openai/agents";
import type { ScheduleRepository } from "../repositories/ScheduleRepository";
import { z } from "zod";
import type { ToolContext } from "./context";
import { computeFirstRun } from "../utils/schedule";

export function createScheduleTools<TContext extends ToolContext>(
  scheduleRepository: ScheduleRepository,
  userId: number,
  agentId: number,
  currentConversationId: number | null,
  timezone: string
) {
  const schedulePrompt = tool<typeof schedulePromptParams, TContext>({
    name: "schedule_prompt",
    description:
      "Schedule a message to be sent to yourself in the future. Use for follow-ups, recurring checks, or delayed tasks.",
    parameters: schedulePromptParams,
    execute: async (params, context) => {
      context?.context.updateStatus("Creating schedule...");

      // Enforce minimum interval of 5 minutes
      if (params.schedule_type === "interval") {
        const ms = parseInt(params.schedule_value);
        if (isNaN(ms) || ms < 300000) {
          return JSON.stringify({
            error: "Minimum interval is 5 minutes (300000ms)",
          });
        }
      }

      // Check user limit
      const count = await scheduleRepository.countByUser(userId);
      if (count >= 50) {
        return JSON.stringify({
          error: "Schedule limit reached (50). Delete unused schedules first.",
        });
      }

      // Compute first run time
      const nextRunAt = computeFirstRun(
        params.schedule_type,
        params.schedule_value,
        timezone
      );

      const schedule = await scheduleRepository.create({
        user_id: userId,
        agent_id: agentId,
        prompt: params.prompt,
        description: params.description,
        schedule_type: params.schedule_type,
        schedule_value: params.schedule_value,
        timezone,
        conversation_mode: params.conversation_mode ?? "new",
        conversation_id:
          params.conversation_mode === "continue"
            ? currentConversationId ?? undefined
            : undefined,
        author: "agent",
        next_run_at: nextRunAt ?? undefined,
      });

      console.log(
        `Agent scheduled prompt: ${schedule.description || schedule.prompt.substring(0, 50)} (id=${schedule.id}, next_run=${nextRunAt})`
      );

      return JSON.stringify({
        success: true,
        schedule_id: schedule.id,
        next_run: nextRunAt?.toISOString(),
        message: `Scheduled: ${params.description || params.prompt.substring(0, 50)}`,
      });
    },
  });

  const listSchedules = tool<typeof listSchedulesParams, TContext>({
    name: "list_schedules",
    description: "List your active scheduled prompts.",
    parameters: listSchedulesParams,
    execute: async (_params, context) => {
      context?.context.updateStatus("Loading schedules...");

      const schedules = await scheduleRepository.listByAgent(agentId);

      return JSON.stringify(
        schedules.map((s) => ({
          id: s.id,
          description: s.description,
          prompt: s.prompt.substring(0, 100),
          type: s.schedule_type,
          value: s.schedule_value,
          enabled: s.enabled,
          next_run: s.next_run_at,
          last_run: s.last_run_at,
        }))
      );
    },
  });

  const cancelSchedule = tool<typeof cancelScheduleParams, TContext>({
    name: "cancel_schedule",
    description: "Cancel (disable) a scheduled prompt.",
    parameters: cancelScheduleParams,
    execute: async (params, context) => {
      context?.context.updateStatus("Cancelling schedule...");

      const schedule = await scheduleRepository.findById(params.schedule_id);
      if (!schedule || schedule.agent_id !== agentId) {
        return JSON.stringify({ error: "Schedule not found" });
      }

      await scheduleRepository.update(params.schedule_id, { enabled: false });

      console.log(`Agent cancelled schedule: ${schedule.id}`);

      return JSON.stringify({
        success: true,
        message: "Schedule cancelled",
      });
    },
  });

  return [schedulePrompt, listSchedules, cancelSchedule];
}

const schedulePromptParams = z.object({
  prompt: z.string().describe("The message to send to yourself later"),
  schedule_type: z
    .enum(["once", "interval", "cron"])
    .describe(
      "once = single future run (provide ISO 8601 timestamp), interval = recurring (provide milliseconds), cron = cron expression"
    ),
  schedule_value: z
    .string()
    .describe(
      "ISO 8601 timestamp for 'once', milliseconds as string for 'interval', or cron expression for 'cron' (e.g., '0 9 * * 1-5' for weekdays at 9am)"
    ),
  conversation_mode: z
    .enum(["new", "continue"])
    .optional()
    .describe(
      "'continue' to resume this conversation, 'new' to start a fresh conversation (default: 'new')"
    ),
  description: z
    .string()
    .optional()
    .describe("Human-readable description of what this schedule does"),
});

const listSchedulesParams = z.object({});

const cancelScheduleParams = z.object({
  schedule_id: z.number().describe("The ID of the schedule to cancel"),
});
