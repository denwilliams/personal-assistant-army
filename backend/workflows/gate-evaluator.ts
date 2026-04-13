/**
 * Gate Evaluator
 *
 * Programmatically evaluates gate conditions against collected facts.
 * All evaluation is deterministic — no AI involved.
 */

import type {
  Gate,
  GateCondition,
  GateEvaluationResult,
  CollectedFact,
  WorkflowStep,
} from "./types";

/**
 * Evaluate all conditions in a gate against the collected facts.
 * Returns detailed results including per-condition pass/fail.
 */
export function evaluateGate(
  gate: Gate,
  currentStepId: string,
  facts: Record<string, CollectedFact>
): GateEvaluationResult {
  const details: GateEvaluationResult["details"] = [];

  for (const condition of gate.conditions) {
    const result = evaluateCondition(condition, currentStepId, facts);
    details.push(result);
  }

  const failures = details
    .filter((d) => !d.passed)
    .map((d) => d.message);

  return {
    passed: failures.length === 0,
    failures,
    details,
  };
}

/**
 * Resolve a fact reference to its key in the facts map.
 * - "fact_name" → "current_step_id.fact_name"
 * - "step_id.fact_name" → "step_id.fact_name" (already qualified)
 */
function resolveFactKey(factRef: string, currentStepId: string): string {
  if (factRef.includes(".")) {
    return factRef;
  }
  return `${currentStepId}.${factRef}`;
}

/**
 * Get the raw value from a collected fact.
 */
function getFactValue(
  factRef: string,
  currentStepId: string,
  facts: Record<string, CollectedFact>
): { found: boolean; value: unknown } {
  const key = resolveFactKey(factRef, currentStepId);
  const fact = facts[key];
  if (!fact) {
    return { found: false, value: undefined };
  }
  return { found: true, value: fact.value };
}

function evaluateCondition(
  condition: GateCondition,
  currentStepId: string,
  facts: Record<string, CollectedFact>
): GateEvaluationResult["details"][number] {
  const { found, value } = getFactValue(condition.fact, currentStepId, facts);
  const defaultMessage = condition.message || `Condition failed: ${condition.fact} ${condition.operator}${condition.value !== undefined ? ` ${JSON.stringify(condition.value)}` : ""}`;

  try {
    switch (condition.operator) {
      case "exists":
        return result(condition, found && value != null, value, defaultMessage);

      case "not_exists":
        return result(condition, !found || value == null, value, defaultMessage);

      case "equals":
        return result(condition, found && deepEquals(value, condition.value), value, defaultMessage);

      case "not_equals":
        return result(condition, found && !deepEquals(value, condition.value), value, defaultMessage);

      case "in": {
        if (!Array.isArray(condition.value)) {
          return result(condition, false, value, `"in" operator requires an array value`);
        }
        return result(
          condition,
          found && condition.value.some((v: unknown) => deepEquals(value, v)),
          value,
          defaultMessage
        );
      }

      case "not_in": {
        if (!Array.isArray(condition.value)) {
          return result(condition, false, value, `"not_in" operator requires an array value`);
        }
        return result(
          condition,
          found && !condition.value.some((v: unknown) => deepEquals(value, v)),
          value,
          defaultMessage
        );
      }

      case "contains": {
        if (typeof value !== "string" || typeof condition.value !== "string") {
          return result(condition, false, value, `"contains" requires string values`);
        }
        return result(
          condition,
          value.includes(condition.value),
          value,
          defaultMessage
        );
      }

      case "matches": {
        if (typeof value !== "string" || typeof condition.value !== "string") {
          return result(condition, false, value, `"matches" requires string values`);
        }
        try {
          const regex = new RegExp(condition.value);
          return result(condition, regex.test(value), value, defaultMessage);
        } catch {
          return result(condition, false, value, `Invalid regex pattern: ${condition.value}`);
        }
      }

      case "gt":
        return result(condition, found && toNumber(value) > toNumber(condition.value), value, defaultMessage);

      case "gte":
        return result(condition, found && toNumber(value) >= toNumber(condition.value), value, defaultMessage);

      case "lt":
        return result(condition, found && toNumber(value) < toNumber(condition.value), value, defaultMessage);

      case "lte":
        return result(condition, found && toNumber(value) <= toNumber(condition.value), value, defaultMessage);

      case "length_gt":
        return result(condition, found && getLength(value) > toNumber(condition.value), value, defaultMessage);

      case "length_gte":
        return result(condition, found && getLength(value) >= toNumber(condition.value), value, defaultMessage);

      case "length_lt":
        return result(condition, found && getLength(value) < toNumber(condition.value), value, defaultMessage);

      case "length_lte":
        return result(condition, found && getLength(value) <= toNumber(condition.value), value, defaultMessage);

      case "is_true":
        return result(condition, found && value === true, value, defaultMessage);

      case "is_false":
        return result(condition, found && value === false, value, defaultMessage);

      default:
        return result(condition, false, value, `Unknown operator: ${condition.operator}`);
    }
  } catch (err) {
    return result(
      condition,
      false,
      value,
      `Evaluation error: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

function result(
  condition: GateCondition,
  passed: boolean,
  actual_value: unknown,
  message: string
): GateEvaluationResult["details"][number] {
  return {
    condition,
    passed,
    actual_value,
    message: passed ? "OK" : message,
  };
}

function deepEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (typeof a === "object" && a !== null && b !== null) {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return false;
}

function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const n = Number(value);
    if (!isNaN(n)) return n;
  }
  return NaN;
}

function getLength(value: unknown): number {
  if (typeof value === "string") return value.length;
  if (Array.isArray(value)) return value.length;
  return 0;
}

/**
 * Get a summary of which facts are still missing for a given step.
 * Returns fact definitions that haven't been collected yet.
 */
export function getMissingFacts(
  step: WorkflowStep,
  facts: Record<string, CollectedFact>
): string[] {
  const missing: string[] = [];
  for (const factDef of step.required_facts) {
    const key = `${step.id}.${factDef.name}`;
    if (!facts[key]) {
      missing.push(factDef.name);
    }
  }
  return missing;
}
