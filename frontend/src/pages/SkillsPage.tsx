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
import { api, type Skill } from "../lib/api";

export default function SkillsPage() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingSkill, setEditingSkill] = useState<Skill | null>(null);
  const [formName, setFormName] = useState("");
  const [formSummary, setFormSummary] = useState("");
  const [formContent, setFormContent] = useState("");

  useEffect(() => {
    loadSkills();
  }, []);

  const loadSkills = async () => {
    try {
      setLoading(true);
      const data = await api.skills.list();
      setSkills(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load skills");
    } finally {
      setLoading(false);
    }
  };

  const openCreate = () => {
    setEditingSkill(null);
    setFormName("");
    setFormSummary("");
    setFormContent("");
    setDialogOpen(true);
  };

  const openEdit = (skill: Skill) => {
    setEditingSkill(skill);
    setFormName(skill.name);
    setFormSummary(skill.summary);
    setFormContent(skill.content);
    setDialogOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    try {
      if (editingSkill) {
        await api.skills.update(editingSkill.id, {
          summary: formSummary,
          content: formContent,
        });
      } else {
        await api.skills.create({
          name: formName,
          summary: formSummary,
          content: formContent,
        });
      }
      setDialogOpen(false);
      await loadSkills();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save skill");
    }
  };

  const handleDelete = async (skill: Skill) => {
    if (!confirm(`Delete skill "${skill.name}"?`)) return;
    try {
      await api.skills.delete(skill.id);
      await loadSkills();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete skill");
    }
  };

  const handlePromote = async (skill: Skill) => {
    try {
      await api.skills.promote(skill.id);
      await loadSkills();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to promote skill");
    }
  };

  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center gap-2 border-b px-6 py-3">
        <SidebarTrigger />
        <h1 className="text-lg font-semibold">Skills</h1>
        <div className="ml-auto">
          <Button size="sm" onClick={openCreate}>New Skill</Button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto px-6 py-8">
        {error && (
          <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-lg p-4 mb-6">
            <p className="text-red-800 dark:text-red-400 text-sm">{error}</p>
          </div>
        )}

        {loading && skills.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-muted-foreground">Loading skills...</p>
          </div>
        ) : skills.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-muted-foreground mb-4">No skills yet</p>
            <Button onClick={openCreate}>Create Your First Skill</Button>
          </div>
        ) : (
          <div className="grid gap-4">
            {skills.map((skill) => (
              <div
                key={skill.id}
                className="bg-card rounded-lg border border-border p-5"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold text-card-foreground">{skill.name}</h3>
                      <Badge variant={skill.scope === "user" ? "default" : "secondary"}>
                        {skill.scope === "user" ? "User" : "Agent"}
                      </Badge>
                      <Badge variant="outline">
                        {skill.author}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground mb-2">{skill.summary}</p>
                    <p className="text-xs text-muted-foreground">
                      Updated {new Date(skill.updated_at).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    {skill.scope === "agent" && (
                      <Button variant="outline" size="sm" onClick={() => handlePromote(skill)}>
                        Promote
                      </Button>
                    )}
                    <Button variant="outline" size="sm" onClick={() => openEdit(skill)}>
                      Edit
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => handleDelete(skill)}>
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
        <DialogContent className="max-w-2xl">
          <form onSubmit={handleSave}>
            <DialogHeader>
              <DialogTitle>{editingSkill ? "Edit Skill" : "New Skill"}</DialogTitle>
              <DialogDescription>
                {editingSkill
                  ? "Update the skill content and summary."
                  : "Create a new user-level skill."}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              {!editingSkill && (
                <div>
                  <label className="block text-sm font-medium mb-2">Name</label>
                  <input
                    type="text"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="e.g., code-review"
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
                  placeholder="Brief description of what this skill does"
                  required
                  className="w-full px-3 py-2 border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring bg-background text-foreground"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Content</label>
                <textarea
                  value={formContent}
                  onChange={(e) => setFormContent(e.target.value)}
                  placeholder="Skill content (instructions, templates, etc.)"
                  required
                  rows={10}
                  className="w-full px-3 py-2 border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring bg-background text-foreground font-mono text-sm"
                />
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit">
                {editingSkill ? "Save Changes" : "Create Skill"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
