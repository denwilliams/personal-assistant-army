import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useAuth } from "../contexts/AuthContext";
import { api, type AgentMemory, type MemoryCounts, type EmailConfig, type WebhookConfig } from "../lib/api";
import { Badge } from "@/components/ui/badge";

type NotifierChannel = "email" | "webhook" | "pushover";

interface Agent {
  id: number;
  user_id: number;
  slug: string;
  name: string;
  purpose?: string;
  system_prompt: string;
  model?: string;
  internet_search_enabled: boolean;
  is_favorite: boolean;
  pool_type: "personal" | "team";
  domain?: string;
  default_notifier?: NotifierChannel | null;
  default_notifier_destination?: string | null;
  created_at: string;
  updated_at: string;
}

interface McpServer {
  id: number;
  name: string;
  url: string;
}

interface UrlTool {
  id: number;
  name: string;
  description?: string;
  url: string;
  method: string;
}

const BUILT_IN_TOOLS = [
  { id: "memory", name: "Permanent Memory", description: "Long-term memory across conversations" },
  { id: "internet_search", name: "Internet Search", description: "Search the web using Google" },
  { id: "mqtt", name: "MQTT", description: "Publish/subscribe to MQTT topics for IoT and messaging" },
];

export default function AgentsPage() {
  const { user } = useAuth();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [mcpServers, setMcpServers] = useState<McpServer[]>([]);
  const [urlTools, setUrlTools] = useState<UrlTool[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);

  // Form states
  const [formData, setFormData] = useState({
    slug: "",
    name: "",
    purpose: "",
    system_prompt: "",
    model: "openai:gpt-4.1-mini",
    internet_search_enabled: false,
    pool_type: "personal" as "personal" | "team",
    default_notifier: "" as "" | NotifierChannel,
    default_notifier_destination: "",
  });

  // Available notification destinations (for dropdowns)
  const [availableEmails, setAvailableEmails] = useState<EmailConfig[]>([]);
  const [availableWebhooks, setAvailableWebhooks] = useState<WebhookConfig[]>([]);

  const [availableModels, setAvailableModels] = useState<Array<{ id: string; name: string; provider: string }>>([]);

  // Tools and handoffs data for expanded agent
  const [agentTools, setAgentTools] = useState<{
    built_in_tools: string[];
    mcp_tools: number[];
    url_tools: number[];
  } | null>(null);
  const [agentToolAgents, setAgentToolAgents] = useState<number[]>([]);
  const [agentHandoffs, setAgentHandoffs] = useState<number[]>([]);
  const [showMemories, setShowMemories] = useState(false);
  const [memoriesAgentSlug, setMemoriesAgentSlug] = useState<string | null>(null);
  const [memories, setMemories] = useState<AgentMemory[]>([]);
  const [memoryCounts, setMemoryCounts] = useState<MemoryCounts>({ core: 0, working: 0, reference: 0 });
  const [memoryTab, setMemoryTab] = useState<"core" | "working" | "reference">("core");

  useEffect(() => {
    loadAgents();
    loadMcpServers();
    loadUrlTools();
    loadModels();
    loadNotificationDestinations();
  }, []);

  const loadNotificationDestinations = async () => {
    try {
      const settings = await api.notifications.getSettings();
      const emails: any = (settings as any).email_addresses;
      setAvailableEmails(
        Array.isArray(emails)
          ? emails
          : typeof emails === "string"
          ? (() => { try { return JSON.parse(emails); } catch { return []; } })()
          : []
      );
      const urls = settings.webhook_urls;
      setAvailableWebhooks(
        Array.isArray(urls)
          ? urls
          : typeof urls === "string"
          ? (() => { try { return JSON.parse(urls); } catch { return []; } })()
          : []
      );
    } catch {
      // Not fatal - destination dropdowns will just be empty
    }
  };

  const loadModels = async () => {
    try {
      const response = await fetch("/api/models");
      if (response.ok) {
        const data = await response.json();
        setAvailableModels(data);
      }
    } catch (err) {
      console.error("Failed to load models:", err);
    }
  };

  const loadAgents = async () => {
    try {
      setLoading(true);
      const data = await api.agents.list();
      setAgents(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load agents");
    } finally {
      setLoading(false);
    }
  };

  const loadMcpServers = async () => {
    try {
      const data = await api.mcpServers.list();
      setMcpServers(data);
    } catch (err) {
      console.error("Failed to load MCP servers:", err);
    }
  };

  const loadUrlTools = async () => {
    try {
      const data = await api.urlTools.list();
      setUrlTools(data);
    } catch (err) {
      console.error("Failed to load URL tools:", err);
    }
  };

  const loadAgentToolsAndHandoffs = async (slug: string) => {
    try {
      const [tools, agentToolsData, handoffs] = await Promise.all([
        api.agents.getTools(slug),
        api.agents.getAgentTools(slug),
        api.agents.getHandoffs(slug),
      ]);
      setAgentTools(tools);
      setAgentToolAgents(agentToolsData.agent_tool_ids);
      setAgentHandoffs(handoffs.handoff_agent_ids);
    } catch (err) {
      console.error("Failed to load agent tools/handoffs:", err);
    }
  };

  const toggleExpanded = async (slug: string) => {
    if (expandedAgent === slug) {
      setExpandedAgent(null);
      setAgentTools(null);
      setAgentToolAgents([]);
      setAgentHandoffs([]);
    } else {
      setExpandedAgent(slug);
      await loadAgentToolsAndHandoffs(slug);
    }
  };

  const handleCreateAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      await api.agents.create({
        ...formData,
        default_notifier: formData.default_notifier || null,
        default_notifier_destination: formData.default_notifier_destination || null,
      });
      setFormData({
        slug: "",
        name: "",
        purpose: "",
        system_prompt: "",
        model: "openai:gpt-4.1-mini",
        internet_search_enabled: false,
        pool_type: "personal",
        default_notifier: "",
        default_notifier_destination: "",
      });
      setShowCreateForm(false);
      await loadAgents();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create agent");
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingAgent) return;

    setLoading(true);
    setError(null);

    try {
      await api.agents.update(editingAgent.slug, {
        name: formData.name,
        purpose: formData.purpose,
        system_prompt: formData.system_prompt,
        model: formData.model,
        internet_search_enabled: formData.internet_search_enabled,
        default_notifier: formData.default_notifier || null,
        default_notifier_destination: formData.default_notifier_destination || null,
      });
      setEditingAgent(null);
      setFormData({
        slug: "",
        name: "",
        purpose: "",
        system_prompt: "",
        model: "openai:gpt-4.1-mini",
        internet_search_enabled: false,
        pool_type: "personal",
        default_notifier: "",
        default_notifier_destination: "",
      });
      await loadAgents();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update agent");
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteAgent = async (slug: string) => {
    if (!confirm("Are you sure you want to delete this agent?")) return;

    setLoading(true);
    try {
      await api.agents.delete(slug);
      await loadAgents();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete agent");
    } finally {
      setLoading(false);
    }
  };

  const handleToggleBuiltInTool = async (slug: string, toolId: string, enabled: boolean) => {
    try {
      if (enabled) {
        await api.agents.addBuiltInTool(slug, toolId);
      } else {
        await api.agents.removeBuiltInTool(slug, toolId);
      }
      await loadAgentToolsAndHandoffs(slug);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to toggle tool");
    }
  };

  const handleToggleMcpTool = async (slug: string, mcpServerId: number, enabled: boolean) => {
    try {
      if (enabled) {
        await api.agents.addMcpTool(slug, mcpServerId);
      } else {
        await api.agents.removeMcpTool(slug, mcpServerId);
      }
      await loadAgentToolsAndHandoffs(slug);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to toggle MCP tool");
    }
  };

  const handleToggleUrlTool = async (slug: string, urlToolId: number, enabled: boolean) => {
    try {
      if (enabled) {
        await api.agents.addUrlTool(slug, urlToolId);
      } else {
        await api.agents.removeUrlTool(slug, urlToolId);
      }
      await loadAgentToolsAndHandoffs(slug);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to toggle URL tool");
    }
  };

  const handleToggleAgentTool = async (slug: string, toolAgentSlug: string, enabled: boolean) => {
    try {
      if (enabled) {
        await api.agents.addAgentTool(slug, toolAgentSlug);
      } else {
        await api.agents.removeAgentTool(slug, toolAgentSlug);
      }
      await loadAgentToolsAndHandoffs(slug);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to toggle agent tool");
    }
  };

  const handleToggleHandoff = async (slug: string, toAgentSlug: string, enabled: boolean) => {
    try {
      if (enabled) {
        await api.agents.addHandoff(slug, toAgentSlug);
      } else {
        await api.agents.removeHandoff(slug, toAgentSlug);
      }
      await loadAgentToolsAndHandoffs(slug);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to toggle handoff");
    }
  };

  const startEdit = (agent: Agent) => {
    setEditingAgent(agent);
    setFormData({
      slug: agent.slug,
      name: agent.name,
      purpose: agent.purpose || "",
      system_prompt: agent.system_prompt,
      model: agent.model || "openai:gpt-4.1-mini",
      internet_search_enabled: agent.internet_search_enabled,
      pool_type: agent.pool_type,
      default_notifier: agent.default_notifier || "",
      default_notifier_destination: agent.default_notifier_destination || "",
    });
    setShowCreateForm(true);
  };

  const cancelEdit = () => {
    setEditingAgent(null);
    setFormData({
      slug: "",
      name: "",
      purpose: "",
      system_prompt: "",
      model: "openai:gpt-4.1-mini",
      internet_search_enabled: false,
      pool_type: "personal",
      default_notifier: "",
      default_notifier_destination: "",
    });
    setShowCreateForm(false);
  };

  const handleViewMemories = async (slug: string) => {
    try {
      const data = await api.agents.getMemories(slug);
      setMemories(data.memories);
      setMemoryCounts(data.counts);
      setMemoriesAgentSlug(slug);
      setShowMemories(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load memories");
    }
  };

  const handleDeleteMemory = async (key: string) => {
    if (!memoriesAgentSlug) return;
    if (!confirm(`Delete memory "${key}"?`)) return;

    try {
      await api.agents.deleteMemory(memoriesAgentSlug, key);
      await handleViewMemories(memoriesAgentSlug);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete memory");
    }
  };

  const handleChangeTier = async (key: string, tier: string) => {
    if (!memoriesAgentSlug) return;
    try {
      await api.agents.changeMemoryTier(memoriesAgentSlug, key, tier);
      await handleViewMemories(memoriesAgentSlug);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to change tier");
    }
  };

  const handleToggleFavorite = async (slug: string, isFavorite: boolean) => {
    try {
      await api.agents.setFavorite(slug, !isFavorite);
      await loadAgents();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to toggle favorite");
    }
  };

  const getAgentById = (id: number) => agents.find((a) => a.id === id);
  const getMcpServerById = (id: number) => mcpServers.find((m) => m.id === id);

  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center gap-2 border-b px-6 py-3">
        <SidebarTrigger />
        <h1 className="text-lg font-semibold">Agents</h1>
      </header>

      <main className="flex-1 overflow-y-auto px-6 py-8 space-y-6">
        {error && (
          <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
            <p className="text-red-800 dark:text-red-400 text-sm">{error}</p>
          </div>
        )}

        {/* Create/Edit Form */}
        {showCreateForm ? (
          <section className="bg-card rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold text-card-foreground mb-4">
              {editingAgent ? "Edit Agent" : "Create New Agent"}
            </h2>
            <form onSubmit={editingAgent ? handleUpdateAgent : handleCreateAgent} className="space-y-4">
              {!editingAgent && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-card-foreground mb-2">
                      Pool
                    </label>
                    <div className="flex gap-4">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name="pool_type"
                          value="personal"
                          checked={formData.pool_type === "personal"}
                          onChange={() => setFormData({ ...formData, pool_type: "personal" })}
                          className="h-4 w-4"
                        />
                        <span className="text-sm text-card-foreground">Personal</span>
                        <span className="text-xs text-muted-foreground">- only you</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name="pool_type"
                          value="team"
                          checked={formData.pool_type === "team"}
                          onChange={() => setFormData({ ...formData, pool_type: "team" })}
                          className="h-4 w-4"
                        />
                        <span className="text-sm text-card-foreground">Team</span>
                        <span className="text-xs text-muted-foreground">- shared with your domain</span>
                      </label>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-card-foreground mb-2">
                      Slug (URL-friendly ID)
                    </label>
                    <input
                      type="text"
                      value={formData.slug}
                      onChange={(e) =>
                        setFormData({ ...formData, slug: e.target.value.toLowerCase() })
                      }
                      placeholder="e.g., my-assistant"
                      pattern="[a-z0-9-]+"
                      required
                      className="w-full px-3 py-2 border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring bg-background text-foreground"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Lowercase letters, numbers, and hyphens only
                    </p>
                  </div>
                </>
              )}

              <div>
                <label className="block text-sm font-medium text-card-foreground mb-2">
                  Name
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g., My Personal Assistant"
                  required
                  className="w-full px-3 py-2 border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring bg-background text-foreground"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-card-foreground mb-2">
                  Purpose (optional)
                </label>
                <input
                  type="text"
                  value={formData.purpose}
                  onChange={(e) => setFormData({ ...formData, purpose: e.target.value })}
                  placeholder="e.g., Help with coding tasks"
                  className="w-full px-3 py-2 border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring bg-background text-foreground"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-card-foreground mb-2">
                  System Prompt
                </label>
                <textarea
                  value={formData.system_prompt}
                  onChange={(e) =>
                    setFormData({ ...formData, system_prompt: e.target.value })
                  }
                  placeholder="You are a helpful assistant..."
                  required
                  rows={4}
                  className="w-full px-3 py-2 border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring bg-background text-foreground"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-card-foreground mb-2">
                  Model
                </label>
                <input
                  type="text"
                  list="model-options"
                  value={formData.model}
                  onChange={(e) =>
                    setFormData({ ...formData, model: e.target.value })
                  }
                  placeholder="provider:model-id (e.g. openai:gpt-4.1-mini)"
                  className="w-full px-3 py-2 border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring bg-background text-foreground"
                />
                <datalist id="model-options">
                  {availableModels.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} ({m.provider})
                    </option>
                  ))}
                </datalist>
                <p className="mt-1 text-xs text-muted-foreground">
                  Format: provider:model-id. Browse models:{" "}
                  <a href="https://platform.openai.com/docs/models" target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground">OpenAI</a>
                  {" / "}
                  <a href="https://docs.anthropic.com/en/docs/about-claude/models" target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground">Anthropic</a>
                  {" / "}
                  <a href="https://ai.google.dev/gemini-api/docs/models" target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground">Google</a>
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-card-foreground mb-2">
                  Default Notifier
                </label>
                <select
                  value={formData.default_notifier}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      default_notifier: e.target.value as "" | NotifierChannel,
                      default_notifier_destination: "",
                    })
                  }
                  className="w-full px-3 py-2 border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring bg-background text-foreground"
                >
                  <option value="">Any channel (default)</option>
                  <option value="email">Email</option>
                  <option value="webhook">Webhook</option>
                  <option value="pushover">Pushover</option>
                </select>
                <p className="mt-1 text-xs text-muted-foreground">
                  Restrict this agent's notifications to a specific channel. Leave as "Any" to use all enabled channels.
                </p>
              </div>

              {(formData.default_notifier === "email" || formData.default_notifier === "webhook") && (
                <div>
                  <label className="block text-sm font-medium text-card-foreground mb-2">
                    Notifier Destination
                  </label>
                  <select
                    value={formData.default_notifier_destination}
                    onChange={(e) =>
                      setFormData({ ...formData, default_notifier_destination: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring bg-background text-foreground"
                  >
                    <option value="">All {formData.default_notifier === "email" ? "email addresses" : "webhooks"}</option>
                    {formData.default_notifier === "email" &&
                      availableEmails.map((entry) => (
                        <option key={entry.name} value={entry.name}>
                          {entry.name} ({entry.email})
                        </option>
                      ))}
                    {formData.default_notifier === "webhook" &&
                      availableWebhooks.map((entry) => (
                        <option key={entry.name} value={entry.name}>
                          {entry.name}
                        </option>
                      ))}
                  </select>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Optional: target a specific named destination instead of all. Configure destinations in Profile or Team settings.
                  </p>
                </div>
              )}

              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="internet_search"
                  checked={formData.internet_search_enabled}
                  onChange={(e) =>
                    setFormData({ ...formData, internet_search_enabled: e.target.checked })
                  }
                  className="h-4 w-4 focus:ring-ring border-input rounded"
                />
                <label htmlFor="internet_search" className="ml-2 text-sm text-card-foreground">
                  Enable internet search
                </label>
              </div>

              <div className="flex gap-2">
                <Button type="submit" disabled={loading}>
                  {loading ? "Saving..." : editingAgent ? "Update Agent" : "Create Agent"}
                </Button>
                <Button type="button" variant="outline" onClick={cancelEdit}>
                  Cancel
                </Button>
              </div>
            </form>
          </section>
        ) : (
          <div className="flex justify-end">
            <Button onClick={() => setShowCreateForm(true)}>
              Create New Agent
            </Button>
          </div>
        )}

        {/* Agents List */}
        <section className="bg-card rounded-lg shadow">
          {loading && agents.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-muted-foreground">Loading agents...</p>
            </div>
          ) : agents.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-muted-foreground mb-4">No agents yet</p>
              <p className="text-sm text-muted-foreground">
                Create your first agent to get started
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {agents.map((agent) => (
                <div
                  key={agent.id}
                  className={`p-6 ${agent.is_favorite ? 'bg-amber-50 dark:bg-amber-950 border-l-4 border-amber-400 dark:border-amber-600' : ''}`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        {user && agent.user_id === user.id && (
                          <button
                            onClick={() => handleToggleFavorite(agent.slug, agent.is_favorite)}
                            className="text-2xl hover:scale-110 transition-transform"
                            title={agent.is_favorite ? "Remove from favorites" : "Add to favorites"}
                          >
                            {agent.is_favorite ? "⭐" : "☆"}
                          </button>
                        )}
                        <h3 className="text-lg font-semibold text-card-foreground">
                          {agent.name}
                        </h3>
                        <span className="text-xs text-muted-foreground font-mono bg-muted px-2 py-1 rounded">
                          {agent.slug}
                        </span>
                        <span className={`text-xs px-2 py-1 rounded ${
                          agent.pool_type === "team"
                            ? "text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-950"
                            : "text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-950"
                        }`}>
                          {agent.pool_type === "team" ? `Team (${agent.domain})` : "Personal"}
                        </span>
                        {agent.internet_search_enabled && (
                          <span className="text-xs text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950 px-2 py-1 rounded">
                            Search
                          </span>
                        )}
                      </div>
                      {agent.purpose && (
                        <p className="text-sm text-muted-foreground mb-2">{agent.purpose}</p>
                      )}
                      <p className="text-sm text-muted-foreground line-clamp-2">
                        {agent.system_prompt}
                      </p>
                      <p className="text-xs text-muted-foreground mt-2">
                        Created {new Date(agent.created_at).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="flex gap-2 ml-4">
                      <Link to={`/chat/${agent.slug}`}>
                        <Button size="sm">Chat</Button>
                      </Link>
                      {user && agent.user_id === user.id && (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => toggleExpanded(agent.slug)}
                          >
                            {expandedAgent === agent.slug ? "Hide" : "Configure"}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleViewMemories(agent.slug)}
                            disabled={loading}
                          >
                            Memories
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => startEdit(agent)}
                            disabled={loading}
                          >
                            Edit
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleDeleteAgent(agent.slug)}
                            disabled={loading}
                          >
                            Delete
                          </Button>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Expanded Tools and Handoffs Configuration */}
                  {expandedAgent === agent.slug && agentTools && (
                    <div className="mt-6 pt-6 border-t border-border space-y-6">
                      {/* Built-in Tools */}
                      <div>
                        <h4 className="text-sm font-semibold text-card-foreground mb-3">Built-in Tools</h4>
                        <div className="space-y-2">
                          {BUILT_IN_TOOLS.map((tool) => (
                            <div key={tool.id} className="flex items-start gap-3">
                              <input
                                type="checkbox"
                                id={`tool-${agent.slug}-${tool.id}`}
                                checked={agentTools.built_in_tools.includes(tool.id)}
                                onChange={(e) =>
                                  handleToggleBuiltInTool(agent.slug, tool.id, e.target.checked)
                                }
                                className="mt-1 h-4 w-4 focus:ring-ring border-input rounded"
                              />
                              <label
                                htmlFor={`tool-${agent.slug}-${tool.id}`}
                                className="flex-1 cursor-pointer"
                              >
                                <div className="text-sm font-medium text-card-foreground">{tool.name}</div>
                                <div className="text-xs text-muted-foreground">{tool.description}</div>
                              </label>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* MCP Tools */}
                      <div>
                        <h4 className="text-sm font-semibold text-card-foreground mb-3">MCP Server Tools</h4>
                        {mcpServers.length === 0 ? (
                          <p className="text-sm text-muted-foreground">
                            No MCP servers configured. Add MCP servers in your{" "}
                            <Link to="/profile" className="text-blue-600 dark:text-blue-400 hover:underline">
                              profile
                            </Link>
                            .
                          </p>
                        ) : (
                          <div className="space-y-2">
                            {mcpServers.map((server) => (
                              <div key={server.id} className="flex items-start gap-3">
                                <input
                                  type="checkbox"
                                  id={`mcp-${agent.slug}-${server.id}`}
                                  checked={agentTools.mcp_tools.includes(server.id)}
                                  onChange={(e) =>
                                    handleToggleMcpTool(agent.slug, server.id, e.target.checked)
                                  }
                                  className="mt-1 h-4 w-4 focus:ring-ring border-input rounded"
                                />
                                <label
                                  htmlFor={`mcp-${agent.slug}-${server.id}`}
                                  className="flex-1 cursor-pointer"
                                >
                                  <div className="text-sm font-medium text-card-foreground">{server.name}</div>
                                  <div className="text-xs text-muted-foreground font-mono">{server.url}</div>
                                </label>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* URL Tools */}
                      <div>
                        <h4 className="text-sm font-semibold text-card-foreground mb-3">URL Tools</h4>
                        {urlTools.length === 0 ? (
                          <p className="text-sm text-muted-foreground">
                            No URL tools configured. Add URL tools in your{" "}
                            <Link to="/profile" className="text-blue-600 dark:text-blue-400 hover:underline">
                              profile
                            </Link>
                            .
                          </p>
                        ) : (
                          <div className="space-y-2">
                            {urlTools.map((tool) => (
                              <div key={tool.id} className="flex items-start gap-3">
                                <input
                                  type="checkbox"
                                  id={`url-tool-${agent.slug}-${tool.id}`}
                                  checked={agentTools.url_tools.includes(tool.id)}
                                  onChange={(e) =>
                                    handleToggleUrlTool(agent.slug, tool.id, e.target.checked)
                                  }
                                  className="mt-1 h-4 w-4 focus:ring-ring border-input rounded"
                                />
                                <label
                                  htmlFor={`url-tool-${agent.slug}-${tool.id}`}
                                  className="flex-1 cursor-pointer"
                                >
                                  <div className="flex items-center gap-2">
                                    <span className="text-sm font-medium text-card-foreground">{tool.name}</span>
                                    <span className="px-2 py-0.5 text-xs font-mono bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded">
                                      {tool.method}
                                    </span>
                                  </div>
                                  {tool.description && (
                                    <div className="text-xs text-muted-foreground mt-0.5">{tool.description}</div>
                                  )}
                                  <div className="text-xs text-muted-foreground font-mono mt-0.5">{tool.url}</div>
                                </label>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Agent Tools */}
                      <div>
                        <h4 className="text-sm font-semibold text-card-foreground mb-3">Agent Tools</h4>
                        <p className="text-xs text-muted-foreground mb-3">
                          Call other agents as tools (same pool only)
                        </p>
                        {agents.filter((a) => a.id !== agent.id && a.pool_type === agent.pool_type).length === 0 ? (
                          <p className="text-sm text-muted-foreground">
                            No other {agent.pool_type} agents available.
                          </p>
                        ) : (
                          <div className="space-y-2">
                            {agents
                              .filter((a) => a.id !== agent.id && a.pool_type === agent.pool_type)
                              .map((toolAgent) => {
                                const isToolEnabled = agentToolAgents.includes(toolAgent.id);
                                return (
                                  <div key={toolAgent.id} className="flex items-start gap-3">
                                    <input
                                      type="checkbox"
                                      id={`agent-tool-${agent.slug}-${toolAgent.slug}`}
                                      checked={isToolEnabled}
                                      onChange={(e) =>
                                        handleToggleAgentTool(
                                          agent.slug,
                                          toolAgent.slug,
                                          e.target.checked
                                        )
                                      }
                                      className="mt-1 h-4 w-4 focus:ring-ring border-input rounded"
                                    />
                                    <label
                                      htmlFor={`agent-tool-${agent.slug}-${toolAgent.slug}`}
                                      className="flex-1 cursor-pointer"
                                    >
                                      <div className="text-sm font-medium text-card-foreground">
                                        {toolAgent.name}
                                      </div>
                                      <div className="text-xs text-muted-foreground">
                                        {toolAgent.purpose || toolAgent.slug}
                                      </div>
                                    </label>
                                  </div>
                                );
                              })}
                          </div>
                        )}
                      </div>

                      {/* Agent Handoffs */}
                      <div>
                        <h4 className="text-sm font-semibold text-card-foreground mb-3">Agent Handoffs</h4>
                        <p className="text-xs text-muted-foreground mb-3">
                          Hand off conversations to other agents (same pool only)
                        </p>
                        {agents.filter((a) => a.id !== agent.id && a.pool_type === agent.pool_type).length === 0 ? (
                          <p className="text-sm text-muted-foreground">
                            No other {agent.pool_type} agents available.
                          </p>
                        ) : (
                          <div className="space-y-2">
                            {agents
                              .filter((a) => a.id !== agent.id && a.pool_type === agent.pool_type)
                              .map((targetAgent) => {
                                const isHandoffEnabled = agentHandoffs.includes(targetAgent.id);
                                return (
                                  <div key={targetAgent.id} className="flex items-start gap-3">
                                    <input
                                      type="checkbox"
                                      id={`handoff-${agent.slug}-${targetAgent.slug}`}
                                      checked={isHandoffEnabled}
                                      onChange={(e) =>
                                        handleToggleHandoff(
                                          agent.slug,
                                          targetAgent.slug,
                                          e.target.checked
                                        )
                                      }
                                      className="mt-1 h-4 w-4 focus:ring-ring border-input rounded"
                                    />
                                    <label
                                      htmlFor={`handoff-${agent.slug}-${targetAgent.slug}`}
                                      className="flex-1 cursor-pointer"
                                    >
                                      <div className="text-sm font-medium text-card-foreground">
                                        {targetAgent.name}
                                      </div>
                                      <div className="text-xs text-muted-foreground">
                                        {targetAgent.purpose || targetAgent.slug}
                                      </div>
                                    </label>
                                  </div>
                                );
                              })}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Memories Modal */}
        {showMemories && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-card rounded-lg shadow-xl max-w-3xl w-full max-h-[80vh] overflow-hidden flex flex-col">
              <div className="p-6 border-b border-border flex items-center justify-between">
                <h3 className="text-lg font-semibold text-card-foreground">Agent Memories</h3>
                <button
                  onClick={() => setShowMemories(false)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  ✕
                </button>
              </div>

              {/* Tier tabs */}
              <div className="flex border-b border-border px-6">
                {(["core", "working", "reference"] as const).map((tier) => (
                  <button
                    key={tier}
                    onClick={() => setMemoryTab(tier)}
                    className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                      memoryTab === tier
                        ? "border-primary text-foreground"
                        : "border-transparent text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {tier === "core" ? "Core" : tier === "working" ? "Working" : "Reference"}{" "}
                    <span className="text-xs text-muted-foreground">
                      ({memoryCounts[tier]}{tier === "core" ? "/10" : tier === "working" ? "/30" : ""})
                    </span>
                  </button>
                ))}
              </div>

              <div className="p-6 overflow-y-auto flex-1">
                {(() => {
                  const filtered = memories.filter((m) => m.tier === memoryTab);
                  if (filtered.length === 0) {
                    return (
                      <p className="text-muted-foreground text-center py-8">
                        No {memoryTab} memories yet
                      </p>
                    );
                  }
                  return (
                    <div className="space-y-3">
                      {filtered.map((memory) => (
                        <div
                          key={memory.id}
                          className="border border-border rounded-lg p-4 hover:bg-muted"
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="font-medium text-card-foreground">{memory.key}</span>
                                <Badge variant="secondary" className="text-xs">
                                  {memory.author}
                                </Badge>
                                {memory.access_count > 0 && (
                                  <span className="text-xs text-muted-foreground">
                                    {memory.access_count}x accessed
                                  </span>
                                )}
                              </div>
                              <div className="text-sm text-muted-foreground break-words">{memory.value}</div>
                            </div>
                            <div className="flex gap-1 shrink-0">
                              {memory.tier !== "core" && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  title={memory.tier === "working" ? "Promote to Core" : "Promote to Working"}
                                  onClick={() =>
                                    handleChangeTier(
                                      memory.key,
                                      memory.tier === "reference" ? "working" : "core"
                                    )
                                  }
                                >
                                  ↑
                                </Button>
                              )}
                              {memory.tier !== "reference" && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  title={memory.tier === "core" ? "Demote to Working" : "Demote to Reference"}
                                  onClick={() =>
                                    handleChangeTier(
                                      memory.key,
                                      memory.tier === "core" ? "working" : "reference"
                                    )
                                  }
                                >
                                  ↓
                                </Button>
                              )}
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleDeleteMemory(memory.key)}
                                className="text-red-600 dark:text-red-400"
                              >
                                ✕
                              </Button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
              <div className="p-4 border-t border-border flex justify-end">
                <Button onClick={() => setShowMemories(false)}>Close</Button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
