import { tool } from "ai";
import type { Tool as AiTool } from "ai";
import { z } from "zod";
import { computeFirstRun } from "../utils/schedule";
import { getContext } from "./context";

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
    .describe(
      "'continue' to resume this conversation, 'new' to start a fresh conversation"
    ),
  description: z
    .string()
    .describe("Human-readable description of what this schedule does"),
  notifier: z
    .enum(["email", "webhook", "pushover"])
    .optional()
    .describe(
      "Override which notification channel to use when this schedule runs. If omitted, uses the agent's default notifier or all enabled channels."
    ),
});

const listSchedulesParams = z.object({});

const cancelScheduleParams = z.object({
  schedule_id: z.number().describe("The ID of the schedule to cancel"),
});

const schedule_prompt = tool({
  description:
    "Schedule a message to be sent to yourself in the future. Use for follow-ups, recurring checks, or delayed tasks.",
  inputSchema: schedulePromptParams,
  execute: async (params, options) => {
    const { updateStatus, userId, agentId, conversationId, timezone, scheduleRepository } = getContext(options);
    updateStatus("Creating schedule...");

    if (params.schedule_type === "interval") {
      const ms = parseInt(params.schedule_value);
      if (isNaN(ms) || ms < 300000) {
        return JSON.stringify({ error: "Minimum interval is 5 minutes (300000ms)" });
      }
    }

    const count = await scheduleRepository.countByUser(userId);
    if (count >= 50) {
      return JSON.stringify({ error: "Schedule limit reached (50). Delete unused schedules first." });
    }

    const nextRunAt = computeFirstRun(params.schedule_type, params.schedule_value, timezone);

    const schedule = await scheduleRepository.create({
      user_id: userId,
      agent_id: agentId,
      prompt: params.prompt,
      description: params.description,
      schedule_type: params.schedule_type,
      schedule_value: params.schedule_value,
      timezone,
      conversation_mode: params.conversation_mode,
      conversation_id:
        params.conversation_mode === "continue"
          ? conversationId ?? undefined
          : undefined,
      author: "agent",
      next_run_at: nextRunAt ?? undefined,
      notifier: params.notifier ?? null,
    });

    console.log(
      `Agent scheduled prompt: ${schedule.description || schedule.prompt.substring(0, 50)} (id=${schedule.id}, next_run=${nextRunAt})`
    );

    return JSON.stringify({
      success: true,
      schedule_id: schedule.id,
      next_run: nextRunAt ? new Date(nextRunAt).toISOString() : null,
      message: `Scheduled: ${params.description || params.prompt.substring(0, 50)}`,
    });
  },
});

const list_schedules = tool({
  description: "List your active scheduled prompts.",
  inputSchema: listSchedulesParams,
  execute: async (_params, options) => {
    const { updateStatus, agentId, scheduleRepository } = getContext(options);
    updateStatus("Loading schedules...");

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

const cancel_schedule = tool({
  description: "Cancel (disable) a scheduled prompt.",
  inputSchema: cancelScheduleParams,
  execute: async (params, options) => {
    const { updateStatus, agentId, scheduleRepository } = getContext(options);
    updateStatus("Cancelling schedule...");

    const schedule = await scheduleRepository.findById(params.schedule_id);
    if (!schedule || schedule.agent_id !== agentId) {
      return JSON.stringify({ error: "Schedule not found" });
    }

    await scheduleRepository.update(params.schedule_id, { enabled: false });

    console.log(`Agent cancelled schedule: ${schedule.id}`);

    return JSON.stringify({ success: true, message: "Schedule cancelled" });
  },
});

/** Schedule tools - always included for all agents */
export const scheduleTools: Record<string, AiTool> = {
  schedule_prompt,
  list_schedules,
  cancel_schedule,
};
