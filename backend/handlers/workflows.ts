import type { BunRequest } from "bun";
import type { User } from "../types/models";
import type { AgentRepository } from "../repositories/AgentRepository";
import type { WorkflowRepository } from "../repositories/WorkflowRepository";
import { parseWorkflow, WorkflowParseError } from "../workflows/parser";

function getDomain(email: string): string {
  return email.split("@")[1] || "";
}

interface WorkflowHandlerDependencies {
  workflowRepository: WorkflowRepository;
  agentRepository: AgentRepository;
  authenticate: (
    req: BunRequest
  ) => Promise<{ user: User; session: { id: string; userId: number } } | null>;
}

export function createWorkflowHandlers(deps: WorkflowHandlerDependencies) {
  /**
   * GET /api/workflows
   */
  const listWorkflows = async (req: BunRequest): Promise<Response> => {
    const auth = await deps.authenticate(req);
    if (!auth) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const workflows = await deps.workflowRepository.listByUser(auth.user.id);
    return Response.json({ workflows });
  };

  /**
   * POST /api/workflows
   */
  const createWorkflow = async (req: BunRequest): Promise<Response> => {
    const auth = await deps.authenticate(req);
    if (!auth) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    try {
      const body = await req.json() as {
        name: string;
        description?: string;
        yaml_content: string;
      };

      if (!body.name?.trim()) {
        return new Response(JSON.stringify({ error: "Name is required" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (!body.yaml_content?.trim()) {
        return new Response(JSON.stringify({ error: "YAML content is required" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Validate YAML
      let definition;
      try {
        definition = parseWorkflow(body.yaml_content);
      } catch (err) {
        if (err instanceof WorkflowParseError) {
          return new Response(JSON.stringify({
            error: "Invalid workflow YAML",
            details: err.message,
            path: err.path,
          }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }
        throw err;
      }

      const workflow = await deps.workflowRepository.create({
        user_id: auth.user.id,
        name: body.name.trim(),
        description: body.description || definition.description,
        yaml_content: body.yaml_content,
        version: definition.version,
        tags: definition.tags,
        timeout_minutes: definition.timeout_minutes,
      });

      return Response.json({ workflow }, { status: 201 });
    } catch (error: any) {
      if (error?.code === "23505") {
        return new Response(JSON.stringify({ error: "A workflow with that name already exists" }), {
          status: 409,
          headers: { "Content-Type": "application/json" },
        });
      }
      console.error("Create workflow error:", error);
      return new Response(
        JSON.stringify({ error: error instanceof Error ? error.message : "Failed to create workflow" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
  };

  /**
   * GET /api/workflows/:id
   */
  const getWorkflow = async (req: BunRequest): Promise<Response> => {
    const auth = await deps.authenticate(req);
    if (!auth) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const url = new URL(req.url);
    const id = parseInt(url.pathname.split("/").pop() || "");
    if (isNaN(id)) {
      return new Response(JSON.stringify({ error: "Invalid workflow ID" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const workflow = await deps.workflowRepository.findById(id);
    if (!workflow || workflow.user_id !== auth.user.id) {
      return new Response(JSON.stringify({ error: "Workflow not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Parse and include the definition
    let definition;
    try {
      definition = parseWorkflow(workflow.yaml_content);
    } catch {
      definition = null;
    }

    return Response.json({ workflow, definition });
  };

  /**
   * PUT /api/workflows/:id
   */
  const updateWorkflow = async (req: BunRequest): Promise<Response> => {
    const auth = await deps.authenticate(req);
    if (!auth) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const url = new URL(req.url);
    const id = parseInt(url.pathname.split("/").pop() || "");
    if (isNaN(id)) {
      return new Response(JSON.stringify({ error: "Invalid workflow ID" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const existing = await deps.workflowRepository.findById(id);
    if (!existing || existing.user_id !== auth.user.id) {
      return new Response(JSON.stringify({ error: "Workflow not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    try {
      const body = await req.json() as {
        name?: string;
        description?: string;
        yaml_content?: string;
      };

      // Validate YAML if provided
      if (body.yaml_content) {
        try {
          parseWorkflow(body.yaml_content);
        } catch (err) {
          if (err instanceof WorkflowParseError) {
            return new Response(JSON.stringify({
              error: "Invalid workflow YAML",
              details: err.message,
              path: err.path,
            }), {
              status: 400,
              headers: { "Content-Type": "application/json" },
            });
          }
          throw err;
        }
      }

      const updated = await deps.workflowRepository.update(id, {
        name: body.name,
        description: body.description,
        yaml_content: body.yaml_content,
      });

      return Response.json({ workflow: updated });
    } catch (error) {
      console.error("Update workflow error:", error);
      return new Response(
        JSON.stringify({ error: error instanceof Error ? error.message : "Failed to update workflow" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
  };

  /**
   * DELETE /api/workflows/:id
   */
  const deleteWorkflow = async (req: BunRequest): Promise<Response> => {
    const auth = await deps.authenticate(req);
    if (!auth) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const url = new URL(req.url);
    const id = parseInt(url.pathname.split("/").pop() || "");
    if (isNaN(id)) {
      return new Response(JSON.stringify({ error: "Invalid workflow ID" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const existing = await deps.workflowRepository.findById(id);
    if (!existing || existing.user_id !== auth.user.id) {
      return new Response(JSON.stringify({ error: "Workflow not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    await deps.workflowRepository.delete(id);
    return new Response(null, { status: 204 });
  };

  /**
   * POST /api/workflows/:id/validate
   * Validate a workflow YAML without saving
   */
  const validateWorkflow = async (req: BunRequest): Promise<Response> => {
    const auth = await deps.authenticate(req);
    if (!auth) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    try {
      const body = await req.json() as { yaml_content: string };

      if (!body.yaml_content?.trim()) {
        return new Response(JSON.stringify({ error: "YAML content is required" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      try {
        const definition = parseWorkflow(body.yaml_content);
        return Response.json({
          valid: true,
          definition: {
            name: definition.name,
            description: definition.description,
            version: definition.version,
            tags: definition.tags,
            steps: definition.steps.map((s) => ({
              id: s.id,
              name: s.name,
              facts_count: s.required_facts.length,
              gate_conditions_count: s.gate.conditions.length,
            })),
          },
        });
      } catch (err) {
        if (err instanceof WorkflowParseError) {
          return Response.json({
            valid: false,
            error: err.message,
            path: err.path,
          });
        }
        throw err;
      }
    } catch (error) {
      console.error("Validate workflow error:", error);
      return new Response(
        JSON.stringify({ error: error instanceof Error ? error.message : "Validation failed" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
  };

  /**
   * GET /api/agents/:slug/workflows
   */
  const listAgentWorkflows = async (req: BunRequest): Promise<Response> => {
    const auth = await deps.authenticate(req);
    if (!auth) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const url = new URL(req.url);
    const pathParts = url.pathname.split("/");
    const slug = pathParts[pathParts.indexOf("agents") + 1] || "";

    const domain = getDomain(auth.user.email);
    const agent = await deps.agentRepository.findAccessibleBySlug(auth.user.id, domain, slug);
    if (!agent) {
      return new Response(JSON.stringify({ error: "Agent not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    const agentWorkflows = await deps.workflowRepository.listAgentWorkflows(agent.id);
    return Response.json({ workflows: agentWorkflows });
  };

  /**
   * POST /api/agents/:slug/workflows
   */
  const assignAgentWorkflow = async (req: BunRequest): Promise<Response> => {
    const auth = await deps.authenticate(req);
    if (!auth) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const url = new URL(req.url);
    const pathParts = url.pathname.split("/");
    const slug = pathParts[pathParts.indexOf("agents") + 1] || "";

    const domain = getDomain(auth.user.email);
    const agent = await deps.agentRepository.findAccessibleBySlug(auth.user.id, domain, slug);
    if (!agent) {
      return new Response(JSON.stringify({ error: "Agent not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    try {
      const body = await req.json() as { workflow_id: number; is_default?: boolean };

      if (!body.workflow_id) {
        return new Response(JSON.stringify({ error: "workflow_id is required" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Verify workflow exists and belongs to user
      const workflow = await deps.workflowRepository.findById(body.workflow_id);
      if (!workflow || workflow.user_id !== auth.user.id) {
        return new Response(JSON.stringify({ error: "Workflow not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }

      const assignment = await deps.workflowRepository.assignWorkflow(
        agent.id,
        body.workflow_id,
        body.is_default ?? false
      );

      // If setting as default, update the default
      if (body.is_default) {
        await deps.workflowRepository.setDefaultWorkflow(agent.id, body.workflow_id);
      }

      return Response.json({ assignment }, { status: 201 });
    } catch (error) {
      console.error("Assign workflow error:", error);
      return new Response(
        JSON.stringify({ error: error instanceof Error ? error.message : "Failed to assign workflow" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
  };

  /**
   * DELETE /api/agents/:slug/workflows/:workflowId
   */
  const unassignAgentWorkflow = async (req: BunRequest): Promise<Response> => {
    const auth = await deps.authenticate(req);
    if (!auth) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const url = new URL(req.url);
    const pathParts = url.pathname.split("/");
    const slug = pathParts[pathParts.indexOf("agents") + 1] || "";
    const workflowId = parseInt(pathParts[pathParts.length - 1] || "");

    if (isNaN(workflowId)) {
      return new Response(JSON.stringify({ error: "Invalid workflow ID" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const domain = getDomain(auth.user.email);
    const agent = await deps.agentRepository.findAccessibleBySlug(auth.user.id, domain, slug);
    if (!agent) {
      return new Response(JSON.stringify({ error: "Agent not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    await deps.workflowRepository.unassignWorkflow(agent.id, workflowId);
    return new Response(null, { status: 204 });
  };

  /**
   * PATCH /api/agents/:slug/workflows/:workflowId/default
   */
  const setDefaultAgentWorkflow = async (req: BunRequest): Promise<Response> => {
    const auth = await deps.authenticate(req);
    if (!auth) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const url = new URL(req.url);
    const pathParts = url.pathname.split("/");
    const slug = pathParts[pathParts.indexOf("agents") + 1] || "";
    const workflowId = parseInt(pathParts[pathParts.indexOf("workflows") + 1] || "");

    if (isNaN(workflowId)) {
      return new Response(JSON.stringify({ error: "Invalid workflow ID" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const domain = getDomain(auth.user.email);
    const agent = await deps.agentRepository.findAccessibleBySlug(auth.user.id, domain, slug);
    if (!agent) {
      return new Response(JSON.stringify({ error: "Agent not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    await deps.workflowRepository.setDefaultWorkflow(agent.id, workflowId);
    return Response.json({ success: true });
  };

  return {
    listWorkflows,
    createWorkflow,
    getWorkflow,
    updateWorkflow,
    deleteWorkflow,
    validateWorkflow,
    listAgentWorkflows,
    assignAgentWorkflow,
    unassignAgentWorkflow,
    setDefaultAgentWorkflow,
  };
}
