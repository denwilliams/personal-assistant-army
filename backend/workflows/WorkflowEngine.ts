/**
 * WorkflowEngine
 *
 * Manages the lifecycle of a workflow execution within a conversation:
 * - Starting workflows (from agent default or explicit assignment)
 * - Tracking step progression
 * - Evaluating gates (programmatic + verifier agent)
 * - Generating system prompt augmentations for the current step
 * - Filtering tools based on step's allowed_tools
 */

import type { ToolSet, LanguageModel } from "ai";
import { generateText } from "ai";
import type { WorkflowRepository } from "../repositories/WorkflowRepository";
import type { WorkflowExecution, Workflow } from "../types/models";
import type {
  WorkflowDefinition,
  WorkflowStep,
  CollectedFact,
  GateEvaluationResult,
  WorkflowExecutionState,
} from "./types";
import { parseWorkflow } from "./parser";
import { evaluateGate, getMissingFacts } from "./gate-evaluator";

export interface WorkflowEngineDependencies {
  workflowRepository: WorkflowRepository;
}

/**
 * The result of processing a workflow turn (after agent responds).
 */
export interface WorkflowTurnResult {
  /** Whether the workflow advanced to the next step */
  advanced: boolean;
  /** Whether the workflow is now complete */
  completed: boolean;
  /** Whether the workflow failed/aborted */
  failed: boolean;
  /** Gate evaluation result (if gate was checked) */
  gateResult?: GateEvaluationResult;
  /** Message to inject into the conversation (step transition feedback) */
  systemMessage?: string;
  /** The current step after this turn */
  currentStep: WorkflowStep;
  /** The new step (if advanced) */
  nextStep?: WorkflowStep;
}

export class WorkflowEngine {
  constructor(private deps: WorkflowEngineDependencies) {}

  /**
   * Start a workflow execution for a conversation.
   * Returns the execution record and the parsed workflow definition.
   */
  async startWorkflow(
    conversationId: number,
    workflowId: number
  ): Promise<{ execution: WorkflowExecution; definition: WorkflowDefinition }> {
    const workflow = await this.deps.workflowRepository.findById(workflowId);
    if (!workflow) {
      throw new Error(`Workflow not found: ${workflowId}`);
    }

    const definition = parseWorkflow(workflow.yaml_content);
    const firstStep = definition.steps[0]!;

    const execution = await this.deps.workflowRepository.createExecution({
      conversation_id: conversationId,
      workflow_id: workflowId,
      current_step_id: firstStep.id,
      started_at: Date.now(),
    });

    // Set defaults for facts that have default values
    for (const factDef of firstStep.required_facts) {
      if (factDef.default !== undefined) {
        await this.deps.workflowRepository.setFact({
          execution_id: execution.id,
          step_id: firstStep.id,
          fact_name: factDef.name,
          fact_value: factDef.default,
          source: "default",
          collected_at: Date.now(),
        });
      }
    }

    return { execution, definition };
  }

  /**
   * Get the active workflow execution for a conversation, if any.
   * Returns the execution, parsed definition, and current state.
   */
  async getActiveWorkflow(conversationId: number): Promise<{
    execution: WorkflowExecution;
    definition: WorkflowDefinition;
    workflow: Workflow;
    state: WorkflowExecutionState;
  } | null> {
    const execution = await this.deps.workflowRepository.getActiveExecution(conversationId);
    if (!execution) return null;

    const workflow = await this.deps.workflowRepository.findById(execution.workflow_id);
    if (!workflow) return null;

    const definition = parseWorkflow(workflow.yaml_content);
    const facts = await this.loadFacts(execution.id);

    const state: WorkflowExecutionState = {
      current_step_index: execution.current_step_index,
      current_step_id: execution.current_step_id,
      facts,
      step_statuses: this.buildStepStatuses(definition, execution),
      status: execution.status,
      started_at: execution.started_at,
      completed_at: execution.completed_at,
    };

    return { execution, definition, workflow, state };
  }

  /**
   * Record a fact collected during the current step.
   */
  async setFact(
    executionId: number,
    stepId: string,
    factName: string,
    factValue: unknown,
    source: 'conversation' | 'tool' | 'default' | 'verifier' = 'conversation'
  ): Promise<void> {
    await this.deps.workflowRepository.setFact({
      execution_id: executionId,
      step_id: stepId,
      fact_name: factName,
      fact_value: factValue,
      source,
      collected_at: Date.now(),
    });
  }

  /**
   * Attempt to advance the workflow after facts have been collected.
   * Runs programmatic gate evaluation first, then optionally uses a verifier model.
   *
   * @param executionId - The workflow execution ID
   * @param currentStepIndex - The current step index in the definition
   * @param definition - The parsed workflow definition
   * @param verifierModel - Optional LLM to use as verifier agent for gate verification
   */
  async tryAdvance(
    executionId: number,
    currentStepIndex: number,
    definition: WorkflowDefinition,
    verifierModel?: LanguageModel
  ): Promise<WorkflowTurnResult> {
    const facts = await this.loadFacts(executionId);
    const currentStep = definition.steps[currentStepIndex];

    if (!currentStep) {
      return {
        advanced: false,
        completed: true,
        failed: false,
        currentStep: definition.steps[definition.steps.length - 1]!,
      };
    }

    // Step 1: Programmatic gate evaluation
    const gateResult = evaluateGate(currentStep.gate, currentStep.id, facts);

    if (!gateResult.passed) {
      // Gate failed — check on_fail strategy
      const onFail = currentStep.gate.on_fail || "retry";

      if (onFail === "abort") {
        await this.deps.workflowRepository.updateExecution(executionId, {
          status: "failed",
          completed_at: Date.now(),
        });
        return {
          advanced: false,
          completed: false,
          failed: true,
          gateResult,
          currentStep,
          systemMessage: `Workflow aborted. Gate conditions not met:\n${gateResult.failures.map(f => `- ${f}`).join("\n")}`,
        };
      }

      if (onFail === "skip") {
        // Skip to next step
        return await this.advanceToNextStep(executionId, definition, currentStepIndex, currentStep, gateResult);
      }

      // Default: retry — stay on current step
      return {
        advanced: false,
        completed: false,
        failed: false,
        gateResult,
        currentStep,
        systemMessage: this.buildRetryMessage(currentStep, gateResult, facts),
      };
    }

    // Step 2: If programmatic gate passes and we have a verifier model, run verification
    if (verifierModel) {
      const verifierResult = await this.runVerifier(
        verifierModel,
        definition,
        currentStep,
        facts
      );

      if (!verifierResult.approved) {
        return {
          advanced: false,
          completed: false,
          failed: false,
          gateResult,
          currentStep,
          systemMessage: `Verifier feedback: ${verifierResult.reasoning}\nPlease address the above before proceeding.`,
        };
      }

      // Apply any facts the verifier extracted
      if (verifierResult.extractedFacts) {
        for (const [key, value] of Object.entries(verifierResult.extractedFacts)) {
          await this.setFact(executionId, currentStep.id, key, value, "verifier");
        }
      }
    }

    // Gate passed — advance
    return await this.advanceToNextStep(executionId, definition, currentStepIndex, currentStep, gateResult);
  }

  /**
   * Build the system prompt augmentation for the current workflow step.
   * This gets appended to the agent's system prompt.
   */
  buildStepPrompt(
    definition: WorkflowDefinition,
    currentStep: WorkflowStep,
    facts: Record<string, CollectedFact>,
    stepIndex: number
  ): string {
    const totalSteps = definition.steps.length;
    const missingFacts = getMissingFacts(currentStep, facts);

    let prompt = `\n\n# Active Workflow: ${definition.name}\n`;
    prompt += `Step ${stepIndex + 1} of ${totalSteps}: **${currentStep.name}**\n\n`;
    prompt += `## Instructions\n${currentStep.description}\n\n`;

    // Show required facts as a checklist
    prompt += `## Required Information\n`;
    prompt += `Collect the following facts before this step can be completed:\n\n`;
    for (const factDef of currentStep.required_facts) {
      const key = `${currentStep.id}.${factDef.name}`;
      const collected = facts[key];
      const check = collected ? "[x]" : "[ ]";
      prompt += `- ${check} **${factDef.name}** (${factDef.type}): ${factDef.description}`;
      if (collected) {
        prompt += ` = \`${JSON.stringify(collected.value)}\``;
      }
      if (factDef.ask && !collected) {
        prompt += `\n  Suggested question: "${factDef.ask}"`;
      }
      prompt += "\n";
    }

    // Show tool constraints
    prompt += `\n## Allowed Tools\n`;
    if (currentStep.allowed_tools === "any") {
      prompt += `You may use any available tool.\n`;
    } else if (currentStep.allowed_tools === "conversation") {
      prompt += `This step should be completed through conversation only. Do not use tools.\n`;
    } else if (Array.isArray(currentStep.allowed_tools)) {
      prompt += `You may only use these tools: ${currentStep.allowed_tools.join(", ")}\n`;
      if (currentStep.allowed_tools.includes("conversation")) {
        prompt += `You may also gather information through conversation.\n`;
      }
    }

    // Show facts collected from previous steps that might be relevant
    const previousFacts = Object.entries(facts).filter(
      ([key]) => !key.startsWith(`${currentStep.id}.`)
    );
    if (previousFacts.length > 0) {
      prompt += `\n## Previously Collected Facts\n`;
      for (const [key, fact] of previousFacts) {
        prompt += `- **${key}**: ${JSON.stringify(fact.value)}\n`;
      }
    }

    // Instruction for reporting facts
    prompt += `\n## Important\n`;
    prompt += `When you have gathered information, use the **report_workflow_facts** tool to record each fact.\n`;
    prompt += `Report facts as you collect them — don't wait until you have all of them.\n`;

    if (missingFacts.length > 0) {
      prompt += `\nStill needed: ${missingFacts.join(", ")}\n`;
    } else {
      prompt += `\nAll facts collected! The gate will be evaluated automatically.\n`;
    }

    return prompt;
  }

  /**
   * Filter agent tools based on the current step's allowed_tools constraint.
   */
  filterTools(tools: ToolSet, currentStep: WorkflowStep): ToolSet {
    const allowed = currentStep.allowed_tools;

    // "any" means no filtering
    if (allowed === "any") {
      return tools;
    }

    // Always include workflow-specific tools
    const filtered: ToolSet = {};
    for (const [name, tool] of Object.entries(tools)) {
      if (name.startsWith("report_workflow") || name.startsWith("workflow_")) {
        filtered[name] = tool;
      }
    }

    // "conversation" means only workflow tools (agent talks to user)
    if (allowed === "conversation") {
      return filtered;
    }

    // Array of specific tool names
    if (Array.isArray(allowed)) {
      for (const [name, tool] of Object.entries(tools)) {
        if (allowed.includes(name) || allowed.includes("conversation")) {
          filtered[name] = tool;
        }
      }
      // Always keep memory tools if they were allowed by the agent config
      // (so the agent can recall relevant information)
      for (const [name, tool] of Object.entries(tools)) {
        if (name === "remember" || name === "recall") {
          filtered[name] = tool;
        }
      }
      return filtered;
    }

    return tools;
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  private async loadFacts(executionId: number): Promise<Record<string, CollectedFact>> {
    const dbFacts = await this.deps.workflowRepository.listFacts(executionId);
    const facts: Record<string, CollectedFact> = {};
    for (const f of dbFacts) {
      facts[`${f.step_id}.${f.fact_name}`] = {
        value: f.fact_value,
        step_id: f.step_id,
        collected_at: f.collected_at,
        source: f.source,
      };
    }
    return facts;
  }

  private async advanceToNextStep(
    executionId: number,
    definition: WorkflowDefinition,
    currentStepIndex: number,
    currentStep: WorkflowStep,
    gateResult: GateEvaluationResult
  ): Promise<WorkflowTurnResult> {
    const nextStepIndex = currentStepIndex + 1;

    if (nextStepIndex >= definition.steps.length) {
      // Workflow complete!
      await this.deps.workflowRepository.updateExecution(executionId, {
        status: "completed",
        completed_at: Date.now(),
      });
      return {
        advanced: true,
        completed: true,
        failed: false,
        gateResult,
        currentStep,
        systemMessage: `Workflow "${definition.name}" completed successfully!`,
      };
    }

    const nextStep = definition.steps[nextStepIndex]!;

    // Update execution to point to next step
    await this.deps.workflowRepository.updateExecution(executionId, {
      current_step_index: nextStepIndex,
      current_step_id: nextStep.id,
    });

    // Set defaults for the new step
    for (const factDef of nextStep.required_facts) {
      if (factDef.default !== undefined) {
        await this.setFact(executionId, nextStep.id, factDef.name, factDef.default, "default");
      }
    }

    return {
      advanced: true,
      completed: false,
      failed: false,
      gateResult,
      currentStep,
      nextStep,
      systemMessage: `Step "${currentStep.name}" complete. Moving to step "${nextStep.name}".`,
    };
  }

  private buildRetryMessage(
    step: WorkflowStep,
    gateResult: GateEvaluationResult,
    facts: Record<string, CollectedFact>
  ): string {
    const missing = getMissingFacts(step, facts);
    let msg = `Still working on step: "${step.name}"\n`;

    if (gateResult.failures.length > 0) {
      msg += `\nGate conditions not yet met:\n`;
      for (const failure of gateResult.failures) {
        msg += `- ${failure}\n`;
      }
    }

    if (missing.length > 0) {
      msg += `\nFacts still needed: ${missing.join(", ")}`;
    }

    return msg;
  }

  /**
   * Run the verifier agent to check if the gate should pass.
   * The verifier gets the workflow definition, current step, and collected facts,
   * and decides whether the step is truly complete.
   */
  private async runVerifier(
    model: LanguageModel,
    definition: WorkflowDefinition,
    currentStep: WorkflowStep,
    facts: Record<string, CollectedFact>
  ): Promise<{ approved: boolean; reasoning: string; extractedFacts?: Record<string, unknown> }> {
    const factSummary = Object.entries(facts)
      .map(([key, f]) => `  ${key}: ${JSON.stringify(f.value)} (source: ${f.source})`)
      .join("\n");

    const stepFactsOnly = Object.entries(facts)
      .filter(([key]) => key.startsWith(`${currentStep.id}.`))
      .map(([key, f]) => `  ${key}: ${JSON.stringify(f.value)}`)
      .join("\n");

    const prompt = `You are a workflow verification agent. Your job is to verify whether the current workflow step has been adequately completed based on the facts collected.

## Workflow: ${definition.name}
${definition.description}

## Current Step: ${currentStep.name}
${currentStep.description}

## Required Facts for This Step:
${currentStep.required_facts.map(f => `- ${f.name} (${f.type}): ${f.description}`).join("\n")}

## Collected Facts for This Step:
${stepFactsOnly || "(none)"}

## All Collected Facts:
${factSummary || "(none)"}

## Your Task
1. Verify that the collected facts adequately satisfy the step's requirements.
2. Check that fact values are reasonable and consistent (e.g., dates make sense, emails look valid, numbers are in expected ranges).
3. If something seems off or incomplete, explain what needs to be addressed.

Respond with a JSON object (and nothing else):
{
  "approved": true/false,
  "reasoning": "Brief explanation of your decision",
  "extracted_facts": {} // Optional: any facts you can extract or correct from the context
}`;

    try {
      const result = await generateText({
        model,
        prompt,
        maxOutputTokens: 500,
      });

      const text = result.text.trim();
      // Try to parse JSON from the response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          approved: !!parsed.approved,
          reasoning: parsed.reasoning || "No reasoning provided",
          extractedFacts: parsed.extracted_facts,
        };
      }

      // Fallback: if no JSON, approve by default (programmatic gate already passed)
      return {
        approved: true,
        reasoning: "Verifier response could not be parsed; deferring to programmatic gate evaluation.",
      };
    } catch (err) {
      console.error("Verifier agent error:", err);
      // On error, defer to programmatic evaluation
      return {
        approved: true,
        reasoning: "Verifier unavailable; deferring to programmatic gate evaluation.",
      };
    }
  }

  private buildStepStatuses(
    definition: WorkflowDefinition,
    execution: WorkflowExecution
  ): Record<string, 'pending' | 'in_progress' | 'completed' | 'skipped' | 'failed'> {
    const statuses: Record<string, string> = {};
    for (let i = 0; i < definition.steps.length; i++) {
      const step = definition.steps[i]!;
      if (i < execution.current_step_index) {
        statuses[step.id] = "completed";
      } else if (i === execution.current_step_index) {
        statuses[step.id] = execution.status === "failed" ? "failed" : "in_progress";
      } else {
        statuses[step.id] = "pending";
      }
    }
    return statuses as any;
  }
}
