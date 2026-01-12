import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useAuth } from "../contexts/AuthContext";
import { api } from "../lib/api";

interface Agent {
  id: number;
  slug: string;
  name: string;
  purpose?: string;
  system_prompt: string;
  internet_search_enabled: boolean;
  is_favorite: boolean;
  slack_bot_token?: string;
  slack_enabled: boolean;
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
    internet_search_enabled: false,
    slack_bot_token: "",
    slack_enabled: false,
  });

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
  const [memories, setMemories] = useState<Array<{
    id: number;
    key: string;
    value: string;
    created_at: string;
    updated_at: string;
  }>>([]);

  useEffect(() => {
    loadAgents();
    loadMcpServers();
    loadUrlTools();
  }, []);

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
      await api.agents.create(formData);
      setFormData({
        slug: "",
        name: "",
        purpose: "",
        system_prompt: "",
        internet_search_enabled: false,
        slack_bot_token: "",
        slack_enabled: false,
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
        internet_search_enabled: formData.internet_search_enabled,
        slack_bot_token: formData.slack_bot_token,
        slack_enabled: formData.slack_enabled,
      });
      setEditingAgent(null);
      setFormData({
        slug: "",
        name: "",
        purpose: "",
        system_prompt: "",
        internet_search_enabled: false,
        slack_bot_token: "",
        slack_enabled: false,
      });
      setShowCreateForm(false);
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
      internet_search_enabled: agent.internet_search_enabled,
      slack_bot_token: agent.slack_bot_token || "",
      slack_enabled: agent.slack_enabled || false,
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
      internet_search_enabled: false,
      slack_bot_token: "",
      slack_enabled: false,
    });
    setShowCreateForm(false);
  };

  const handleViewMemories = async (slug: string) => {
    try {
      const data = await api.agents.getMemories(slug);
      setMemories(data.memories);
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
    <div className="min-h-screen bg-background">
      <header className="bg-card border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold text-foreground">My Agents</h1>
            <div className="flex gap-2">
              <Link to="/profile">
                <Button variant="outline">Profile</Button>
              </Link>
              <Link to="/">
                <Button variant="outline">Dashboard</Button>
              </Link>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
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

              {/* Slack Integration Section */}
              <div className="border-t border-border pt-4">
                <h3 className="text-md font-semibold text-card-foreground mb-3">
                  Slack Integration
                </h3>

                <div className="flex items-center mb-3">
                  <input
                    type="checkbox"
                    id="slack_enabled"
                    checked={formData.slack_enabled}
                    onChange={(e) =>
                      setFormData({ ...formData, slack_enabled: e.target.checked })
                    }
                    className="h-4 w-4 focus:ring-ring border-input rounded"
                  />
                  <label htmlFor="slack_enabled" className="ml-2 text-sm text-card-foreground">
                    Enable Slack bot
                  </label>
                </div>

                {formData.slack_enabled && (
                  <div>
                    <label className="block text-sm font-medium text-card-foreground mb-2">
                      Slack Bot Token
                      <span className="text-xs text-muted-foreground ml-2">
                        (starts with xoxb-)
                      </span>
                    </label>
                    <input
                      type="password"
                      value={formData.slack_bot_token}
                      onChange={(e) =>
                        setFormData({ ...formData, slack_bot_token: e.target.value })
                      }
                      placeholder="xoxb-your-bot-token"
                      className="w-full px-3 py-2 border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring bg-background text-foreground"
                    />
                    {editingAgent && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Webhook URL: {window.location.origin}/api/slack/events/{editingAgent.id}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground mt-2">
                      Create a Slack app and add the bot token here. Configure the Event Subscriptions URL in your Slack app settings.
                    </p>
                  </div>
                )}
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
                        <button
                          onClick={() => handleToggleFavorite(agent.slug, agent.is_favorite)}
                          className="text-2xl hover:scale-110 transition-transform"
                          title={agent.is_favorite ? "Remove from favorites" : "Add to favorites"}
                        >
                          {agent.is_favorite ? "⭐" : "☆"}
                        </button>
                        <h3 className="text-lg font-semibold text-card-foreground">
                          {agent.name}
                        </h3>
                        <span className="text-xs text-muted-foreground font-mono bg-muted px-2 py-1 rounded">
                          {agent.slug}
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
                          Call other agents as tools (agent maintains control and receives response)
                        </p>
                        {agents.filter((a) => a.id !== agent.id).length === 0 ? (
                          <p className="text-sm text-muted-foreground">
                            No other agents available. Create more agents to use as tools.
                          </p>
                        ) : (
                          <div className="space-y-2">
                            {agents
                              .filter((a) => a.id !== agent.id)
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
                          Allow this agent to hand off conversations to other agents (transfers control)
                        </p>
                        {agents.filter((a) => a.id !== agent.id).length === 0 ? (
                          <p className="text-sm text-muted-foreground">
                            No other agents available. Create more agents to enable handoffs.
                          </p>
                        ) : (
                          <div className="space-y-2">
                            {agents
                              .filter((a) => a.id !== agent.id)
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
                <h3 className="text-lg font-semibold text-card-foreground">Permanent Memories</h3>
                <button
                  onClick={() => setShowMemories(false)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  ✕
                </button>
              </div>
              <div className="p-6 overflow-y-auto flex-1">
                {memories.length === 0 ? (
                  <p className="text-muted-foreground text-center py-8">No memories stored yet</p>
                ) : (
                  <div className="space-y-4">
                    {memories.map((memory) => (
                      <div
                        key={memory.id}
                        className="border border-border rounded-lg p-4 hover:bg-muted"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-card-foreground mb-1">{memory.key}</div>
                            <div className="text-sm text-muted-foreground break-words">{memory.value}</div>
                            <div className="text-xs text-muted-foreground mt-2">
                              Updated {new Date(memory.updated_at).toLocaleString()}
                            </div>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleDeleteMemory(memory.key)}
                            className="text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300"
                          >
                            Delete
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
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
