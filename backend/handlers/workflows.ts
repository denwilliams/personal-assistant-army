import type { BunRequest } from "bun";
import type { AgentRepository } from "../repositories/AgentRepository";
import type { WorkflowRepository } from "../repositories/WorkflowRepository";
import type { User, WorkflowStep } from "../types/models";

interface WorkflowsHandlerDependencies {
  agentRepository: AgentRepository;
  workflowRepository: WorkflowRepository;
  authenticate: (
    req: BunRequest
  ) => Promise<{ user: User; session: { id: string; userId: number } } | null>;
}

function getDomain(email: string): string {
  return email.split("@")[1] || "";
}

function validateSteps(raw: unknown): WorkflowStep[] | { error: string } {
  if (!Array.isArray(raw)) {
    return { error: "steps must be an array" };
  }
  if (raw.length < 2) {
    return { error: "A workflow must have at least 2 steps" };
  }
  const steps: WorkflowStep[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") {
      return { error: "Each step must be an object with title and instructions" };
    }
    const { title, instructions } = entry as Record<string, unknown>;
    if (typeof title !== "string" || title.trim().length === 0) {
      return { error: "Each step requires a non-empty title" };
    }
    if (typeof instructions !== "string" || instructions.trim().length === 0) {
      return { error: "Each step requires non-empty instructions" };
    }
    steps.push({ title, instructions });
  }
  return steps;
}

export function createWorkflowsHandlers(deps: WorkflowsHandlerDependencies) {
  const getAgentWithAccess = async (user: User, slug: string) => {
    const domain = getDomain(user.email);
    const agent = await deps.agentRepository.findAccessibleBySlug(user.id, domain, slug);
    if (!agent) return { error: "Agent not found", status: 404 };
    if (agent.user_id !== user.id) return { error: "Forbidden", status: 403 };
    return { agent };
  };

  /**
   * GET /api/workflows
   */
  const listUserWorkflows = async (req: BunRequest): Promise<Response> => {
    const auth = await deps.authenticate(req);
    if (!auth) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
      const workflows = await deps.workflowRepository.listByUser(auth.user.id);
      return Response.json({ workflows });
    } catch (err) {
      console.error("Error listing user workflows:", err);
      return Response.json({ error: "Failed to list workflows" }, { status: 500 });
    }
  };

  /**
   * POST /api/workflows
   */
  const createUserWorkflow = async (req: BunRequest): Promise<Response> => {
    const auth = await deps.authenticate(req);
    if (!auth) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
      const body = await req.json();
      const { name, summary, steps } = body;

      if (!name || !summary || !steps) {
        return Response.json(
          { error: "name, summary, and steps are required" },
          { status: 400 }
        );
      }

      const validated = validateSteps(steps);
      if (!Array.isArray(validated)) {
        return Response.json({ error: validated.error }, { status: 400 });
      }

      const existing = await deps.workflowRepository.findByName(
        auth.user.id,
        null,
        name
      );
      if (existing) {
        return Response.json(
          { error: `Workflow '${name}' already exists` },
          { status: 409 }
        );
      }

      const workflow = await deps.workflowRepository.create({
        user_id: auth.user.id,
        agent_id: null,
        name,
        summary,
        steps: validated,
        scope: "user",
        author: "user",
      });

      return Response.json({ workflow }, { status: 201 });
    } catch (err) {
      console.error("Error creating user workflow:", err);
      return Response.json(
        { error: "Failed to create workflow" },
        { status: 500 }
      );
    }
  };

  /**
   * PUT /api/workflows/:id
   */
  const updateWorkflow = async (req: BunRequest): Promise<Response> => {
    const auth = await deps.authenticate(req);
    if (!auth) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
      const url = new URL(req.url);
      const pathParts = url.pathname.split("/");
      const workflowId = parseInt(pathParts[pathParts.length - 1] ?? "");
      if (isNaN(workflowId)) {
        return Response.json({ error: "Invalid workflow ID" }, { status: 400 });
      }

      const workflow = await deps.workflowRepository.findById(workflowId);
      if (!workflow || workflow.user_id !== auth.user.id) {
        return Response.json({ error: "Workflow not found" }, { status: 404 });
      }

      const body = await req.json();
      const { summary, steps } = body;

      let validatedSteps: WorkflowStep[] | undefined = undefined;
      if (steps !== undefined) {
        const validated = validateSteps(steps);
        if (!Array.isArray(validated)) {
          return Response.json({ error: validated.error }, { status: 400 });
        }
        validatedSteps = validated;
      }

      const updated = await deps.workflowRepository.update(workflowId, {
        summary,
        steps: validatedSteps,
      });

      return Response.json({ workflow: updated });
    } catch (err) {
      console.error("Error updating workflow:", err);
      return Response.json(
        { error: "Failed to update workflow" },
        { status: 500 }
      );
    }
  };

  /**
   * DELETE /api/workflows/:id
   */
  const deleteWorkflow = async (req: BunRequest): Promise<Response> => {
    const auth = await deps.authenticate(req);
    if (!auth) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
      const url = new URL(req.url);
      const pathParts = url.pathname.split("/");
      const workflowId = parseInt(pathParts[pathParts.length - 1] ?? "");
      if (isNaN(workflowId)) {
        return Response.json({ error: "Invalid workflow ID" }, { status: 400 });
      }

      const workflow = await deps.workflowRepository.findById(workflowId);
      if (!workflow || workflow.user_id !== auth.user.id) {
        return Response.json({ error: "Workflow not found" }, { status: 404 });
      }

      await deps.workflowRepository.delete(workflowId);
      return Response.json({ success: true });
    } catch (err) {
      console.error("Error deleting workflow:", err);
      return Response.json(
        { error: "Failed to delete workflow" },
        { status: 500 }
      );
    }
  };

  /**
   * GET /api/agents/:slug/workflows
   */
  const listAgentWorkflows = async (req: BunRequest): Promise<Response> => {
    const auth = await deps.authenticate(req);
    if (!auth) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
      const url = new URL(req.url);
      const pathParts = url.pathname.split("/");
      const slug = pathParts[pathParts.length - 2] ?? "";

      const result = await getAgentWithAccess(auth.user, slug);
      if (result.error) {
        return Response.json(
          { error: result.error },
          { status: result.status }
        );
      }

      const workflows = await deps.workflowRepository.listForAgent(
        auth.user.id,
        result.agent!.id
      );
      return Response.json({ workflows });
    } catch (err) {
      console.error("Error listing agent workflows:", err);
      return Response.json(
        { error: "Failed to list workflows" },
        { status: 500 }
      );
    }
  };

  /**
   * POST /api/agents/:slug/workflows
   */
  const createAgentWorkflow = async (req: BunRequest): Promise<Response> => {
    const auth = await deps.authenticate(req);
    if (!auth) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
      const url = new URL(req.url);
      const pathParts = url.pathname.split("/");
      const slug = pathParts[pathParts.length - 2] ?? "";

      const result = await getAgentWithAccess(auth.user, slug);
      if (result.error) {
        return Response.json(
          { error: result.error },
          { status: result.status }
        );
      }

      const body = await req.json();
      const { name, summary, steps } = body;

      if (!name || !summary || !steps) {
        return Response.json(
          { error: "name, summary, and steps are required" },
          { status: 400 }
        );
      }

      const validated = validateSteps(steps);
      if (!Array.isArray(validated)) {
        return Response.json({ error: validated.error }, { status: 400 });
      }

      const workflow = await deps.workflowRepository.create({
        user_id: auth.user.id,
        agent_id: result.agent!.id,
        name,
        summary,
        steps: validated,
        scope: "agent",
        author: "user",
      });

      return Response.json({ workflow }, { status: 201 });
    } catch (err) {
      console.error("Error creating agent workflow:", err);
      return Response.json(
        { error: "Failed to create workflow" },
        { status: 500 }
      );
    }
  };

  /**
   * PATCH /api/agents/:slug/workflows/:workflowId/toggle
   */
  const toggleAgentWorkflow = async (req: BunRequest): Promise<Response> => {
    const auth = await deps.authenticate(req);
    if (!auth) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
      const url = new URL(req.url);
      const pathParts = url.pathname.split("/");
      // /api/agents/:slug/workflows/:workflowId/toggle
      const slug = pathParts[pathParts.length - 4] ?? "";
      const workflowId = parseInt(pathParts[pathParts.length - 2] ?? "");

      if (isNaN(workflowId)) {
        return Response.json({ error: "Invalid workflow ID" }, { status: 400 });
      }

      const result = await getAgentWithAccess(auth.user, slug);
      if (result.error) {
        return Response.json(
          { error: result.error },
          { status: result.status }
        );
      }

      const workflow = await deps.workflowRepository.findById(workflowId);
      if (!workflow || workflow.user_id !== auth.user.id) {
        return Response.json({ error: "Workflow not found" }, { status: 404 });
      }

      const body = await req.json();
      const { enabled } = body;

      await deps.workflowRepository.setAgentWorkflowEnabled(
        result.agent!.id,
        workflowId,
        enabled
      );

      return Response.json({ success: true, enabled });
    } catch (err) {
      console.error("Error toggling agent workflow:", err);
      return Response.json(
        { error: "Failed to toggle workflow" },
        { status: 500 }
      );
    }
  };

  /**
   * PATCH /api/workflows/:id/promote
   */
  const promoteWorkflow = async (req: BunRequest): Promise<Response> => {
    const auth = await deps.authenticate(req);
    if (!auth) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
      const url = new URL(req.url);
      const pathParts = url.pathname.split("/");
      const workflowId = parseInt(pathParts[pathParts.length - 2] ?? "");
      if (isNaN(workflowId)) {
        return Response.json({ error: "Invalid workflow ID" }, { status: 400 });
      }

      const workflow = await deps.workflowRepository.findById(workflowId);
      if (!workflow || workflow.user_id !== auth.user.id) {
        return Response.json({ error: "Workflow not found" }, { status: 404 });
      }

      if (workflow.scope === "user") {
        return Response.json(
          { error: "Workflow is already user-level" },
          { status: 400 }
        );
      }

      const existing = await deps.workflowRepository.findByName(
        auth.user.id,
        null,
        workflow.name
      );
      if (existing) {
        return Response.json(
          { error: `A user-level workflow named '${workflow.name}' already exists` },
          { status: 409 }
        );
      }

      const promoted = await deps.workflowRepository.create({
        user_id: auth.user.id,
        agent_id: null,
        name: workflow.name,
        summary: workflow.summary,
        steps: workflow.steps,
        scope: "user",
        author: workflow.author,
      });

      await deps.workflowRepository.delete(workflowId);

      return Response.json({ workflow: promoted });
    } catch (err) {
      console.error("Error promoting workflow:", err);
      return Response.json(
        { error: "Failed to promote workflow" },
        { status: 500 }
      );
    }
  };

  return {
    listUserWorkflows,
    createUserWorkflow,
    updateWorkflow,
    deleteWorkflow,
    listAgentWorkflows,
    createAgentWorkflow,
    toggleAgentWorkflow,
    promoteWorkflow,
  };
}
