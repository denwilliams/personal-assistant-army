import type { BunRequest } from "bun";
import type { AgentRepository } from "../repositories/AgentRepository";
import type { ScheduleRepository } from "../repositories/ScheduleRepository";
import type { User } from "../types/models";
import { computeFirstRun } from "../utils/schedule";

interface ScheduleHandlerDependencies {
  agentRepository: AgentRepository;
  scheduleRepository: ScheduleRepository;
  authenticate: (
    req: BunRequest
  ) => Promise<{ user: User; session: { id: string; userId: number } } | null>;
}

export function createScheduleHandlers(deps: ScheduleHandlerDependencies) {
  const getAgentWithOwnership = async (userId: number, slug: string) => {
    const agent = await deps.agentRepository.findBySlug(userId, slug);
    if (!agent) return { error: "Agent not found", status: 404 };
    if (agent.user_id !== userId) return { error: "Forbidden", status: 403 };
    return { agent };
  };

  /**
   * GET /api/schedules
   */
  const listSchedules = async (req: BunRequest): Promise<Response> => {
    const auth = await deps.authenticate(req);
    if (!auth) return Response.json({ error: "Unauthorized" }, { status: 401 });

    try {
      const schedules = await deps.scheduleRepository.listByUser(auth.user.id);
      return Response.json({ schedules });
    } catch (err) {
      console.error("Error listing schedules:", err);
      return Response.json({ error: "Failed to list schedules" }, { status: 500 });
    }
  };

  /**
   * GET /api/agents/:slug/schedules
   */
  const listAgentSchedules = async (req: BunRequest): Promise<Response> => {
    const auth = await deps.authenticate(req);
    if (!auth) return Response.json({ error: "Unauthorized" }, { status: 401 });

    try {
      const url = new URL(req.url);
      const pathParts = url.pathname.split("/");
      const slug = pathParts[pathParts.length - 2] ?? "";

      const result = await getAgentWithOwnership(auth.user.id, slug);
      if (result.error) return Response.json({ error: result.error }, { status: result.status });

      const schedules = await deps.scheduleRepository.listByAgent(result.agent!.id);
      return Response.json({ schedules });
    } catch (err) {
      console.error("Error listing agent schedules:", err);
      return Response.json({ error: "Failed to list schedules" }, { status: 500 });
    }
  };

  /**
   * POST /api/agents/:slug/schedules
   */
  const createSchedule = async (req: BunRequest): Promise<Response> => {
    const auth = await deps.authenticate(req);
    if (!auth) return Response.json({ error: "Unauthorized" }, { status: 401 });

    try {
      const url = new URL(req.url);
      const pathParts = url.pathname.split("/");
      const slug = pathParts[pathParts.length - 2] ?? "";

      const result = await getAgentWithOwnership(auth.user.id, slug);
      if (result.error) return Response.json({ error: result.error }, { status: result.status });

      const body = await req.json();
      const { prompt, description, schedule_type, schedule_value, conversation_mode, conversation_id } = body;

      if (!prompt || !schedule_type || !schedule_value) {
        return Response.json({ error: "prompt, schedule_type, and schedule_value are required" }, { status: 400 });
      }

      if (!["once", "interval", "cron"].includes(schedule_type)) {
        return Response.json({ error: "schedule_type must be 'once', 'interval', or 'cron'" }, { status: 400 });
      }

      if (schedule_type === "interval") {
        const ms = parseInt(schedule_value);
        if (isNaN(ms) || ms < 300000) {
          return Response.json({ error: "Minimum interval is 5 minutes (300000ms)" }, { status: 400 });
        }
      }

      // Check user limit
      const count = await deps.scheduleRepository.countByUser(auth.user.id);
      if (count >= 50) {
        return Response.json({ error: "Schedule limit reached (50)" }, { status: 400 });
      }

      const timezone = auth.user.timezone || "UTC";
      const nextRunAt = computeFirstRun(schedule_type, schedule_value, timezone);

      const schedule = await deps.scheduleRepository.create({
        user_id: auth.user.id,
        agent_id: result.agent!.id,
        prompt,
        description,
        schedule_type,
        schedule_value,
        timezone,
        conversation_mode: conversation_mode || "new",
        conversation_id,
        author: "user",
        next_run_at: nextRunAt ?? undefined,
      });

      return Response.json({ schedule }, { status: 201 });
    } catch (err) {
      console.error("Error creating schedule:", err);
      return Response.json({ error: "Failed to create schedule" }, { status: 500 });
    }
  };

  /**
   * PUT /api/schedules/:id
   */
  const updateSchedule = async (req: BunRequest): Promise<Response> => {
    const auth = await deps.authenticate(req);
    if (!auth) return Response.json({ error: "Unauthorized" }, { status: 401 });

    try {
      const url = new URL(req.url);
      const pathParts = url.pathname.split("/");
      const scheduleId = parseInt(pathParts[pathParts.length - 1] ?? "");
      if (isNaN(scheduleId)) return Response.json({ error: "Invalid schedule ID" }, { status: 400 });

      const schedule = await deps.scheduleRepository.findById(scheduleId);
      if (!schedule || schedule.user_id !== auth.user.id) {
        return Response.json({ error: "Schedule not found" }, { status: 404 });
      }

      const body = await req.json();
      const updated = await deps.scheduleRepository.update(scheduleId, body);

      // Recompute next_run_at if schedule value changed
      if (body.schedule_value || body.schedule_type) {
        const nextRunAt = computeFirstRun(
          updated.schedule_type,
          updated.schedule_value,
          updated.timezone
        );
        await deps.scheduleRepository.updateNextRun(scheduleId, nextRunAt, updated.last_run_at ?? Date.now());
      }

      return Response.json({ schedule: updated });
    } catch (err) {
      console.error("Error updating schedule:", err);
      return Response.json({ error: "Failed to update schedule" }, { status: 500 });
    }
  };

  /**
   * DELETE /api/schedules/:id
   */
  const deleteSchedule = async (req: BunRequest): Promise<Response> => {
    const auth = await deps.authenticate(req);
    if (!auth) return Response.json({ error: "Unauthorized" }, { status: 401 });

    try {
      const url = new URL(req.url);
      const pathParts = url.pathname.split("/");
      const scheduleId = parseInt(pathParts[pathParts.length - 1] ?? "");
      if (isNaN(scheduleId)) return Response.json({ error: "Invalid schedule ID" }, { status: 400 });

      const schedule = await deps.scheduleRepository.findById(scheduleId);
      if (!schedule || schedule.user_id !== auth.user.id) {
        return Response.json({ error: "Schedule not found" }, { status: 404 });
      }

      await deps.scheduleRepository.delete(scheduleId);
      return Response.json({ success: true });
    } catch (err) {
      console.error("Error deleting schedule:", err);
      return Response.json({ error: "Failed to delete schedule" }, { status: 500 });
    }
  };

  /**
   * PATCH /api/schedules/:id/toggle
   */
  const toggleSchedule = async (req: BunRequest): Promise<Response> => {
    const auth = await deps.authenticate(req);
    if (!auth) return Response.json({ error: "Unauthorized" }, { status: 401 });

    try {
      const url = new URL(req.url);
      const pathParts = url.pathname.split("/");
      const scheduleId = parseInt(pathParts[pathParts.length - 2] ?? "");
      if (isNaN(scheduleId)) return Response.json({ error: "Invalid schedule ID" }, { status: 400 });

      const schedule = await deps.scheduleRepository.findById(scheduleId);
      if (!schedule || schedule.user_id !== auth.user.id) {
        return Response.json({ error: "Schedule not found" }, { status: 404 });
      }

      const body = await req.json();
      const updated = await deps.scheduleRepository.update(scheduleId, { enabled: body.enabled });

      return Response.json({ schedule: updated });
    } catch (err) {
      console.error("Error toggling schedule:", err);
      return Response.json({ error: "Failed to toggle schedule" }, { status: 500 });
    }
  };

  /**
   * GET /api/schedules/:id/executions
   */
  const listExecutions = async (req: BunRequest): Promise<Response> => {
    const auth = await deps.authenticate(req);
    if (!auth) return Response.json({ error: "Unauthorized" }, { status: 401 });

    try {
      const url = new URL(req.url);
      const pathParts = url.pathname.split("/");
      const scheduleId = parseInt(pathParts[pathParts.length - 2] ?? "");
      if (isNaN(scheduleId)) return Response.json({ error: "Invalid schedule ID" }, { status: 400 });

      const schedule = await deps.scheduleRepository.findById(scheduleId);
      if (!schedule || schedule.user_id !== auth.user.id) {
        return Response.json({ error: "Schedule not found" }, { status: 404 });
      }

      const executions = await deps.scheduleRepository.listExecutions(scheduleId);
      return Response.json({ executions });
    } catch (err) {
      console.error("Error listing executions:", err);
      return Response.json({ error: "Failed to list executions" }, { status: 500 });
    }
  };

  return {
    listSchedules,
    listAgentSchedules,
    createSchedule,
    updateSchedule,
    deleteSchedule,
    toggleSchedule,
    listExecutions,
  };
}
