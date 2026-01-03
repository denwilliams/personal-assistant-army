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
  created_at: string;
  updated_at: string;
}

interface McpServer {
  id: number;
  name: string;
  url: string;
}

const BUILT_IN_TOOLS = [
  { id: "memory", name: "Permanent Memory", description: "Long-term memory across conversations" },
  { id: "internet_search", name: "Internet Search", description: "Search the web using Google" },
];

export default function AgentsPage() {
  const { user } = useAuth();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [mcpServers, setMcpServers] = useState<McpServer[]>([]);
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
  });

  // Tools and handoffs data for expanded agent
  const [agentTools, setAgentTools] = useState<{
    built_in_tools: string[];
    mcp_tools: number[];
  } | null>(null);
  const [agentToolAgents, setAgentToolAgents] = useState<number[]>([]);
  const [agentHandoffs, setAgentHandoffs] = useState<number[]>([]);

  useEffect(() => {
    loadAgents();
    loadMcpServers();
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
      });
      setEditingAgent(null);
      setFormData({
        slug: "",
        name: "",
        purpose: "",
        system_prompt: "",
        internet_search_enabled: false,
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
    });
    setShowCreateForm(false);
  };

  const getAgentById = (id: number) => agents.find((a) => a.id === id);
  const getMcpServerById = (id: number) => mcpServers.find((m) => m.id === id);

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold text-slate-900">My Agents</h1>
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
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <p className="text-red-800 text-sm">{error}</p>
          </div>
        )}

        {/* Create/Edit Form */}
        {showCreateForm ? (
          <section className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold mb-4">
              {editingAgent ? "Edit Agent" : "Create New Agent"}
            </h2>
            <form onSubmit={editingAgent ? handleUpdateAgent : handleCreateAgent} className="space-y-4">
              {!editingAgent && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
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
                    className="w-full px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-500"
                  />
                  <p className="text-xs text-slate-500 mt-1">
                    Lowercase letters, numbers, and hyphens only
                  </p>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Name
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g., My Personal Assistant"
                  required
                  className="w-full px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Purpose (optional)
                </label>
                <input
                  type="text"
                  value={formData.purpose}
                  onChange={(e) => setFormData({ ...formData, purpose: e.target.value })}
                  placeholder="e.g., Help with coding tasks"
                  className="w-full px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
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
                  className="w-full px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-500"
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
                  className="h-4 w-4 text-slate-600 focus:ring-slate-500 border-slate-300 rounded"
                />
                <label htmlFor="internet_search" className="ml-2 text-sm text-slate-700">
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
        <section className="bg-white rounded-lg shadow">
          {loading && agents.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-slate-600">Loading agents...</p>
            </div>
          ) : agents.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-slate-600 mb-4">No agents yet</p>
              <p className="text-sm text-slate-500">
                Create your first agent to get started
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-200">
              {agents.map((agent) => (
                <div key={agent.id} className="p-6">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <h3 className="text-lg font-semibold text-slate-900">
                          {agent.name}
                        </h3>
                        <span className="text-xs text-slate-500 font-mono bg-slate-100 px-2 py-1 rounded">
                          {agent.slug}
                        </span>
                        {agent.internet_search_enabled && (
                          <span className="text-xs text-blue-600 bg-blue-50 px-2 py-1 rounded">
                            Search
                          </span>
                        )}
                      </div>
                      {agent.purpose && (
                        <p className="text-sm text-slate-600 mb-2">{agent.purpose}</p>
                      )}
                      <p className="text-sm text-slate-500 line-clamp-2">
                        {agent.system_prompt}
                      </p>
                      <p className="text-xs text-slate-400 mt-2">
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
                    <div className="mt-6 pt-6 border-t border-slate-200 space-y-6">
                      {/* Built-in Tools */}
                      <div>
                        <h4 className="text-sm font-semibold text-slate-900 mb-3">Built-in Tools</h4>
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
                                className="mt-1 h-4 w-4 text-slate-600 focus:ring-slate-500 border-slate-300 rounded"
                              />
                              <label
                                htmlFor={`tool-${agent.slug}-${tool.id}`}
                                className="flex-1 cursor-pointer"
                              >
                                <div className="text-sm font-medium text-slate-700">{tool.name}</div>
                                <div className="text-xs text-slate-500">{tool.description}</div>
                              </label>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* MCP Tools */}
                      <div>
                        <h4 className="text-sm font-semibold text-slate-900 mb-3">MCP Server Tools</h4>
                        {mcpServers.length === 0 ? (
                          <p className="text-sm text-slate-500">
                            No MCP servers configured. Add MCP servers in your{" "}
                            <Link to="/profile" className="text-blue-600 hover:underline">
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
                                  className="mt-1 h-4 w-4 text-slate-600 focus:ring-slate-500 border-slate-300 rounded"
                                />
                                <label
                                  htmlFor={`mcp-${agent.slug}-${server.id}`}
                                  className="flex-1 cursor-pointer"
                                >
                                  <div className="text-sm font-medium text-slate-700">{server.name}</div>
                                  <div className="text-xs text-slate-500 font-mono">{server.url}</div>
                                </label>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Agent Tools */}
                      <div>
                        <h4 className="text-sm font-semibold text-slate-900 mb-3">Agent Tools</h4>
                        <p className="text-xs text-slate-500 mb-3">
                          Call other agents as tools (agent maintains control and receives response)
                        </p>
                        {agents.filter((a) => a.id !== agent.id).length === 0 ? (
                          <p className="text-sm text-slate-500">
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
                                      className="mt-1 h-4 w-4 text-slate-600 focus:ring-slate-500 border-slate-300 rounded"
                                    />
                                    <label
                                      htmlFor={`agent-tool-${agent.slug}-${toolAgent.slug}`}
                                      className="flex-1 cursor-pointer"
                                    >
                                      <div className="text-sm font-medium text-slate-700">
                                        {toolAgent.name}
                                      </div>
                                      <div className="text-xs text-slate-500">
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
                        <h4 className="text-sm font-semibold text-slate-900 mb-3">Agent Handoffs</h4>
                        <p className="text-xs text-slate-500 mb-3">
                          Allow this agent to hand off conversations to other agents (transfers control)
                        </p>
                        {agents.filter((a) => a.id !== agent.id).length === 0 ? (
                          <p className="text-sm text-slate-500">
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
                                      className="mt-1 h-4 w-4 text-slate-600 focus:ring-slate-500 border-slate-300 rounded"
                                    />
                                    <label
                                      htmlFor={`handoff-${agent.slug}-${targetAgent.slug}`}
                                      className="flex-1 cursor-pointer"
                                    >
                                      <div className="text-sm font-medium text-slate-700">
                                        {targetAgent.name}
                                      </div>
                                      <div className="text-xs text-slate-500">
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
      </main>
    </div>
  );
}
