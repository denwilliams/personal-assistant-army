/**
 * Workflow Definition Types
 *
 * YAML-based workflow definitions that give agents a structured process to follow.
 * Inspired by Home Assistant automations, GitHub Actions, and BPMN concepts.
 *
 * Core concepts:
 * - Workflow: A named, versioned sequence of steps
 * - Step: A unit of work with required facts to collect
 * - Fact: A named piece of data the agent must gather
 * - Gate: Conditions that must be satisfied before a step is complete
 */

// ── Gate condition operators ──────────────────────────────────────────────

export type GateOperator =
  | "exists"
  | "not_exists"
  | "equals"
  | "not_equals"
  | "in"
  | "not_in"
  | "contains"
  | "matches"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "length_gt"
  | "length_gte"
  | "length_lt"
  | "length_lte"
  | "is_true"
  | "is_false";

// ── YAML schema types (what gets parsed from YAML) ───────────────────────

export interface GateCondition {
  /** Fact reference — "<fact_name>" for current step or "<step_id>.<fact_name>" for cross-step */
  fact: string;
  /** Comparison operator */
  operator: GateOperator;
  /** Comparison value (not needed for exists/not_exists/is_true/is_false) */
  value?: unknown;
  /** Human-readable message shown when this condition fails */
  message?: string;
}

export interface Gate {
  /** All conditions must pass for the gate to open */
  conditions: GateCondition[];
  /** What to do when gate conditions are not met: retry (default), abort, or skip */
  on_fail?: "retry" | "abort" | "skip";
}

export type FactType = "string" | "number" | "boolean" | "date" | "enum" | "list";

export interface FactDefinition {
  /** Identifier (snake_case), used in gate references */
  name: string;
  /** Data type for validation */
  type: FactType;
  /** What this fact represents (shown to the agent) */
  description: string;
  /** Allowed values when type is "enum" */
  enum_values?: string[];
  /** Suggested phrasing for asking the user */
  ask?: string;
  /** Default value if user declines to provide */
  default?: unknown;
}

export interface WorkflowStep {
  /** Unique identifier (snake_case) */
  id: string;
  /** Human-readable step name */
  name: string;
  /** Instructions for the agent — what to accomplish in this step */
  description: string;
  /** Facts the agent must collect during this step */
  required_facts: FactDefinition[];
  /** What tools the agent may use: "conversation", "any", or specific tool names */
  allowed_tools: string | string[];
  /** Gate conditions to pass before moving to next step */
  gate: Gate;
}

export interface WorkflowDefinition {
  /** Human-readable workflow name */
  name: string;
  /** What this workflow accomplishes */
  description: string;
  /** Semver version string */
  version: string;
  /** Categorization tags */
  tags?: string[];
  /** Max wall-clock time in minutes (default: 30) */
  timeout_minutes?: number;
  /** Ordered list of steps executed sequentially */
  steps: WorkflowStep[];
}

// ── Runtime state types ──────────────────────────────────────────────────

/** A single fact value collected during workflow execution */
export interface CollectedFact {
  /** The fact value */
  value: unknown;
  /** Which step collected this fact */
  step_id: string;
  /** When the fact was collected (epoch ms) */
  collected_at: number;
  /** How the fact was collected */
  source: "conversation" | "tool" | "default" | "verifier";
}

/** Current state of a workflow execution */
export interface WorkflowExecutionState {
  /** Current step index (0-based) */
  current_step_index: number;
  /** Current step ID */
  current_step_id: string;
  /** All facts collected so far, keyed as "step_id.fact_name" */
  facts: Record<string, CollectedFact>;
  /** Status of each step */
  step_statuses: Record<string, StepStatus>;
  /** Overall workflow status */
  status: "in_progress" | "completed" | "failed" | "timed_out";
  /** When the workflow started (epoch ms) */
  started_at: number;
  /** When the workflow ended (epoch ms), null if still running */
  completed_at: number | null;
}

export type StepStatus = "pending" | "in_progress" | "completed" | "skipped" | "failed";

/** Result of evaluating gate conditions */
export interface GateEvaluationResult {
  /** Whether all conditions passed */
  passed: boolean;
  /** List of failed condition messages */
  failures: string[];
  /** Detailed per-condition results */
  details: Array<{
    condition: GateCondition;
    passed: boolean;
    actual_value?: unknown;
    message: string;
  }>;
}

/** Result from the verifier agent */
export interface VerifierResult {
  /** Whether the verifier approves advancing */
  approved: boolean;
  /** Explanation from the verifier */
  reasoning: string;
  /** Any facts the verifier extracted or corrected */
  extracted_facts?: Record<string, unknown>;
}
