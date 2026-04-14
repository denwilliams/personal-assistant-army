import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Sparkles, Send, Save, Copy, Check, AlertCircle, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Textarea } from "@/components/ui/textarea";
import { api, type GenerateWorkflowResult, type WorkflowBuilderMessage } from "../lib/api";

const EXAMPLE_PROMPTS = [
  {
    title: "Schedule a meeting",
    prompt:
      "Guide me through scheduling a 30-minute meeting. Collect the title, attendees (email addresses), preferred time window, then confirm with me before creating the calendar event.",
  },
  {
    title: "Weekly status report",
    prompt:
      "Build a workflow that walks me through writing my weekly status report: what I shipped this week, what's blocked, what's next week's focus. Finish by emailing it to my manager after I confirm.",
  },
  {
    title: "Triage a bug report",
    prompt:
      "Create a workflow to triage a bug report. Capture the reproduction steps, affected users, severity (low/medium/high/critical), and the owning team. Only allow advancing once severity is set.",
  },
  {
    title: "Plan a trip",
    prompt:
      "Help me plan a trip by collecting destination, travel dates, budget, and travel style (adventure, relaxation, culture). Then search for flights and hotels, and summarise a proposed itinerary for my approval.",
  },
  {
    title: "Interview feedback",
    prompt:
      "Walk an interviewer through capturing feedback after a candidate interview: role, candidate name, technical score 1-5, communication score 1-5, hire recommendation (strong_yes/yes/no/strong_no), and written justification.",
  },
  {
    title: "Expense submission",
    prompt:
      "Guide me through submitting an expense report. Collect expense line items (date, vendor, amount, category), the business purpose, and the approver's email. Validate the email format before submitting.",
  },
];

type TurnStatus = "pending" | "valid" | "invalid" | "no_yaml";

interface BuilderTurn {
  id: string;
  userInput: string;
  assistantMessage: string;
  yaml: string;
  status: TurnStatus;
  validationError?: string;
  validationPath?: string;
  model?: string;
}

function turnId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function parseWorkflowName(yaml: string): string | null {
  const match = yaml.match(/^name\s*:\s*(.+)$/m);
  if (!match || !match[1]) return null;
  return match[1].trim().replace(/^["']|["']$/g, "");
}

export default function WorkflowBuilderPage() {
  const navigate = useNavigate();
  const [turns, setTurns] = useState<BuilderTurn[]>([]);
  const [input, setInput] = useState("");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [copiedTurnId, setCopiedTurnId] = useState<string | null>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);

  const latestValidYaml =
    [...turns].reverse().find((t) => t.status === "valid")?.yaml || "";

  useEffect(() => {
    // Auto-scroll transcript to the bottom when new turns arrive.
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [turns, generating]);

  const usePrompt = (prompt: string) => {
    setInput(prompt);
    setError(null);
  };

  const handleGenerate = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim() || generating) return;

    const description = input.trim();
    const history: WorkflowBuilderMessage[] = turns.flatMap((t) => [
      { role: "user" as const, content: t.userInput },
      {
        role: "assistant" as const,
        content: [t.assistantMessage, t.yaml ? `\`\`\`yaml\n${t.yaml}\n\`\`\`` : ""]
          .filter(Boolean)
          .join("\n\n"),
      },
    ]);
    const currentYaml = latestValidYaml || undefined;

    setError(null);
    setGenerating(true);
    setInput("");

    try {
      const result: GenerateWorkflowResult = await api.workflowBuilder.generate({
        description,
        current_yaml: currentYaml,
        history,
      });

      let status: TurnStatus;
      if (!result.yaml) status = "no_yaml";
      else if (result.valid) status = "valid";
      else status = "invalid";

      setTurns((prev) => [
        ...prev,
        {
          id: turnId(),
          userInput: description,
          assistantMessage: result.message || "",
          yaml: result.yaml,
          status,
          validationError: result.validation_error,
          validationPath: result.validation_path,
          model: result.model,
        },
      ]);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to generate workflow. Please try again."
      );
      // Restore the user's input so they don't lose it
      setInput(description);
    } finally {
      setGenerating(false);
    }
  };

  const handleCopy = async (turn: BuilderTurn) => {
    if (!turn.yaml) return;
    try {
      await navigator.clipboard.writeText(turn.yaml);
      setCopiedTurnId(turn.id);
      setTimeout(() => setCopiedTurnId((cur) => (cur === turn.id ? null : cur)), 1500);
    } catch {
      // ignore clipboard errors
    }
  };

  const handleSave = async (turn: BuilderTurn) => {
    if (!turn.yaml || turn.status !== "valid") return;
    const suggestedName = parseWorkflowName(turn.yaml) || "Untitled Workflow";
    const name = window.prompt("Name for this workflow:", suggestedName);
    if (!name || !name.trim()) return;

    setSaving(true);
    setError(null);
    try {
      await api.workflows.create({
        name: name.trim(),
        yaml_content: turn.yaml,
      });
      navigate("/workflows");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to save workflow"
      );
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleGenerate();
    }
  };

  const showEmptyState = turns.length === 0 && !generating;

  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center gap-2 border-b px-6 py-3">
        <SidebarTrigger />
        <div className="flex items-center gap-2">
          <Wand2 className="size-4 text-primary" />
          <h1 className="text-lg font-semibold">Workflow Builder</h1>
        </div>
        <div className="ml-auto">
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate("/workflows")}
          >
            View Workflows
          </Button>
        </div>
      </header>

      <main className="flex-1 overflow-hidden flex flex-col">
        <div
          ref={transcriptRef}
          className="flex-1 overflow-y-auto px-6 py-6"
        >
          {showEmptyState ? (
            <div className="max-w-3xl mx-auto">
              <div className="text-center mb-8">
                <div className="inline-flex items-center justify-center size-12 rounded-full bg-primary/10 mb-4">
                  <Sparkles className="size-6 text-primary" />
                </div>
                <h2 className="text-2xl font-semibold mb-2">
                  Describe your workflow
                </h2>
                <p className="text-muted-foreground max-w-xl mx-auto">
                  Tell the builder what process you want to guide an agent
                  through. It will generate a validated YAML workflow you can
                  save and assign to any agent.
                </p>
              </div>

              <div className="mb-6">
                <h3 className="text-sm font-medium text-muted-foreground mb-3">
                  Try an example
                </h3>
                <div className="grid gap-2 sm:grid-cols-2">
                  {EXAMPLE_PROMPTS.map((example) => (
                    <button
                      key={example.title}
                      type="button"
                      onClick={() => usePrompt(example.prompt)}
                      className="text-left rounded-lg border border-border bg-card hover:bg-accent hover:border-accent-foreground/20 transition-colors p-4"
                    >
                      <div className="font-medium text-sm mb-1">
                        {example.title}
                      </div>
                      <div className="text-xs text-muted-foreground line-clamp-2">
                        {example.prompt}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto space-y-6">
              {turns.map((turn) => (
                <div key={turn.id} className="space-y-3">
                  {/* User message */}
                  <div className="flex justify-end">
                    <div className="max-w-[85%] rounded-lg bg-primary text-primary-foreground px-4 py-2 text-sm whitespace-pre-wrap">
                      {turn.userInput}
                    </div>
                  </div>

                  {/* Assistant response */}
                  <div className="rounded-lg border border-border bg-card p-4">
                    {turn.assistantMessage && (
                      <p className="text-sm text-card-foreground mb-3 whitespace-pre-wrap">
                        {turn.assistantMessage}
                      </p>
                    )}

                    {turn.yaml ? (
                      <>
                        <div className="flex items-center gap-2 flex-wrap mb-2">
                          {turn.status === "valid" ? (
                            <Badge
                              variant="outline"
                              className="border-green-500/40 text-green-700 dark:text-green-400"
                            >
                              <Check className="size-3 mr-1" />
                              Valid workflow
                            </Badge>
                          ) : (
                            <Badge
                              variant="outline"
                              className="border-red-500/40 text-red-700 dark:text-red-400"
                            >
                              <AlertCircle className="size-3 mr-1" />
                              Invalid YAML
                            </Badge>
                          )}
                          {turn.model && (
                            <span className="text-xs text-muted-foreground">
                              {turn.model}
                            </span>
                          )}
                        </div>

                        <pre className="text-xs font-mono bg-muted p-3 rounded overflow-x-auto whitespace-pre-wrap mb-3">
                          {turn.yaml}
                        </pre>

                        {turn.status === "invalid" && turn.validationError && (
                          <div className="rounded-md border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/20 p-3 mb-3">
                            <p className="text-xs text-red-800 dark:text-red-400">
                              {turn.validationError}
                            </p>
                            {turn.validationPath && (
                              <p className="text-xs text-muted-foreground font-mono mt-1">
                                at: {turn.validationPath}
                              </p>
                            )}
                            <p className="text-xs text-muted-foreground mt-2">
                              Tell the builder what to fix in the next message.
                            </p>
                          </div>
                        )}

                        <div className="flex gap-2 flex-wrap">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => handleCopy(turn)}
                          >
                            {copiedTurnId === turn.id ? (
                              <>
                                <Check className="size-3.5 mr-1" />
                                Copied
                              </>
                            ) : (
                              <>
                                <Copy className="size-3.5 mr-1" />
                                Copy YAML
                              </>
                            )}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => handleSave(turn)}
                            disabled={turn.status !== "valid" || saving}
                          >
                            <Save className="size-3.5 mr-1" />
                            {saving ? "Saving..." : "Save as workflow"}
                          </Button>
                        </div>
                      </>
                    ) : (
                      <div className="rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 p-3">
                        <p className="text-xs text-amber-800 dark:text-amber-400">
                          The builder didn't return YAML for this request. Try
                          rephrasing or adding more detail.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {generating && (
                <div className="flex justify-start">
                  <div className="rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground flex items-center gap-2">
                    <div className="animate-spin rounded-full size-4 border-2 border-primary border-t-transparent" />
                    Generating workflow...
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {error && (
          <div className="border-t border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/20 px-6 py-3">
            <p className="text-sm text-red-800 dark:text-red-400 max-w-3xl mx-auto">
              {error}
            </p>
          </div>
        )}

        <form
          onSubmit={handleGenerate}
          className="border-t border-border px-6 py-4"
        >
          <div className="max-w-3xl mx-auto">
            <div className="flex gap-2 items-end">
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={
                  turns.length === 0
                    ? "Describe the workflow you want to build..."
                    : "Refine the workflow, or describe a new one..."
                }
                rows={3}
                disabled={generating}
                className="flex-1 resize-none"
              />
              <Button
                type="submit"
                disabled={!input.trim() || generating}
                className="shrink-0"
              >
                <Send className="size-4 mr-1" />
                {generating ? "Generating..." : "Generate"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Press ⌘/Ctrl + Enter to generate. Follow-up messages refine the
              most recent valid workflow.
            </p>
          </div>
        </form>
      </main>
    </div>
  );
}
