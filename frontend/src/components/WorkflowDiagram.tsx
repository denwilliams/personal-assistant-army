import React from "react";
import yaml from "js-yaml";
import { Badge } from "@/components/ui/badge";

// Lightweight types mirroring the backend WorkflowDefinition — just enough
// for rendering.  We parse YAML on the client so the diagram works without
// an extra API round-trip.

interface GateCondition {
  fact: string;
  operator: string;
  value?: unknown;
  message?: string;
}

interface Gate {
  conditions: GateCondition[];
  on_fail?: "retry" | "abort" | "skip";
}

interface FactDefinition {
  name: string;
  type: string;
  description?: string;
  default?: unknown;
}

interface WorkflowStep {
  id: string;
  name: string;
  description?: string;
  required_facts?: FactDefinition[];
  allowed_tools?: string | string[];
  gate?: Gate;
}

interface WorkflowDef {
  name?: string;
  steps?: WorkflowStep[];
}

// ── Helpers ─────────────────────────────────────────────────────────────

function parseYaml(yamlContent: string): WorkflowDef | null {
  try {
    const parsed = yaml.load(yamlContent);
    if (parsed && typeof parsed === "object" && "steps" in (parsed as object)) {
      return parsed as WorkflowDef;
    }
    return null;
  } catch {
    return null;
  }
}

function formatOperator(op: string, value?: unknown): string {
  switch (op) {
    case "exists":
      return "exists";
    case "not_exists":
      return "not set";
    case "equals":
      return `= ${JSON.stringify(value)}`;
    case "not_equals":
      return `!= ${JSON.stringify(value)}`;
    case "gt":
      return `> ${value}`;
    case "gte":
      return `>= ${value}`;
    case "lt":
      return `< ${value}`;
    case "lte":
      return `<= ${value}`;
    case "length_gt":
      return `length > ${value}`;
    case "length_gte":
      return `length >= ${value}`;
    case "length_lt":
      return `length < ${value}`;
    case "length_lte":
      return `length <= ${value}`;
    case "is_true":
      return "is true";
    case "is_false":
      return "is false";
    case "in":
      return `in ${JSON.stringify(value)}`;
    case "not_in":
      return `not in ${JSON.stringify(value)}`;
    case "contains":
      return `contains ${JSON.stringify(value)}`;
    case "matches":
      return `matches ${value}`;
    default:
      return op;
  }
}

function formatTools(tools: string | string[] | undefined): string {
  if (!tools) return "any";
  if (typeof tools === "string") return tools;
  return tools.join(", ");
}

/** True when a gate condition references a fact from a different step */
function isCrossStepRef(factRef: string): boolean {
  return factRef.includes(".");
}

// ── Sub-components ──────────────────────────────────────────────────────

function Connector({ children }: { children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center">
      <div className="w-px h-6 bg-border" />
      {children && (
        <>
          {children}
          <div className="w-px h-6 bg-border" />
        </>
      )}
      {/* Arrow head */}
      <div className="w-0 h-0 border-l-[5px] border-r-[5px] border-t-[6px] border-l-transparent border-r-transparent border-t-border" />
    </div>
  );
}

function GateNode({ gate }: { gate: Gate }) {
  const failStrategy = gate.on_fail ?? "retry";
  return (
    <div className="relative flex flex-col items-center">
      {/* Diamond shape */}
      <div className="w-8 h-8 rotate-45 border-2 border-amber-500 dark:border-amber-400 bg-amber-50 dark:bg-amber-950/30" />
      {/* Gate details positioned to the right */}
      <div className="absolute left-1/2 top-1/2 -translate-y-1/2 ml-7 pl-3 border-l-2 border-dashed border-amber-400 dark:border-amber-500/60 min-w-[200px] max-w-[280px]">
        <div className="flex items-center gap-1.5 mb-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400">
            Gate
          </span>
          <Badge
            variant="outline"
            className={
              failStrategy === "abort"
                ? "text-[9px] px-1 py-0 border-red-300 text-red-600 dark:border-red-700 dark:text-red-400"
                : failStrategy === "skip"
                ? "text-[9px] px-1 py-0 border-blue-300 text-blue-600 dark:border-blue-700 dark:text-blue-400"
                : "text-[9px] px-1 py-0 border-amber-300 text-amber-600 dark:border-amber-700 dark:text-amber-400"
            }
          >
            on fail: {failStrategy}
          </Badge>
        </div>
        <ul className="space-y-0.5">
          {gate.conditions.map((cond, i) => (
            <li key={i} className="text-[11px] text-muted-foreground flex items-start gap-1">
              <span className="text-amber-500 mt-px shrink-0">&#x25C6;</span>
              <span>
                <code
                  className={
                    isCrossStepRef(cond.fact)
                      ? "text-purple-600 dark:text-purple-400 font-medium"
                      : "text-foreground/80 font-medium"
                  }
                >
                  {cond.fact}
                </code>{" "}
                <span className="text-muted-foreground">
                  {formatOperator(cond.operator, cond.value)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function StepNode({
  step,
  index,
  total,
}: {
  step: WorkflowStep;
  index: number;
  total: number;
}) {
  const facts = step.required_facts ?? [];
  return (
    <div className="relative w-[340px] border rounded-lg bg-card shadow-sm overflow-hidden">
      {/* Step header */}
      <div className="px-4 py-2.5 border-b bg-muted/40 flex items-center gap-2">
        <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold shrink-0">
          {index + 1}
        </span>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm leading-tight truncate">
            {step.name}
          </div>
          <div className="text-[10px] text-muted-foreground font-mono">
            {step.id}
          </div>
        </div>
      </div>

      {/* Step body */}
      <div className="px-4 py-3 space-y-2.5">
        {step.description && (
          <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">
            {step.description}
          </p>
        )}

        {/* Facts */}
        {facts.length > 0 && (
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
              Required Facts
            </div>
            <div className="space-y-1">
              {facts.map((fact) => (
                <div
                  key={fact.name}
                  className="flex items-center gap-1.5 text-xs"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-400 dark:bg-blue-500 shrink-0" />
                  <code className="font-medium text-foreground/90">
                    {fact.name}
                  </code>
                  <Badge
                    variant="secondary"
                    className="text-[9px] px-1 py-0 font-normal"
                  >
                    {fact.type}
                  </Badge>
                  {fact.default !== undefined && (
                    <span className="text-[10px] text-muted-foreground ml-auto">
                      default: {JSON.stringify(fact.default)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tools */}
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <span className="font-semibold uppercase tracking-wider">Tools:</span>
          <span>{formatTools(step.allowed_tools)}</span>
        </div>
      </div>
    </div>
  );
}

function TerminalNode({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center w-20 h-8 rounded-full border-2 border-primary/40 bg-primary/5 text-[11px] font-semibold text-primary/70 uppercase tracking-wider">
      {label}
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────

interface WorkflowDiagramProps {
  yamlContent: string;
}

export default function WorkflowDiagram({ yamlContent }: WorkflowDiagramProps) {
  const def = parseYaml(yamlContent);

  if (!def || !def.steps || def.steps.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-sm text-muted-foreground">
          Unable to render diagram. Make sure the YAML defines at least one
          step.
        </p>
      </div>
    );
  }

  const steps = def.steps;

  return (
    <div className="overflow-x-auto py-6 px-4">
      <div className="flex flex-col items-center min-w-[400px]">
        {/* Start node */}
        <TerminalNode label="Start" />

        {steps.map((step, idx) => (
          <React.Fragment key={step.id}>
            {/* Connector into step */}
            <Connector />

            {/* Step card */}
            <StepNode step={step} index={idx} total={steps.length} />

            {/* Gate between steps (or before end) */}
            {step.gate && step.gate.conditions.length > 0 && (
              <>
                <div className="w-px h-6 bg-border" />
                <GateNode gate={step.gate} />
              </>
            )}
          </React.Fragment>
        ))}

        {/* Connector into end */}
        <Connector />

        {/* End node */}
        <TerminalNode label="End" />
      </div>
    </div>
  );
}
