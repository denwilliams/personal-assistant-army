import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useAuth } from "../contexts/AuthContext";
import { api } from "../lib/api";

interface McpServer {
  id: number;
  name: string;
  url: string;
  headers?: Record<string, string>;
  created_at: string;
}

interface HeaderPair {
  key: string;
  value: string;
}

export default function ProfilePage() {
  const { user, refreshUser } = useAuth();
  const [mcpServers, setMcpServers] = useState<McpServer[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingMcp, setEditingMcp] = useState<McpServer | null>(null);

  // Form states
  const [openaiKey, setOpenaiKey] = useState("");
  const [googleSearchKey, setGoogleSearchKey] = useState("");
  const [googleSearchEngineId, setGoogleSearchEngineId] = useState("");
  const [timezone, setTimezone] = useState("");
  const [newMcpName, setNewMcpName] = useState("");
  const [newMcpUrl, setNewMcpUrl] = useState("");
  const [newMcpHeaders, setNewMcpHeaders] = useState<HeaderPair[]>([]);

  useEffect(() => {
    loadMcpServers();
    if (user?.google_search_engine_id) {
      setGoogleSearchEngineId(user.google_search_engine_id);
    }
    if (user?.timezone) {
      setTimezone(user.timezone);
    }
  }, [user]);

  const loadMcpServers = async () => {
    try {
      const servers = await api.mcpServers.list();
      setMcpServers(servers);
    } catch (err) {
      console.error("Failed to load MCP servers:", err);
    }
  };

  const handleUpdateCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      await api.user.updateCredentials({
        openai_api_key: openaiKey || undefined,
        google_search_api_key: googleSearchKey || undefined,
        google_search_engine_id: googleSearchEngineId || undefined,
      });

      await refreshUser();
      setOpenaiKey("");
      setGoogleSearchKey("");
      alert("Credentials updated successfully!");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update credentials");
    } finally {
      setLoading(false);
    }
  };

  const handleAddMcpServer = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      // Convert header pairs to object
      const headers = newMcpHeaders
        .filter(h => h.key.trim() && h.value.trim())
        .reduce((acc, h) => ({ ...acc, [h.key.trim()]: h.value.trim() }), {});

      await api.mcpServers.create({
        name: newMcpName,
        url: newMcpUrl,
        headers: Object.keys(headers).length > 0 ? headers : undefined,
      });

      setNewMcpName("");
      setNewMcpUrl("");
      setNewMcpHeaders([]);
      await loadMcpServers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add MCP server");
    } finally {
      setLoading(false);
    }
  };

  const addHeaderPair = () => {
    setNewMcpHeaders([...newMcpHeaders, { key: "", value: "" }]);
  };

  const removeHeaderPair = (index: number) => {
    setNewMcpHeaders(newMcpHeaders.filter((_, i) => i !== index));
  };

  const updateHeaderPair = (index: number, field: "key" | "value", value: string) => {
    const updated = [...newMcpHeaders];
    updated[index][field] = value;
    setNewMcpHeaders(updated);
  };

  const startEditMcp = (server: McpServer) => {
    setEditingMcp(server);
    setNewMcpName(server.name);
    setNewMcpUrl(server.url);
    setNewMcpHeaders(
      server.headers
        ? Object.entries(server.headers).map(([key, value]) => ({ key, value }))
        : []
    );
  };

  const cancelEditMcp = () => {
    setEditingMcp(null);
    setNewMcpName("");
    setNewMcpUrl("");
    setNewMcpHeaders([]);
  };

  const handleUpdateMcpServer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingMcp) return;

    setLoading(true);
    setError(null);

    try {
      const headers = newMcpHeaders
        .filter(h => h.key.trim() && h.value.trim())
        .reduce((acc, h) => ({ ...acc, [h.key.trim()]: h.value.trim() }), {});

      await api.mcpServers.update(editingMcp.id, {
        name: newMcpName,
        url: newMcpUrl,
        headers: Object.keys(headers).length > 0 ? headers : undefined,
      });

      cancelEditMcp();
      await loadMcpServers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update MCP server");
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteMcpServer = async (id: number) => {
    if (!confirm("Are you sure you want to delete this MCP server?")) return;

    setLoading(true);
    try {
      await api.mcpServers.delete(id);
      await loadMcpServers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete MCP server");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="bg-card border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold text-foreground">Profile Settings</h1>
            <Link to="/">
              <Button variant="outline">Dashboard</Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        {error && (
          <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
            <p className="text-red-800 dark:text-red-400 text-sm">{error}</p>
          </div>
        )}

        {/* User Info */}
        <section className="bg-card rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold text-card-foreground mb-4">Account Information</h2>
          <div className="space-y-4">
            <div className="space-y-2 text-sm">
              <p>
                <span className="font-medium">Email:</span> {user?.email}
              </p>
              <p>
                <span className="font-medium">Name:</span> {user?.name}
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-card-foreground mb-2">
                Timezone
              </label>
              <select
                value={timezone}
                onChange={async (e) => {
                  const newTimezone = e.target.value;
                  setTimezone(newTimezone);
                  try {
                    await api.user.updateProfile({ timezone: newTimezone });
                    await refreshUser();
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "Failed to update timezone");
                  }
                }}
                className="w-full px-3 py-2 border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring bg-background text-foreground"
              >
                <option value="UTC">UTC (Coordinated Universal Time)</option>
                <optgroup label="US & Canada">
                  <option value="America/New_York">Eastern Time (New York)</option>
                  <option value="America/Chicago">Central Time (Chicago)</option>
                  <option value="America/Denver">Mountain Time (Denver)</option>
                  <option value="America/Phoenix">Mountain Time - No DST (Phoenix)</option>
                  <option value="America/Los_Angeles">Pacific Time (Los Angeles)</option>
                  <option value="America/Anchorage">Alaska Time (Anchorage)</option>
                  <option value="Pacific/Honolulu">Hawaii Time (Honolulu)</option>
                </optgroup>
                <optgroup label="Europe">
                  <option value="Europe/London">London</option>
                  <option value="Europe/Paris">Paris</option>
                  <option value="Europe/Berlin">Berlin</option>
                  <option value="Europe/Rome">Rome</option>
                  <option value="Europe/Madrid">Madrid</option>
                  <option value="Europe/Amsterdam">Amsterdam</option>
                  <option value="Europe/Brussels">Brussels</option>
                  <option value="Europe/Vienna">Vienna</option>
                  <option value="Europe/Warsaw">Warsaw</option>
                  <option value="Europe/Athens">Athens</option>
                  <option value="Europe/Moscow">Moscow</option>
                </optgroup>
                <optgroup label="Asia">
                  <option value="Asia/Dubai">Dubai</option>
                  <option value="Asia/Kolkata">India (Kolkata)</option>
                  <option value="Asia/Shanghai">China (Shanghai)</option>
                  <option value="Asia/Hong_Kong">Hong Kong</option>
                  <option value="Asia/Singapore">Singapore</option>
                  <option value="Asia/Tokyo">Tokyo</option>
                  <option value="Asia/Seoul">Seoul</option>
                  <option value="Asia/Bangkok">Bangkok</option>
                  <option value="Asia/Jakarta">Jakarta</option>
                </optgroup>
                <optgroup label="Australia & Pacific">
                  <option value="Australia/Sydney">Sydney</option>
                  <option value="Australia/Melbourne">Melbourne</option>
                  <option value="Australia/Brisbane">Brisbane</option>
                  <option value="Australia/Perth">Perth</option>
                  <option value="Pacific/Auckland">Auckland</option>
                </optgroup>
                <optgroup label="South America">
                  <option value="America/Sao_Paulo">São Paulo</option>
                  <option value="America/Argentina/Buenos_Aires">Buenos Aires</option>
                  <option value="America/Santiago">Santiago</option>
                  <option value="America/Bogota">Bogotá</option>
                  <option value="America/Lima">Lima</option>
                </optgroup>
                <optgroup label="Africa">
                  <option value="Africa/Cairo">Cairo</option>
                  <option value="Africa/Johannesburg">Johannesburg</option>
                  <option value="Africa/Lagos">Lagos</option>
                  <option value="Africa/Nairobi">Nairobi</option>
                </optgroup>
              </select>
              <p className="text-xs text-muted-foreground mt-1">
                Used for displaying dates in agent conversations
              </p>
            </div>
          </div>
        </section>

        {/* API Credentials */}
        <section className="bg-card rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold text-card-foreground mb-4">API Credentials</h2>
          <form onSubmit={handleUpdateCredentials} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-card-foreground mb-2">
                OpenAI API Key
                {user?.has_openai_key && (
                  <span className="ml-2 text-green-600 dark:text-green-400">✓ Configured</span>
                )}
              </label>
              <input
                type="password"
                value={openaiKey}
                onChange={(e) => setOpenaiKey(e.target.value)}
                placeholder="sk-..."
                className="w-full px-3 py-2 border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring bg-background text-foreground"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Required for agent conversations
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-card-foreground mb-2">
                Google Search API Key
                {user?.has_google_search_key && (
                  <span className="ml-2 text-green-600 dark:text-green-400">✓ Configured</span>
                )}
              </label>
              <input
                type="password"
                value={googleSearchKey}
                onChange={(e) => setGoogleSearchKey(e.target.value)}
                placeholder="Enter Google Search API key"
                className="w-full px-3 py-2 border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring bg-background text-foreground"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-card-foreground mb-2">
                Google Search Engine ID
              </label>
              <input
                type="text"
                value={googleSearchEngineId}
                onChange={(e) => setGoogleSearchEngineId(e.target.value)}
                placeholder="Enter Search Engine ID"
                className="w-full px-3 py-2 border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring bg-background text-foreground"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Optional: For internet search tool
              </p>
            </div>

            <Button type="submit" disabled={loading}>
              {loading ? "Saving..." : "Save Credentials"}
            </Button>
          </form>
        </section>

        {/* MCP Servers */}
        <section className="bg-card rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold text-card-foreground mb-4">MCP Servers</h2>
          <p className="text-sm text-muted-foreground mb-4">
            Configure MCP (Model Context Protocol) servers for advanced agent tools
          </p>

          <form onSubmit={editingMcp ? handleUpdateMcpServer : handleAddMcpServer} className="space-y-4 mb-6">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-card-foreground mb-2">
                  Server Name
                </label>
                <input
                  type="text"
                  value={newMcpName}
                  onChange={(e) => setNewMcpName(e.target.value)}
                  placeholder="e.g., filesystem-server"
                  required
                  className="w-full px-3 py-2 border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring bg-background text-foreground"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-card-foreground mb-2">
                  Server URL
                </label>
                <input
                  type="url"
                  value={newMcpUrl}
                  onChange={(e) => setNewMcpUrl(e.target.value)}
                  placeholder="https://..."
                  required
                  className="w-full px-3 py-2 border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring bg-background text-foreground"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-sm font-medium text-card-foreground">
                    Custom Headers (optional)
                  </label>
                  <button
                    type="button"
                    onClick={addHeaderPair}
                    className="text-sm text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300"
                  >
                    + Add Header
                  </button>
                </div>
                {newMcpHeaders.length > 0 && (
                  <div className="space-y-2">
                    {newMcpHeaders.map((header, index) => (
                      <div key={index} className="flex gap-2">
                        <input
                          type="text"
                          value={header.key}
                          onChange={(e) => updateHeaderPair(index, "key", e.target.value)}
                          placeholder="Header name (e.g., Authorization)"
                          className="flex-1 px-3 py-2 border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring bg-background text-foreground text-sm"
                        />
                        <input
                          type="text"
                          value={header.value}
                          onChange={(e) => updateHeaderPair(index, "value", e.target.value)}
                          placeholder="Header value"
                          className="flex-1 px-3 py-2 border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring bg-background text-foreground text-sm"
                        />
                        <button
                          type="button"
                          onClick={() => removeHeaderPair(index)}
                          className="px-3 py-2 text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 text-sm"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="flex gap-2">
              <Button type="submit" disabled={loading}>
                {editingMcp ? "Update Server" : "Add MCP Server"}
              </Button>
              {editingMcp && (
                <Button type="button" variant="outline" onClick={cancelEditMcp}>
                  Cancel
                </Button>
              )}
            </div>
          </form>

          {mcpServers.length > 0 ? (
            <div className="space-y-2">
              {mcpServers.map((server) => (
                <div
                  key={server.id}
                  className="flex items-center justify-between p-3 bg-muted rounded-md"
                >
                  <div className="flex-1">
                    <p className="font-medium text-sm text-foreground">{server.name}</p>
                    <p className="text-xs text-muted-foreground">{server.url}</p>
                    {server.headers && Object.keys(server.headers).length > 0 && (
                      <p className="text-xs text-muted-foreground mt-1">
                        {Object.keys(server.headers).length} custom header{Object.keys(server.headers).length !== 1 ? 's' : ''}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => startEditMcp(server)}
                      disabled={loading}
                    >
                      Edit
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleDeleteMcpServer(server.id)}
                      disabled={loading}
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-4">
              No MCP servers configured
            </p>
          )}
        </section>
      </main>
    </div>
  );
}
