/**
 * YAML Workflow Parser & Validator
 *
 * Parses YAML workflow definitions and validates their structure
 * against the expected schema.
 */

import yaml from "js-yaml";
import type {
  WorkflowDefinition,
  WorkflowStep,
  FactDefinition,
  Gate,
  GateCondition,
  GateOperator,
  FactType,
} from "./types";

const VALID_OPERATORS: GateOperator[] = [
  "exists", "not_exists",
  "equals", "not_equals",
  "in", "not_in",
  "contains", "matches",
  "gt", "gte", "lt", "lte",
  "length_gt", "length_gte", "length_lt", "length_lte",
  "is_true", "is_false",
];

const VALID_FACT_TYPES: FactType[] = [
  "string", "number", "boolean", "date", "enum", "list",
];

const VALID_ON_FAIL = ["retry", "abort", "skip"];

export class WorkflowParseError extends Error {
  constructor(
    message: string,
    public path: string,
    public details?: string
  ) {
    super(`${message} (at ${path})${details ? `: ${details}` : ""}`);
    this.name = "WorkflowParseError";
  }
}

/**
 * Parse a YAML string into a validated WorkflowDefinition.
 * Throws WorkflowParseError on invalid input.
 */
export function parseWorkflow(yamlContent: string): WorkflowDefinition {
  let raw: unknown;
  try {
    raw = yaml.load(yamlContent);
  } catch (err) {
    throw new WorkflowParseError(
      "Invalid YAML syntax",
      "root",
      err instanceof Error ? err.message : String(err)
    );
  }

  if (!raw || typeof raw !== "object") {
    throw new WorkflowParseError("Workflow must be a YAML object", "root");
  }

  const doc = raw as Record<string, unknown>;

  // Validate top-level required fields
  requireString(doc, "name", "root");
  requireString(doc, "description", "root");
  requireString(doc, "version", "root");

  if (doc.tags !== undefined) {
    if (!Array.isArray(doc.tags)) {
      throw new WorkflowParseError("tags must be an array", "tags");
    }
    for (let i = 0; i < doc.tags.length; i++) {
      if (typeof doc.tags[i] !== "string") {
        throw new WorkflowParseError(`tags[${i}] must be a string`, `tags[${i}]`);
      }
    }
  }

  if (doc.timeout_minutes !== undefined) {
    if (typeof doc.timeout_minutes !== "number" || doc.timeout_minutes <= 0) {
      throw new WorkflowParseError("timeout_minutes must be a positive number", "timeout_minutes");
    }
  }

  if (!Array.isArray(doc.steps) || doc.steps.length === 0) {
    throw new WorkflowParseError("steps must be a non-empty array", "steps");
  }

  // Validate steps
  const stepIds = new Set<string>();
  const steps: WorkflowStep[] = [];

  for (let i = 0; i < doc.steps.length; i++) {
    const stepPath = `steps[${i}]`;
    const step = validateStep(doc.steps[i], stepPath, stepIds);
    stepIds.add(step.id);
    steps.push(step);
  }

  // Validate cross-step fact references in gate conditions
  for (const step of steps) {
    for (let i = 0; i < step.gate.conditions.length; i++) {
      const cond = step.gate.conditions[i]!;
      const factRef = cond.fact;
      if (factRef.includes(".")) {
        const refStepId = factRef.split(".")[0]!;
        if (!stepIds.has(refStepId)) {
          throw new WorkflowParseError(
            `Gate condition references unknown step "${refStepId}"`,
            `steps[${steps.indexOf(step)}].gate.conditions[${i}].fact`
          );
        }
      }
    }
  }

  return {
    name: doc.name as string,
    description: doc.description as string,
    version: doc.version as string,
    tags: (doc.tags as string[]) || [],
    timeout_minutes: (doc.timeout_minutes as number) || 30,
    steps,
  };
}

function validateStep(
  raw: unknown,
  path: string,
  existingIds: Set<string>
): WorkflowStep {
  if (!raw || typeof raw !== "object") {
    throw new WorkflowParseError("Step must be an object", path);
  }
  const step = raw as Record<string, unknown>;

  requireString(step, "id", path);
  requireString(step, "name", path);
  requireString(step, "description", path);

  const id = step.id as string;
  if (!/^[a-z][a-z0-9_]*$/.test(id)) {
    throw new WorkflowParseError(
      "Step id must be snake_case (lowercase letters, numbers, underscores)",
      `${path}.id`
    );
  }
  if (existingIds.has(id)) {
    throw new WorkflowParseError(`Duplicate step id: "${id}"`, `${path}.id`);
  }

  // Validate required_facts
  if (!Array.isArray(step.required_facts)) {
    throw new WorkflowParseError("required_facts must be an array", `${path}.required_facts`);
  }
  const facts: FactDefinition[] = [];
  const factNames = new Set<string>();
  for (let i = 0; i < step.required_facts.length; i++) {
    const fact = validateFact(step.required_facts[i], `${path}.required_facts[${i}]`);
    if (factNames.has(fact.name)) {
      throw new WorkflowParseError(`Duplicate fact name: "${fact.name}"`, `${path}.required_facts[${i}]`);
    }
    factNames.add(fact.name);
    facts.push(fact);
  }

  // Validate allowed_tools
  if (step.allowed_tools === undefined) {
    throw new WorkflowParseError("allowed_tools is required", `${path}.allowed_tools`);
  }
  let allowedTools: string | string[];
  if (typeof step.allowed_tools === "string") {
    allowedTools = step.allowed_tools;
  } else if (Array.isArray(step.allowed_tools)) {
    for (let i = 0; i < step.allowed_tools.length; i++) {
      if (typeof step.allowed_tools[i] !== "string") {
        throw new WorkflowParseError(
          "allowed_tools array items must be strings",
          `${path}.allowed_tools[${i}]`
        );
      }
    }
    allowedTools = step.allowed_tools as string[];
  } else {
    throw new WorkflowParseError(
      "allowed_tools must be a string or array of strings",
      `${path}.allowed_tools`
    );
  }

  // Validate gate
  if (!step.gate || typeof step.gate !== "object") {
    throw new WorkflowParseError("gate is required and must be an object", `${path}.gate`);
  }
  const gate = validateGate(step.gate as Record<string, unknown>, `${path}.gate`);

  return {
    id,
    name: step.name as string,
    description: step.description as string,
    required_facts: facts,
    allowed_tools: allowedTools,
    gate,
  };
}

function validateFact(raw: unknown, path: string): FactDefinition {
  if (!raw || typeof raw !== "object") {
    throw new WorkflowParseError("Fact must be an object", path);
  }
  const fact = raw as Record<string, unknown>;

  requireString(fact, "name", path);
  requireString(fact, "type", path);
  requireString(fact, "description", path);

  const factType = fact.type as string;
  if (!VALID_FACT_TYPES.includes(factType as FactType)) {
    throw new WorkflowParseError(
      `Invalid fact type "${factType}". Must be one of: ${VALID_FACT_TYPES.join(", ")}`,
      `${path}.type`
    );
  }

  if (factType === "enum") {
    if (!Array.isArray(fact.enum_values) || fact.enum_values.length === 0) {
      throw new WorkflowParseError(
        "enum_values is required and must be a non-empty array when type is 'enum'",
        `${path}.enum_values`
      );
    }
  }

  return {
    name: fact.name as string,
    type: factType as FactType,
    description: fact.description as string,
    enum_values: fact.enum_values as string[] | undefined,
    ask: fact.ask as string | undefined,
    default: fact.default,
  };
}

function validateGate(raw: Record<string, unknown>, path: string): Gate {
  if (!Array.isArray(raw.conditions) || raw.conditions.length === 0) {
    throw new WorkflowParseError("gate.conditions must be a non-empty array", `${path}.conditions`);
  }

  const conditions: GateCondition[] = [];
  for (let i = 0; i < raw.conditions.length; i++) {
    conditions.push(validateCondition(raw.conditions[i], `${path}.conditions[${i}]`));
  }

  if (raw.on_fail !== undefined) {
    if (typeof raw.on_fail !== "string" || !VALID_ON_FAIL.includes(raw.on_fail)) {
      throw new WorkflowParseError(
        `on_fail must be one of: ${VALID_ON_FAIL.join(", ")}`,
        `${path}.on_fail`
      );
    }
  }

  return {
    conditions,
    on_fail: (raw.on_fail as Gate["on_fail"]) || "retry",
  };
}

function validateCondition(raw: unknown, path: string): GateCondition {
  if (!raw || typeof raw !== "object") {
    throw new WorkflowParseError("Condition must be an object", path);
  }
  const cond = raw as Record<string, unknown>;

  requireString(cond, "fact", path);
  requireString(cond, "operator", path);

  const operator = cond.operator as string;
  if (!VALID_OPERATORS.includes(operator as GateOperator)) {
    throw new WorkflowParseError(
      `Invalid operator "${operator}". Must be one of: ${VALID_OPERATORS.join(", ")}`,
      `${path}.operator`
    );
  }

  // Operators that require a value
  const noValueOperators: GateOperator[] = ["exists", "not_exists", "is_true", "is_false"];
  if (!noValueOperators.includes(operator as GateOperator) && cond.value === undefined) {
    throw new WorkflowParseError(
      `Operator "${operator}" requires a value`,
      `${path}.value`
    );
  }

  return {
    fact: cond.fact as string,
    operator: operator as GateOperator,
    value: cond.value,
    message: cond.message as string | undefined,
  };
}

function requireString(obj: Record<string, unknown>, field: string, path: string): void {
  if (typeof obj[field] !== "string" || !(obj[field] as string).trim()) {
    throw new WorkflowParseError(`"${field}" is required and must be a non-empty string`, `${path}.${field}`);
  }
}
