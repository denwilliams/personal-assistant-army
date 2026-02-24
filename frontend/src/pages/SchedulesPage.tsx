import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api, type Schedule, type ScheduleExecution } from "../lib/api";

interface Agent {
  id: number;
  slug: string;
  name: string;
}

export default function SchedulesPage() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<Schedule | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [executions, setExecutions] = useState<ScheduleExecution[]>([]);

  // Form
  const [formAgentSlug, setFormAgentSlug] = useState("");
  const [formPrompt, setFormPrompt] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formType, setFormType] = useState<"once" | "interval" | "cron">("interval");
  const [formValue, setFormValue] = useState("");
  const [formConversationMode, setFormConversationMode] = useState<"new" | "continue">("new");

  useEffect(() => {
    loadSchedules();
    loadAgents();
  }, []);

  const loadSchedules = async () => {
    try {
      setLoading(true);
      const data = await api.schedules.list();
      setSchedules(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load schedules");
    } finally {
      setLoading(false);
    }
  };

  const loadAgents = async () => {
    try {
      const data = await api.agents.list();
      setAgents(data);
    } catch {
      // Agents list is supplementary
    }
  };

  const getAgentName = (agentId: number) => {
    const agent = agents.find((a) => a.id === agentId);
    return agent?.name || `Agent #${agentId}`;
  };

  const getAgentSlug = (agentId: number) => {
    const agent = agents.find((a) => a.id === agentId);
    return agent?.slug || "";
  };

  const openCreate = () => {
    setEditingSchedule(null);
    setFormAgentSlug(agents[0]?.slug || "");
    setFormPrompt("");
    setFormDescription("");
    setFormType("interval");
    setFormValue("");
    setFormConversationMode("new");
    setDialogOpen(true);
  };

  const openEdit = (schedule: Schedule) => {
    setEditingSchedule(schedule);
    setFormAgentSlug(getAgentSlug(schedule.agent_id));
    setFormPrompt(schedule.prompt);
    setFormDescription(schedule.description || "");
    setFormType(schedule.schedule_type);
    setFormValue(schedule.schedule_value);
    setFormConversationMode(schedule.conversation_mode);
    setDialogOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    try {
      if (editingSchedule) {
        await api.schedules.update(editingSchedule.id, {
          prompt: formPrompt,
          description: formDescription || undefined,
          schedule_type: formType,
          schedule_value: formValue,
        });
      } else {
        await api.schedules.create(formAgentSlug, {
          prompt: formPrompt,
          description: formDescription || undefined,
          schedule_type: formType,
          schedule_value: formValue,
          conversation_mode: formConversationMode,
        });
      }
      setDialogOpen(false);
      await loadSchedules();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save schedule");
    }
  };

  const handleToggle = async (schedule: Schedule) => {
    try {
      await api.schedules.toggle(schedule.id, !schedule.enabled);
      await loadSchedules();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to toggle schedule");
    }
  };

  const handleDelete = async (schedule: Schedule) => {
    if (!confirm("Delete this schedule?")) return;
    try {
      await api.schedules.delete(schedule.id);
      await loadSchedules();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete schedule");
    }
  };

  const toggleExecutions = async (scheduleId: number) => {
    if (expandedId === scheduleId) {
      setExpandedId(null);
      setExecutions([]);
      return;
    }
    try {
      const data = await api.schedules.getExecutions(scheduleId);
      setExecutions(data);
      setExpandedId(scheduleId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load executions");
    }
  };

  const formatScheduleValue = (type: string, value: string) => {
    if (type === "once") {
      return new Date(value).toLocaleString();
    } else if (type === "interval") {
      const ms = parseInt(value);
      if (ms >= 3600000) return `Every ${Math.round(ms / 3600000)}h`;
      return `Every ${Math.round(ms / 60000)}m`;
    }
    return value;
  };

  const typeColor = (type: string) => {
    switch (type) {
      case "once": return "secondary";
      case "interval": return "default";
      case "cron": return "outline";
      default: return "secondary" as const;
    }
  };

  const statusColor = (status: string) => {
    switch (status) {
      case "success": return "text-green-600 dark:text-green-400";
      case "error": return "text-red-600 dark:text-red-400";
      case "running": return "text-blue-600 dark:text-blue-400";
      case "retry": return "text-yellow-600 dark:text-yellow-400";
      default: return "text-muted-foreground";
    }
  };

  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center gap-2 border-b px-6 py-3">
        <SidebarTrigger />
        <h1 className="text-lg font-semibold">Schedules</h1>
        <div className="ml-auto">
          <Button size="sm" onClick={openCreate} disabled={agents.length === 0}>
            New Schedule
          </Button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto px-6 py-8">
        {error && (
          <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-lg p-4 mb-6">
            <p className="text-red-800 dark:text-red-400 text-sm">{error}</p>
          </div>
        )}

        {loading && schedules.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-muted-foreground">Loading schedules...</p>
          </div>
        ) : schedules.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-muted-foreground mb-4">No schedules yet</p>
            <Button onClick={openCreate} disabled={agents.length === 0}>
              Create Your First Schedule
            </Button>
          </div>
        ) : (
          <div className="grid gap-4">
            {schedules.map((schedule) => (
              <div key={schedule.id} className="bg-card rounded-lg border border-border">
                <div className="p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      <Switch
                        checked={schedule.enabled}
                        onCheckedChange={() => handleToggle(schedule)}
                        className="mt-1"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-medium text-card-foreground">
                            {getAgentName(schedule.agent_id)}
                          </span>
                          <Badge variant={typeColor(schedule.schedule_type) as any}>
                            {schedule.schedule_type}
                          </Badge>
                          {!schedule.enabled && (
                            <Badge variant="secondary">Paused</Badge>
                          )}
                        </div>
                        {schedule.description && (
                          <p className="text-sm text-muted-foreground mb-1">
                            {schedule.description}
                          </p>
                        )}
                        <p className="text-sm text-muted-foreground line-clamp-2">
                          {schedule.prompt}
                        </p>
                        <div className="flex gap-4 mt-2 text-xs text-muted-foreground">
                          <span>{formatScheduleValue(schedule.schedule_type, schedule.schedule_value)}</span>
                          {schedule.next_run_at && (
                            <span>Next: {new Date(Number(schedule.next_run_at)).toLocaleString()}</span>
                          )}
                          {schedule.last_run_at && (
                            <span>Last: {new Date(Number(schedule.last_run_at)).toLocaleString()}</span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={async () => {
                          try {
                            await api.schedules.trigger(schedule.id);
                            loadSchedules();
                          } catch {}
                        }}
                      >
                        Run Now
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => toggleExecutions(schedule.id)}
                      >
                        {expandedId === schedule.id ? "Hide" : "History"}
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => openEdit(schedule)}>
                        Edit
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => handleDelete(schedule)}>
                        Delete
                      </Button>
                    </div>
                  </div>
                </div>

                {/* Execution History */}
                {expandedId === schedule.id && (
                  <div className="border-t border-border px-5 py-4">
                    <h4 className="text-sm font-medium mb-3">Recent Executions</h4>
                    {executions.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No executions yet</p>
                    ) : (
                      <div className="space-y-2">
                        {executions.slice(0, 10).map((exec) => (
                          <div
                            key={exec.id}
                            className="flex items-center gap-3 text-sm py-1"
                          >
                            <span className={`font-medium ${statusColor(exec.status)}`}>
                              {exec.status}
                            </span>
                            <span className="text-muted-foreground">
                              {new Date(Number(exec.started_at)).toLocaleString()}
                            </span>
                            {exec.completed_at && (
                              <span className="text-muted-foreground">
                                ({Math.round((Number(exec.completed_at) - Number(exec.started_at)) / 1000)}s)
                              </span>
                            )}
                            {exec.error_message && (
                              <span className="text-red-600 dark:text-red-400 truncate flex-1">
                                {exec.error_message}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <form onSubmit={handleSave}>
            <DialogHeader>
              <DialogTitle>{editingSchedule ? "Edit Schedule" : "New Schedule"}</DialogTitle>
              <DialogDescription>
                {editingSchedule
                  ? "Update the schedule configuration."
                  : "Schedule a recurring task for an agent."}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              {!editingSchedule && (
                <div>
                  <label className="block text-sm font-medium mb-2">Agent</label>
                  <select
                    value={formAgentSlug}
                    onChange={(e) => setFormAgentSlug(e.target.value)}
                    required
                    className="w-full px-3 py-2 border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring bg-background text-foreground"
                  >
                    {agents.map((a) => (
                      <option key={a.slug} value={a.slug}>{a.name}</option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium mb-2">Prompt</label>
                <textarea
                  value={formPrompt}
                  onChange={(e) => setFormPrompt(e.target.value)}
                  placeholder="The message to send to the agent"
                  required
                  rows={3}
                  className="w-full px-3 py-2 border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring bg-background text-foreground"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Description (optional)</label>
                <input
                  type="text"
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  placeholder="Brief description"
                  className="w-full px-3 py-2 border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring bg-background text-foreground"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-2">Schedule Type</label>
                  <select
                    value={formType}
                    onChange={(e) => setFormType(e.target.value as any)}
                    className="w-full px-3 py-2 border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring bg-background text-foreground"
                  >
                    <option value="once">Once</option>
                    <option value="interval">Interval</option>
                    <option value="cron">Cron</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">
                    {formType === "once" ? "Date/Time" : formType === "interval" ? "Interval (ms)" : "Cron Expression"}
                  </label>
                  <input
                    type={formType === "once" ? "datetime-local" : "text"}
                    value={formValue}
                    onChange={(e) => setFormValue(
                      formType === "once"
                        ? new Date(e.target.value).toISOString()
                        : e.target.value
                    )}
                    placeholder={
                      formType === "interval"
                        ? "e.g., 3600000 (1 hour)"
                        : formType === "cron"
                          ? "e.g., 0 9 * * *"
                          : ""
                    }
                    required
                    className="w-full px-3 py-2 border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring bg-background text-foreground"
                  />
                </div>
              </div>

              {!editingSchedule && (
                <div>
                  <label className="block text-sm font-medium mb-2">Conversation Mode</label>
                  <select
                    value={formConversationMode}
                    onChange={(e) => setFormConversationMode(e.target.value as any)}
                    className="w-full px-3 py-2 border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring bg-background text-foreground"
                  >
                    <option value="new">New conversation each time</option>
                    <option value="continue">Continue existing conversation</option>
                  </select>
                </div>
              )}
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit">
                {editingSchedule ? "Save Changes" : "Create Schedule"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
