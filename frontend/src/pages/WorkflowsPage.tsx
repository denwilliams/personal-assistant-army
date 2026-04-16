import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  api,
  type Workflow,
  type ValidateWorkflowResult,
} from "../lib/api";
import WorkflowDiagram from "../components/WorkflowDiagram";

const EXAMPLE_YAML = `name: My Workflow
description: >
  Describe what this workflow guides the agent through.
version: "1.0.0"
tags: ["example"]
timeout_minutes: 15

steps:
  - id: collect_info
    name: Collect information
    description: >
      Ask the user for the details you need.
    required_facts:
      - name: topic
        type: string
        description: What this is about
        ask: "What is this about?"
    allowed_tools: conversation
    gate:
      conditions:
        - fact: topic
          operator: exists
          message: "Topic is required."
`;

export default function WorkflowsPage() {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingWorkflow, setEditingWorkflow] = useState<Workflow | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  // Form state
  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formYaml, setFormYaml] = useState("");
  const [saving, setSaving] = useState(false);
  const [validationResult, setValidationResult] =
    useState<ValidateWorkflowResult | null>(null);
  const [validating, setValidating] = useState(false);

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
    setFormDescription("");
    setFormYaml(EXAMPLE_YAML);
    setValidationResult(null);
    setDialogOpen(true);
  };

  const openEdit = (workflow: Workflow) => {
    setEditingWorkflow(workflow);
    setFormName(workflow.name);
    setFormDescription(workflow.description || "");
    setFormYaml(workflow.yaml_content);
    setValidationResult(null);
    setDialogOpen(true);
  };

  const handleValidate = async () => {
    setValidating(true);
    setValidationResult(null);
    try {
      const result = await api.workflows.validate(formYaml);
      setValidationResult(result);
    } catch (err) {
      setValidationResult({
        valid: false,
        error: err instanceof Error ? err.message : "Validation failed",
      });
    } finally {
      setValidating(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);

    try {
      if (editingWorkflow) {
        await api.workflows.update(editingWorkflow.id, {
          name: formName,
          description: formDescription || undefined,
          yaml_content: formYaml,
        });
      } else {
        await api.workflows.create({
          name: formName,
          description: formDescription || undefined,
          yaml_content: formYaml,
        });
      }
      setDialogOpen(false);
      await loadWorkflows();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save workflow");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (workflow: Workflow) => {
    if (!confirm(`Delete workflow "${workflow.name}"? This cannot be undone.`)) return;
    try {
      await api.workflows.delete(workflow.id);
      await loadWorkflows();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete workflow");
    }
  };

  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center gap-2 border-b px-6 py-3">
        <SidebarTrigger />
        <h1 className="text-lg font-semibold">Workflows</h1>
        <div className="ml-auto">
          <Button size="sm" onClick={openCreate}>
            New Workflow
          </Button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto px-6 py-8">
        <p className="text-sm text-muted-foreground mb-6 max-w-2xl">
          Workflows give agents a structured process to follow. Each workflow is a
          sequence of steps with required facts to collect and gate conditions that
          must pass before advancing. Assign workflows to agents on the{" "}
          <a href="/agents" className="text-blue-600 dark:text-blue-400 hover:underline">
            Agents page
          </a>
          .
        </p>

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
            <p className="text-muted-foreground mb-4">No workflows yet</p>
            <Button onClick={openCreate}>Create Your First Workflow</Button>
          </div>
        ) : (
          <div className="grid gap-4">
            {workflows.map((workflow) => {
              const isExpanded = expandedId === workflow.id;
              return (
                <div
                  key={workflow.id}
                  className="bg-card rounded-lg border border-border"
                >
                  <div className="p-5">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className="font-medium text-card-foreground">
                            {workflow.name}
                          </span>
                          <Badge variant="secondary">v{workflow.version}</Badge>
                          {workflow.tags?.map((tag) => (
                            <Badge key={tag} variant="outline">
                              {tag}
                            </Badge>
                          ))}
                        </div>
                        {workflow.description && (
                          <p className="text-sm text-muted-foreground mb-2">
                            {workflow.description}
                          </p>
                        )}
                        <div className="flex gap-4 text-xs text-muted-foreground">
                          <span>Timeout: {workflow.timeout_minutes}m</span>
                          <span>
                            Updated:{" "}
                            {new Date(workflow.updated_at).toLocaleString()}
                          </span>
                        </div>
                      </div>
                      <div className="flex gap-2 shrink-0">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            setExpandedId(isExpanded ? null : workflow.id)
                          }
                        >
                          {isExpanded ? "Hide" : "View"}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openEdit(workflow)}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleDelete(workflow)}
                        >
                          Delete
                        </Button>
                      </div>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="border-t border-border px-5 py-4">
                      <Tabs defaultValue="diagram">
                        <TabsList>
                          <TabsTrigger value="diagram">Diagram</TabsTrigger>
                          <TabsTrigger value="yaml">YAML</TabsTrigger>
                        </TabsList>
                        <TabsContent value="diagram">
                          <WorkflowDiagram yamlContent={workflow.yaml_content} />
                        </TabsContent>
                        <TabsContent value="yaml">
                          <pre className="text-xs font-mono bg-muted p-4 rounded overflow-x-auto whitespace-pre-wrap mt-2">
                            {workflow.yaml_content}
                          </pre>
                        </TabsContent>
                      </Tabs>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
          <form
            onSubmit={handleSave}
            className="flex flex-col flex-1 min-h-0"
          >
            <DialogHeader>
              <DialogTitle>
                {editingWorkflow ? "Edit Workflow" : "New Workflow"}
              </DialogTitle>
              <DialogDescription>
                Define the workflow using YAML. Use the Validate button to check
                your YAML before saving.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4 overflow-y-auto flex-1 min-h-0">
              <div>
                <label className="block text-sm font-medium mb-2">Name</label>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="e.g., Schedule Meeting"
                  required
                  className="w-full px-3 py-2 border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring bg-background text-foreground"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">
                  Description (optional)
                </label>
                <input
                  type="text"
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  placeholder="Brief description (falls back to YAML description)"
                  className="w-full px-3 py-2 border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring bg-background text-foreground"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-sm font-medium">
                    YAML Definition
                  </label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleValidate}
                    disabled={validating || !formYaml.trim()}
                  >
                    {validating ? "Validating..." : "Validate"}
                  </Button>
                </div>
                <textarea
                  value={formYaml}
                  onChange={(e) => {
                    setFormYaml(e.target.value);
                    setValidationResult(null);
                  }}
                  rows={18}
                  required
                  spellCheck={false}
                  className="w-full px-3 py-2 border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring bg-background text-foreground font-mono text-xs"
                />
              </div>

              {validationResult && (
                <div
                  className={
                    validationResult.valid
                      ? "rounded-md border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/20 p-3"
                      : "rounded-md border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/20 p-3"
                  }
                >
                  {validationResult.valid && validationResult.definition ? (
                    <div className="text-sm">
                      <p className="font-medium text-green-800 dark:text-green-400 mb-2">
                        Valid workflow
                      </p>
                      <div className="text-xs text-muted-foreground space-y-1">
                        <div>
                          <strong>{validationResult.definition.name}</strong> (v
                          {validationResult.definition.version})
                        </div>
                        <div>{validationResult.definition.description}</div>
                        <div className="mt-2">
                          <strong>Steps ({validationResult.definition.steps.length}):</strong>
                          <ul className="list-disc list-inside mt-1">
                            {validationResult.definition.steps.map((step) => (
                              <li key={step.id}>
                                <span className="font-medium">{step.name}</span>{" "}
                                — {step.facts_count} fact
                                {step.facts_count !== 1 ? "s" : ""},{" "}
                                {step.gate_conditions_count} gate condition
                                {step.gate_conditions_count !== 1 ? "s" : ""}
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-sm">
                      <p className="font-medium text-red-800 dark:text-red-400 mb-1">
                        Invalid workflow
                      </p>
                      <p className="text-xs text-red-700 dark:text-red-400">
                        {validationResult.error}
                      </p>
                      {validationResult.path && (
                        <p className="text-xs text-muted-foreground font-mono mt-1">
                          at: {validationResult.path}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving
                  ? "Saving..."
                  : editingWorkflow
                  ? "Save Changes"
                  : "Create Workflow"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
