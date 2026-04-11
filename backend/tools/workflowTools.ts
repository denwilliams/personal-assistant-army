import { tool } from "ai";
import type { Tool as AiTool } from "ai";
import { z } from "zod";
import type { WorkflowRepository } from "../repositories/WorkflowRepository";
import type { WorkflowStep } from "../types/models";
import type { ToolStatusUpdate } from "./context";

/**
 * Format a workflow's steps as a readable markdown block for inclusion in
 * the tool response. Used by `load_workflow` so the agent can follow the
 * steps in order without additional lookups.
 */
function renderWorkflow(
  name: string,
  summary: string,
  steps: WorkflowStep[]
): string {
  const lines: string[] = [];
  lines.push(`# Workflow: ${name}`);
  lines.push("");
  lines.push(summary);
  lines.push("");
  lines.push("Execute these steps **in order**. Announce each step to the user as you begin it.");
  lines.push("");
  steps.forEach((step, i) => {
    lines.push(`## Step ${i + 1} — ${step.title}`);
    lines.push("");
    lines.push(step.instructions);
    lines.push("");
  });
  return lines.join("\n");
}

export function createWorkflowTools(
  workflowRepository: WorkflowRepository,
  userId: number,
  agentId: number,
  updateStatus: ToolStatusUpdate
): Record<string, AiTool> {
  const load_workflow = tool({
    description:
      "Load a workflow's full steps when a task matches a workflow in your Available Workflows catalog. The returned content lists every step in order; follow them sequentially.",
    inputSchema: loadWorkflowParams,
    execute: async (params) => {
      updateStatus(`Loading workflow: ${params.workflow_name}`);

      const workflow =
        (await workflowRepository.findByName(userId, agentId, params.workflow_name)) ??
        (await workflowRepository.findByName(userId, null, params.workflow_name));

      if (!workflow) {
        return JSON.stringify({
          error: `Workflow '${params.workflow_name}' not found`,
        });
      }

      return JSON.stringify({
        name: workflow.name,
        summary: workflow.summary,
        step_count: workflow.steps.length,
        steps: workflow.steps,
        rendered: renderWorkflow(workflow.name, workflow.summary, workflow.steps),
      });
    },
  });

  const create_workflow = tool({
    description:
      "Create a new workflow — a sequential, ordered process. Load the 'workflow-creator' skill first if you need guidance on structure. Use this instead of create_skill when the task has explicit ordered steps that must be followed in sequence. Mention the workflow creation in your response for transparency.",
    inputSchema: createWorkflowParams,
    execute: async (params) => {
      updateStatus(`Creating workflow: ${params.name}`);

      const existing = await workflowRepository.findByName(userId, agentId, params.name);
      if (existing) {
        return JSON.stringify({
          error: `Workflow '${params.name}' already exists. Use update_workflow instead.`,
        });
      }

      if (params.steps.length < 2) {
        return JSON.stringify({
          error: "A workflow must have at least 2 steps. If it has fewer, use create_skill instead.",
        });
      }

      for (const step of params.steps) {
        if (!step.title || !step.instructions) {
          return JSON.stringify({
            error: "Every step must include both a title and instructions.",
          });
        }
      }

      const workflow = await workflowRepository.create({
        user_id: userId,
        agent_id: agentId,
        name: params.name,
        summary: params.summary,
        steps: params.steps,
        scope: "agent",
        author: "agent",
      });

      console.log(`Agent created workflow: ${workflow.name} (agent_id=${agentId})`);

      return JSON.stringify({
        success: true,
        message: `Workflow '${workflow.name}' created with ${workflow.steps.length} steps`,
      });
    },
  });

  const update_workflow = tool({
    description:
      "Update an existing workflow you created with an improved summary or revised steps.",
    inputSchema: updateWorkflowParams,
    execute: async (params) => {
      updateStatus(`Updating workflow: ${params.name}`);

      const workflow = await workflowRepository.findByName(userId, agentId, params.name);
      if (!workflow) {
        return JSON.stringify({
          error: `Workflow '${params.name}' not found`,
        });
      }

      if (workflow.author !== "agent") {
        return JSON.stringify({
          error: "Cannot update user-created workflows",
        });
      }

      const updateData: { summary?: string; steps?: WorkflowStep[] } = {};
      if (params.summary.length > 0) updateData.summary = params.summary;
      if (params.steps.length > 0) {
        for (const step of params.steps) {
          if (!step.title || !step.instructions) {
            return JSON.stringify({
              error: "Every step must include both a title and instructions.",
            });
          }
        }
        updateData.steps = params.steps;
      }

      await workflowRepository.update(workflow.id, updateData);

      console.log(`Agent updated workflow: ${workflow.name} (agent_id=${agentId})`);

      return JSON.stringify({
        success: true,
        message: `Workflow '${params.name}' updated`,
      });
    },
  });

  const delete_workflow = tool({
    description: "Delete a workflow you previously created.",
    inputSchema: deleteWorkflowParams,
    execute: async (params) => {
      const workflow = await workflowRepository.findByName(userId, agentId, params.name);
      if (!workflow) {
        return JSON.stringify({
          error: `Workflow '${params.name}' not found`,
        });
      }

      if (workflow.author !== "agent") {
        return JSON.stringify({
          error: "Cannot delete user-created workflows",
        });
      }

      await workflowRepository.delete(workflow.id);

      console.log(`Agent deleted workflow: ${workflow.name} (agent_id=${agentId})`);

      return JSON.stringify({
        success: true,
        message: `Workflow '${params.name}' deleted`,
      });
    },
  });

  const list_workflows = tool({
    description:
      "List all workflows available to you, including their summaries, step counts, and metadata.",
    inputSchema: listWorkflowsParams,
    execute: async () => {
      updateStatus("Loading workflows catalog...");

      const workflows = await workflowRepository.listForAgent(userId, agentId);

      return JSON.stringify(
        workflows.map((w) => ({
          name: w.name,
          summary: w.summary,
          scope: w.scope,
          author: w.author,
          step_count: w.steps.length,
        }))
      );
    },
  });

  return {
    load_workflow,
    create_workflow,
    update_workflow,
    delete_workflow,
    list_workflows,
  };
}

const workflowStepSchema = z.object({
  title: z.string().describe("Short action-oriented title for this step"),
  instructions: z
    .string()
    .describe("Detailed, self-contained instructions for executing this step"),
});

const loadWorkflowParams = z.object({
  workflow_name: z.string().describe("The name/slug of the workflow to load"),
});

const createWorkflowParams = z.object({
  name: z
    .string()
    .describe("Workflow slug (lowercase, hyphens, e.g., 'bug-triage')"),
  summary: z
    .string()
    .describe("1-2 sentence description of WHEN to start this workflow"),
  steps: z
    .array(workflowStepSchema)
    .describe("Ordered array of steps to follow — execution order matches array order"),
});

const updateWorkflowParams = z.object({
  name: z.string().describe("The workflow slug to update"),
  summary: z
    .string()
    .describe("Updated summary. Pass empty string to leave unchanged."),
  steps: z
    .array(workflowStepSchema)
    .describe("Updated steps. Pass an empty array to leave unchanged."),
});

const deleteWorkflowParams = z.object({
  name: z.string().describe("The workflow slug to delete"),
});

const listWorkflowsParams = z.object({});
