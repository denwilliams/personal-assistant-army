import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api, type Workflow, type WorkflowStep } from "../lib/api";

const EMPTY_STEP: WorkflowStep = { title: "", instructions: "" };

export default function WorkflowsPage() {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingWorkflow, setEditingWorkflow] = useState<Workflow | null>(null);
  const [formName, setFormName] = useState("");
  const [formSummary, setFormSummary] = useState("");
  const [formSteps, setFormSteps] = useState<WorkflowStep[]>([
    { ...EMPTY_STEP },
    { ...EMPTY_STEP },
  ]);

  useEffect(() => {
    loadWorkflows();
  }, []);

  const loadWorkflows = async () => {
    try {
      setLoading(true);
      const data = await api.workflows.list();
      setWorkflows(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load workflows");
    } finally {
      setLoading(false);
    }
  };

  const openCreate = () => {
    setEditingWorkflow(null);
    setFormName("");
    setFormSummary("");
    setFormSteps([{ ...EMPTY_STEP }, { ...EMPTY_STEP }]);
    setDialogOpen(true);
  };

  const openEdit = (workflow: Workflow) => {
    setEditingWorkflow(workflow);
    setFormName(workflow.name);
    setFormSummary(workflow.summary);
    setFormSteps(workflow.steps.length ? workflow.steps.map((s) => ({ ...s })) : [{ ...EMPTY_STEP }, { ...EMPTY_STEP }]);
    setDialogOpen(true);
  };

  const addStep = () => setFormSteps((steps) => [...steps, { ...EMPTY_STEP }]);
  const removeStep = (index: number) =>
    setFormSteps((steps) => (steps.length > 1 ? steps.filter((_, i) => i !== index) : steps));
  const moveStep = (index: number, delta: number) => {
    setFormSteps((steps) => {
      const target = index + delta;
      if (target < 0 || target >= steps.length) return steps;
      const next = [...steps];
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  };
  const updateStep = (index: number, patch: Partial<WorkflowStep>) => {
    setFormSteps((steps) => steps.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const cleaned = formSteps
      .map((s) => ({ title: s.title.trim(), instructions: s.instructions.trim() }))
      .filter((s) => s.title.length > 0 && s.instructions.length > 0);

    if (cleaned.length < 2) {
      setError("A workflow needs at least 2 complete steps (title and instructions).");
      return;
    }

    try {
      if (editingWorkflow) {
        await api.workflows.update(editingWorkflow.id, {
          summary: formSummary,
          steps: cleaned,
        });
      } else {
        await api.workflows.create({
          name: formName,
          summary: formSummary,
          steps: cleaned,
        });
      }
      setDialogOpen(false);
      await loadWorkflows();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save workflow");
    }
  };

  const handleDelete = async (workflow: Workflow) => {
    if (!confirm(`Delete workflow "${workflow.name}"?`)) return;
    try {
      await api.workflows.delete(workflow.id);
      await loadWorkflows();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete workflow");
    }
  };

  const handlePromote = async (workflow: Workflow) => {
    try {
      await api.workflows.promote(workflow.id);
      await loadWorkflows();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to promote workflow");
    }
  };

  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center gap-2 border-b px-6 py-3">
        <SidebarTrigger />
        <h1 className="text-lg font-semibold">Workflows</h1>
        <div className="ml-auto">
          <Button size="sm" onClick={openCreate}>New Workflow</Button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto px-6 py-8">
        {error && (
          <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-lg p-4 mb-6">
            <p className="text-red-800 dark:text-red-400 text-sm">{error}</p>
          </div>
        )}

        {loading && workflows.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-muted-foreground">Loading workflows...</p>
          </div>
        ) : workflows.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-muted-foreground mb-2">No workflows yet</p>
            <p className="text-xs text-muted-foreground mb-4">
              Workflows are ordered, sequential processes your agents can follow step by step.
            </p>
            <Button onClick={openCreate}>Create Your First Workflow</Button>
          </div>
        ) : (
          <div className="grid gap-4">
            {workflows.map((workflow) => (
              <div
                key={workflow.id}
                className="bg-card rounded-lg border border-border p-5"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold text-card-foreground">{workflow.name}</h3>
                      <Badge variant={workflow.scope === "user" ? "default" : "secondary"}>
                        {workflow.scope === "user" ? "User" : "Agent"}
                      </Badge>
                      <Badge variant="outline">{workflow.author}</Badge>
                      <Badge variant="outline">{workflow.steps.length} steps</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground mb-2">{workflow.summary}</p>
                    <p className="text-xs text-muted-foreground">
                      Updated {new Date(workflow.updated_at).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    {workflow.scope === "agent" && (
                      <Button variant="outline" size="sm" onClick={() => handlePromote(workflow)}>
                        Promote
                      </Button>
                    )}
                    <Button variant="outline" size="sm" onClick={() => openEdit(workflow)}>
                      Edit
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => handleDelete(workflow)}>
                      Delete
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <form onSubmit={handleSave}>
            <DialogHeader>
              <DialogTitle>{editingWorkflow ? "Edit Workflow" : "New Workflow"}</DialogTitle>
              <DialogDescription>
                {editingWorkflow
                  ? "Update the workflow summary and steps."
                  : "Create a new user-level workflow with ordered steps."}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              {!editingWorkflow && (
                <div>
                  <label className="block text-sm font-medium mb-2">Name</label>
                  <input
                    type="text"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="e.g., bug-triage"
                    required
                    className="w-full px-3 py-2 border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring bg-background text-foreground"
                  />
                </div>
              )}
              <div>
                <label className="block text-sm font-medium mb-2">Summary</label>
                <input
                  type="text"
                  value={formSummary}
                  onChange={(e) => setFormSummary(e.target.value)}
                  placeholder="Use when... (when to start this workflow)"
                  required
                  className="w-full px-3 py-2 border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring bg-background text-foreground"
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-sm font-medium">Steps</label>
                  <Button type="button" size="sm" variant="outline" onClick={addStep}>
                    Add Step
                  </Button>
                </div>
                <div className="space-y-3">
                  {formSteps.map((step, index) => (
                    <div
                      key={index}
                      className="border border-border rounded-md p-3 bg-muted/30 space-y-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-muted-foreground">
                          Step {index + 1}
                        </span>
                        <div className="flex gap-1">
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => moveStep(index, -1)}
                            disabled={index === 0}
                          >
                            ↑
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => moveStep(index, 1)}
                            disabled={index === formSteps.length - 1}
                          >
                            ↓
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => removeStep(index)}
                            disabled={formSteps.length <= 1}
                          >
                            Remove
                          </Button>
                        </div>
                      </div>
                      <input
                        type="text"
                        value={step.title}
                        onChange={(e) => updateStep(index, { title: e.target.value })}
                        placeholder="Step title (e.g., 'Gather bug details')"
                        className="w-full px-3 py-2 border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring bg-background text-foreground text-sm"
                      />
                      <textarea
                        value={step.instructions}
                        onChange={(e) => updateStep(index, { instructions: e.target.value })}
                        placeholder="Detailed instructions for this step..."
                        rows={3}
                        className="w-full px-3 py-2 border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring bg-background text-foreground font-mono text-sm"
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit">
                {editingWorkflow ? "Save Changes" : "Create Workflow"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
