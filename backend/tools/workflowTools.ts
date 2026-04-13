/**
 * Workflow Tools
 *
 * Tools available to agents during workflow execution.
 * These allow the agent to report collected facts back to the workflow engine.
 */

import { tool } from "ai";
import { z } from "zod";
import { getWorkflowContext } from "./context";

/**
 * Tool for agents to report facts they've collected during a workflow step.
 * Facts are stored and used to evaluate gate conditions.
 */
export const workflowTools = {
  report_workflow_facts: tool({
    description:
      "Report one or more facts collected during the current workflow step. " +
      "Call this whenever you gather a piece of required information, whether from the user, " +
      "a tool result, or your own reasoning. Each fact should match one of the required_facts " +
      "listed in the current step. Report facts incrementally as you collect them.",
    inputSchema: z.object({
      facts: z.array(
        z.object({
          name: z.string().describe("The fact name (must match a required_facts name from the current step)"),
          value: z.unknown().describe("The fact value (string, number, boolean, array, etc.)"),
          source: z.enum(["conversation", "tool"]).describe(
            "How the fact was obtained: 'conversation' if from user input, 'tool' if from a tool result"
          ),
        })
      ).describe("Array of facts to report"),
    }),
    execute: async (params, options) => {
      const ctx = getWorkflowContext(options);
      if (!ctx) {
        return "No active workflow. Facts not recorded.";
      }

      const { workflowEngine, executionId, currentStepId } = ctx;
      const recorded: string[] = [];
      const errors: string[] = [];

      for (const fact of params.facts) {
        try {
          await workflowEngine.setFact(
            executionId,
            currentStepId,
            fact.name,
            fact.value,
            fact.source
          );
          recorded.push(`${fact.name} = ${JSON.stringify(fact.value)}`);
        } catch (err) {
          errors.push(`Failed to record ${fact.name}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      let result = "";
      if (recorded.length > 0) {
        result += `Recorded ${recorded.length} fact(s): ${recorded.join(", ")}`;
      }
      if (errors.length > 0) {
        result += `\nErrors: ${errors.join(", ")}`;
      }
      return result || "No facts to record.";
    },
  }),
};
