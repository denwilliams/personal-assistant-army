import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "../contexts/AuthContext";
import { api, type WebhookConfig, type EmailConfig } from "../lib/api";

interface McpServer {
  id: number;
  domain: string;
  name: string;
  url: string;
  headers?: Record<string, string>;
  created_at: string;
}

interface UrlTool {
  id: number;
  domain: string;
  name: string;
  description?: string;
  url: string;
  method: string;
  headers?: Record<string, string>;
  created_at: string;
  updated_at: string;
}

interface HeaderPair {
  key: string;
  value: string;
}

interface TeamSettingsData {
  domain: string;
  timezone: string;
  has_openai_key: boolean;
  has_anthropic_key: boolean;
  has_google_ai_key: boolean;
  has_google_search_key: boolean;
  google_search_engine_id: string | null;
}

const PERSONAL_DOMAINS = new Set([
  "gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "icloud.com",
  "me.com", "mac.com", "aol.com", "protonmail.com", "proton.me",
  "live.com", "msn.com", "mail.com", "ymail.com", "googlemail.com",
]);

function isPersonalDomain(domain: string): boolean {
  if (!domain || domain === "localhost") return true;
  if (domain.startsWith("demo-")) return true;
  return PERSONAL_DOMAINS.has(domain.toLowerCase());
}

export default function TeamPage() {
  const { user } = useAuth();
  const domain = user?.email?.split("@")[1] ?? "";
  const personal = isPersonalDomain(domain);

  const [settings, setSettings] = useState<TeamSettingsData | null>(null);
  const [mcpServers, setMcpServers] = useState<McpServer[]>([]);
  const [urlTools, setUrlTools] = useState<UrlTool[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingMcp, setEditingMcp] = useState<McpServer | null>(null);
  const [editingUrlTool, setEditingUrlTool] = useState<UrlTool | null>(null);

  // Credentials form
  const [openaiKey, setOpenaiKey] = useState("");
  const [anthropicKey, setAnthropicKey] = useState("");
  const [googleAiKey, setGoogleAiKey] = useState("");
  const [googleSearchKey, setGoogleSearchKey] = useState("");
  const [googleSearchEngineId, setGoogleSearchEngineId] = useState("");

  // Timezone
  const [timezone, setTimezone] = useState("UTC");

  // MCP form
  const [newMcpName, setNewMcpName] = useState("");
  const [newMcpUrl, setNewMcpUrl] = useState("");
  const [newMcpHeaders, setNewMcpHeaders] = useState<HeaderPair[]>([]);

  // URL tool form
  const [newUrlToolName, setNewUrlToolName] = useState("");
  const [newUrlToolDescription, setNewUrlToolDescription] = useState("");
  const [newUrlToolUrl, setNewUrlToolUrl] = useState("");
  const [newUrlToolMethod, setNewUrlToolMethod] = useState("GET");
  const [newUrlToolHeaders, setNewUrlToolHeaders] = useState<HeaderPair[]>([]);

  // Notification settings
  const [notifEmailEnabled, setNotifEmailEnabled] = useState(true);
  const [emailAddresses, setEmailAddresses] = useState<EmailConfig[]>([]);
  const [newEmailName, setNewEmailName] = useState("");
  const [newEmailAddress, setNewEmailAddress] = useState("");
  const [webhooks, setWebhooks] = useState<WebhookConfig[]>([]);
  const [newWebhookName, setNewWebhookName] = useState("");
  const [newWebhookUrl, setNewWebhookUrl] = useState("");
  const [pushoverEnabled, setPushoverEnabled] = useState(false);
  const [pushoverUserKey, setPushoverUserKey] = useState("");
  const [pushoverApiToken, setPushoverApiToken] = useState("");
  const [notifLoading, setNotifLoading] = useState(false);

  useEffect(() => {
    if (personal) return;
    loadSettings();
    loadMcpServers();
    loadUrlTools();
    loadNotificationSettings();
  }, [personal]);

  const loadSettings = async () => {
    try {
      const data = await api.team.getSettings();
      setSettings(data);
      setTimezone(data.timezone ?? "UTC");
      setGoogleSearchEngineId(data.google_search_engine_id ?? "");
    } catch (err) {
      console.error("Failed to load team settings:", err);
    }
  };

  const loadMcpServers = async () => {
    try {
      const servers = await api.team.listMcpServers();
      setMcpServers(servers);
    } catch (err) {
      console.error("Failed to load team MCP servers:", err);
    }
  };

  const loadUrlTools = async () => {
    try {
      const tools = await api.team.listUrlTools();
      setUrlTools(tools);
    } catch (err) {
      console.error("Failed to load team URL tools:", err);
    }
  };

  const loadNotificationSettings = async () => {
    try {
      const s = await api.team.getNotificationSettings();
      setNotifEmailEnabled(s.email_enabled);
      const rawEmails: any = (s as any).email_addresses;
      let emails: EmailConfig[] = [];
      if (Array.isArray(rawEmails)) emails = rawEmails;
      else if (typeof rawEmails === "string") {
        try { emails = JSON.parse(rawEmails); } catch {}
      }
      if (emails.length === 0 && s.notification_email) {
        emails = [{ name: "Default", email: s.notification_email }];
      }
      setEmailAddresses(emails);
      const urls = s.webhook_urls;
      setWebhooks(Array.isArray(urls) ? urls : typeof urls === "string" ? JSON.parse(urls) : []);
      setPushoverEnabled(s.pushover_enabled);
      setPushoverUserKey(s.pushover_user_key ?? "");
      setPushoverApiToken(s.pushover_api_token ?? "");
    } catch {
      // settings may not exist yet
    }
  };

  const handleSaveTimezone = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api.team.updateSettings({ timezone });
      await loadSettings();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save timezone");
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api.team.updateCredentials({
        openai_api_key: openaiKey || undefined,
        anthropic_api_key: anthropicKey || undefined,
        google_ai_api_key: googleAiKey || undefined,
        google_search_api_key: googleSearchKey || undefined,
        google_search_engine_id: googleSearchEngineId || undefined,
      });
      await loadSettings();
      setOpenaiKey("");
      setAnthropicKey("");
      setGoogleAiKey("");
      setGoogleSearchKey("");
      alert("Team credentials updated successfully!");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update credentials");
    } finally {
      setLoading(false);
    }
  };

  // MCP handlers
  const handleAddMcpServer = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const headers = newMcpHeaders
        .filter(h => h.key.trim() && h.value.trim())
        .reduce((acc, h) => ({ ...acc, [h.key.trim()]: h.value.trim() }), {});
      await api.team.createMcpServer({
        name: newMcpName,
        url: newMcpUrl,
        headers: Object.keys(headers).length > 0 ? headers : undefined,
      });
      setNewMcpName(""); setNewMcpUrl(""); setNewMcpHeaders([]);
      await loadMcpServers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add MCP server");
    } finally {
      setLoading(false);
    }
  };

  const startEditMcp = (server: McpServer) => {
    setEditingMcp(server);
    setNewMcpName(server.name);
    setNewMcpUrl(server.url);
    setNewMcpHeaders(server.headers ? Object.entries(server.headers).map(([key, value]) => ({ key, value })) : []);
  };

  const cancelEditMcp = () => {
    setEditingMcp(null);
    setNewMcpName(""); setNewMcpUrl(""); setNewMcpHeaders([]);
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
      await api.team.updateMcpServer(editingMcp.id, {
        name: newMcpName, url: newMcpUrl,
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
    if (!confirm("Delete this MCP server?")) return;
    setLoading(true);
    try {
      await api.team.deleteMcpServer(id);
      await loadMcpServers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete MCP server");
    } finally {
      setLoading(false);
    }
  };

  // URL Tool handlers
  const handleAddUrlTool = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const headers = newUrlToolHeaders
        .filter(h => h.key.trim() && h.value.trim())
        .reduce((acc, h) => ({ ...acc, [h.key.trim()]: h.value.trim() }), {});
      await api.team.createUrlTool({
        name: newUrlToolName,
        description: newUrlToolDescription || undefined,
        url: newUrlToolUrl,
        method: newUrlToolMethod,
        headers: Object.keys(headers).length > 0 ? headers : undefined,
      });
      setNewUrlToolName(""); setNewUrlToolDescription(""); setNewUrlToolUrl(""); setNewUrlToolMethod("GET"); setNewUrlToolHeaders([]);
      await loadUrlTools();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add URL tool");
    } finally {
      setLoading(false);
    }
  };

  const startEditUrlTool = (tool: UrlTool) => {
    setEditingUrlTool(tool);
    setNewUrlToolName(tool.name);
    setNewUrlToolDescription(tool.description || "");
    setNewUrlToolUrl(tool.url);
    setNewUrlToolMethod(tool.method);
    setNewUrlToolHeaders(tool.headers ? Object.entries(tool.headers).map(([key, value]) => ({ key, value })) : []);
  };

  const cancelEditUrlTool = () => {
    setEditingUrlTool(null);
    setNewUrlToolName(""); setNewUrlToolDescription(""); setNewUrlToolUrl(""); setNewUrlToolMethod("GET"); setNewUrlToolHeaders([]);
  };

  const handleUpdateUrlTool = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUrlTool) return;
    setLoading(true);
    setError(null);
    try {
      const headers = newUrlToolHeaders
        .filter(h => h.key.trim() && h.value.trim())
        .reduce((acc, h) => ({ ...acc, [h.key.trim()]: h.value.trim() }), {});
      await api.team.updateUrlTool(editingUrlTool.id, {
        name: newUrlToolName,
        description: newUrlToolDescription || undefined,
        url: newUrlToolUrl,
        method: newUrlToolMethod,
        headers: Object.keys(headers).length > 0 ? headers : undefined,
      });
      cancelEditUrlTool();
      await loadUrlTools();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update URL tool");
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteUrlTool = async (id: number) => {
    if (!confirm("Delete this URL tool?")) return;
    setLoading(true);
    try {
      await api.team.deleteUrlTool(id);
      await loadUrlTools();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete URL tool");
    } finally {
      setLoading(false);
    }
  };

  const handleSaveNotificationSettings = async () => {
    setNotifLoading(true);
    setError(null);
    try {
      await api.team.updateNotificationSettings({
        email_enabled: notifEmailEnabled,
        email_addresses: emailAddresses,
        webhook_urls: webhooks,
        pushover_enabled: pushoverEnabled,
        pushover_user_key: pushoverUserKey || undefined,
        pushover_api_token: pushoverApiToken || undefined,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save notification settings");
    } finally {
      setNotifLoading(false);
    }
  };

  const addWebhook = () => {
    if (!newWebhookName.trim() || !newWebhookUrl.trim()) return;
    if (!newWebhookUrl.startsWith("https://")) {
      setError("Webhook URL must use HTTPS");
      return;
    }
    if (webhooks.some((w) => w.name === newWebhookName.trim())) {
      setError("A webhook with that name already exists");
      return;
    }
    setWebhooks([...webhooks, { name: newWebhookName.trim(), url: newWebhookUrl.trim() }]);
    setNewWebhookName(""); setNewWebhookUrl("");
  };

  const removeWebhook = (index: number) => {
    setWebhooks(webhooks.filter((_, i) => i !== index));
  };

  const addEmailAddress = () => {
    if (!newEmailName.trim() || !newEmailAddress.trim()) return;
    if (emailAddresses.some((e) => e.name === newEmailName.trim())) {
      setError("An email destination with that name already exists");
      return;
    }
    setEmailAddresses([...emailAddresses, { name: newEmailName.trim(), email: newEmailAddress.trim() }]);
    setNewEmailName(""); setNewEmailAddress("");
  };

  const removeEmailAddress = (index: number) => {
    setEmailAddresses(emailAddresses.filter((_, i) => i !== index));
  };

  // Header pair helpers
  const addMcpHeader = () => setNewMcpHeaders([...newMcpHeaders, { key: "", value: "" }]);
  const removeMcpHeader = (i: number) => setNewMcpHeaders(newMcpHeaders.filter((_, idx) => idx !== i));
  const updateMcpHeader = (i: number, f: "key" | "value", v: string) => {
    const u = [...newMcpHeaders]; if (u[i]) u[i][f] = v; setNewMcpHeaders(u);
  };

  const addUrlHeader = () => setNewUrlToolHeaders([...newUrlToolHeaders, { key: "", value: "" }]);
  const removeUrlHeader = (i: number) => setNewUrlToolHeaders(newUrlToolHeaders.filter((_, idx) => idx !== i));
  const updateUrlHeader = (i: number, f: "key" | "value", v: string) => {
    const u = [...newUrlToolHeaders]; if (u[i]) u[i][f] = v; setNewUrlToolHeaders(u);
  };

  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center gap-2 border-b px-6 py-3">
        <SidebarTrigger />
        <h1 className="text-lg font-semibold">Team Settings</h1>
        {settings && (
          <span className="ml-2 text-sm text-muted-foreground bg-muted px-2 py-0.5 rounded">{settings.domain}</span>
        )}
      </header>

      <main className="flex-1 overflow-y-auto px-6 py-8 space-y-8 max-w-4xl">
        {personal ? (
          <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg p-6">
            <h2 className="font-semibold text-amber-900 dark:text-amber-200 mb-1">Team settings not available</h2>
            <p className="text-amber-800 dark:text-amber-300 text-sm">
              Team settings are not available for personal email domains (e.g. gmail.com, yahoo.com).
              Sign in with a work or organisation email to access team settings.
            </p>
          </div>
        ) : (
          <>
            {/* Shared notice */}
            <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
              <p className="text-blue-800 dark:text-blue-300 text-sm">
                These settings are shared with everyone at <strong>{domain}</strong>. Any team member can view and edit them.
              </p>
            </div>

            {error && (
              <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
                <p className="text-red-800 dark:text-red-400 text-sm">{error}</p>
              </div>
            )}

            {/* API Keys */}
            <section className="bg-card border rounded-lg p-6 space-y-4">
              <h2 className="text-base font-semibold">API Keys</h2>
              <p className="text-sm text-muted-foreground">
                Team agents will use these credentials. Leave a field empty to keep the existing value.
              </p>
              {settings && (
                <div className="flex flex-wrap gap-2 text-xs">
                  {settings.has_openai_key && <span className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 px-2 py-0.5 rounded">OpenAI configured</span>}
                  {settings.has_anthropic_key && <span className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 px-2 py-0.5 rounded">Anthropic configured</span>}
                  {settings.has_google_ai_key && <span className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 px-2 py-0.5 rounded">Google AI configured</span>}
                  {settings.has_google_search_key && <span className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 px-2 py-0.5 rounded">Google Search configured</span>}
                </div>
              )}
              <form onSubmit={handleUpdateCredentials} className="space-y-3">
                <div>
                  <label className="block text-sm font-medium mb-1">OpenAI API Key</label>
                  <input
                    type="password"
                    value={openaiKey}
                    onChange={e => setOpenaiKey(e.target.value)}
                    placeholder={settings?.has_openai_key ? "••••••••••••••• (set)" : "sk-..."}
                    className="w-full border rounded px-3 py-2 text-sm bg-background"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Anthropic API Key</label>
                  <input
                    type="password"
                    value={anthropicKey}
                    onChange={e => setAnthropicKey(e.target.value)}
                    placeholder={settings?.has_anthropic_key ? "••••••••••••••• (set)" : "sk-ant-..."}
                    className="w-full border rounded px-3 py-2 text-sm bg-background"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Google AI API Key</label>
                  <input
                    type="password"
                    value={googleAiKey}
                    onChange={e => setGoogleAiKey(e.target.value)}
                    placeholder={settings?.has_google_ai_key ? "••••••••••••••• (set)" : "AIza..."}
                    className="w-full border rounded px-3 py-2 text-sm bg-background"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Google Search API Key</label>
                  <input
                    type="password"
                    value={googleSearchKey}
                    onChange={e => setGoogleSearchKey(e.target.value)}
                    placeholder={settings?.has_google_search_key ? "••••••••••••••• (set)" : "AIza..."}
                    className="w-full border rounded px-3 py-2 text-sm bg-background"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Google Search Engine ID</label>
                  <input
                    type="text"
                    value={googleSearchEngineId}
                    onChange={e => setGoogleSearchEngineId(e.target.value)}
                    placeholder="cx=..."
                    className="w-full border rounded px-3 py-2 text-sm bg-background"
                  />
                </div>
                <Button type="submit" disabled={loading}>
                  {loading ? "Saving..." : "Update API Keys"}
                </Button>
              </form>
            </section>

            {/* Timezone */}
            <section className="bg-card border rounded-lg p-6 space-y-4">
              <h2 className="text-base font-semibold">Timezone</h2>
              <form onSubmit={handleSaveTimezone} className="flex gap-3 items-end">
                <div className="flex-1">
                  <label className="block text-sm font-medium mb-1">Team Timezone (IANA format)</label>
                  <input
                    type="text"
                    value={timezone}
                    onChange={e => setTimezone(e.target.value)}
                    placeholder="UTC"
                    className="w-full border rounded px-3 py-2 text-sm bg-background"
                  />
                </div>
                <Button type="submit" disabled={loading}>
                  {loading ? "Saving..." : "Save"}
                </Button>
              </form>
            </section>

            {/* MCP Servers */}
            <section className="bg-card border rounded-lg p-6 space-y-4">
              <h2 className="text-base font-semibold">MCP Servers</h2>
              <p className="text-sm text-muted-foreground">MCP servers available to all team agents.</p>

              {mcpServers.length > 0 && (
                <div className="space-y-2">
                  {mcpServers.map(server => (
                    <div key={server.id} className="flex items-center gap-2 p-3 border rounded-lg">
                      {editingMcp?.id === server.id ? (
                        <form onSubmit={handleUpdateMcpServer} className="flex-1 space-y-2">
                          <input
                            type="text"
                            value={newMcpName}
                            onChange={e => setNewMcpName(e.target.value)}
                            placeholder="Name"
                            className="w-full border rounded px-3 py-1.5 text-sm bg-background"
                            required
                          />
                          <input
                            type="url"
                            value={newMcpUrl}
                            onChange={e => setNewMcpUrl(e.target.value)}
                            placeholder="URL"
                            className="w-full border rounded px-3 py-1.5 text-sm bg-background"
                            required
                          />
                          {newMcpHeaders.map((h, i) => (
                            <div key={i} className="flex gap-2">
                              <input type="text" value={h.key} onChange={e => updateMcpHeader(i, "key", e.target.value)} placeholder="Header" className="flex-1 border rounded px-2 py-1 text-sm bg-background" />
                              <input type="text" value={h.value} onChange={e => updateMcpHeader(i, "value", e.target.value)} placeholder="Value" className="flex-1 border rounded px-2 py-1 text-sm bg-background" />
                              <Button type="button" variant="ghost" size="sm" onClick={() => removeMcpHeader(i)}>Remove</Button>
                            </div>
                          ))}
                          <div className="flex gap-2">
                            <Button type="button" variant="outline" size="sm" onClick={addMcpHeader}>Add Header</Button>
                            <Button type="submit" size="sm" disabled={loading}>Save</Button>
                            <Button type="button" variant="ghost" size="sm" onClick={cancelEditMcp}>Cancel</Button>
                          </div>
                        </form>
                      ) : (
                        <>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm">{server.name}</p>
                            <p className="text-xs text-muted-foreground truncate">{server.url}</p>
                          </div>
                          <Button variant="ghost" size="sm" onClick={() => startEditMcp(server)}>Edit</Button>
                          <Button variant="ghost" size="sm" onClick={() => handleDeleteMcpServer(server.id)} className="text-destructive hover:text-destructive">Delete</Button>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {!editingMcp && (
                <form onSubmit={handleAddMcpServer} className="space-y-3 border-t pt-4">
                  <h3 className="text-sm font-medium">Add MCP Server</h3>
                  <input
                    type="text"
                    value={newMcpName}
                    onChange={e => setNewMcpName(e.target.value)}
                    placeholder="Name"
                    className="w-full border rounded px-3 py-2 text-sm bg-background"
                    required
                  />
                  <input
                    type="url"
                    value={newMcpUrl}
                    onChange={e => setNewMcpUrl(e.target.value)}
                    placeholder="https://..."
                    className="w-full border rounded px-3 py-2 text-sm bg-background"
                    required
                  />
                  {newMcpHeaders.map((h, i) => (
                    <div key={i} className="flex gap-2">
                      <input type="text" value={h.key} onChange={e => updateMcpHeader(i, "key", e.target.value)} placeholder="Header" className="flex-1 border rounded px-2 py-1.5 text-sm bg-background" />
                      <input type="text" value={h.value} onChange={e => updateMcpHeader(i, "value", e.target.value)} placeholder="Value" className="flex-1 border rounded px-2 py-1.5 text-sm bg-background" />
                      <Button type="button" variant="ghost" size="sm" onClick={() => removeMcpHeader(i)}>Remove</Button>
                    </div>
                  ))}
                  <div className="flex gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={addMcpHeader}>Add Header</Button>
                    <Button type="submit" disabled={loading}>Add Server</Button>
                  </div>
                </form>
              )}
            </section>

            {/* URL Tools */}
            <section className="bg-card border rounded-lg p-6 space-y-4">
              <h2 className="text-base font-semibold">URL Tools</h2>
              <p className="text-sm text-muted-foreground">URL tools available to all team agents.</p>

              {urlTools.length > 0 && (
                <div className="space-y-2">
                  {urlTools.map(tool => (
                    <div key={tool.id} className="flex items-center gap-2 p-3 border rounded-lg">
                      {editingUrlTool?.id === tool.id ? (
                        <form onSubmit={handleUpdateUrlTool} className="flex-1 space-y-2">
                          <input type="text" value={newUrlToolName} onChange={e => setNewUrlToolName(e.target.value)} placeholder="Name" className="w-full border rounded px-3 py-1.5 text-sm bg-background" required />
                          <input type="text" value={newUrlToolDescription} onChange={e => setNewUrlToolDescription(e.target.value)} placeholder="Description (optional)" className="w-full border rounded px-3 py-1.5 text-sm bg-background" />
                          <input type="url" value={newUrlToolUrl} onChange={e => setNewUrlToolUrl(e.target.value)} placeholder="URL" className="w-full border rounded px-3 py-1.5 text-sm bg-background" required />
                          <select value={newUrlToolMethod} onChange={e => setNewUrlToolMethod(e.target.value)} className="w-full border rounded px-3 py-1.5 text-sm bg-background">
                            {["GET", "POST", "PUT", "DELETE", "PATCH"].map(m => <option key={m}>{m}</option>)}
                          </select>
                          {newUrlToolHeaders.map((h, i) => (
                            <div key={i} className="flex gap-2">
                              <input type="text" value={h.key} onChange={e => updateUrlHeader(i, "key", e.target.value)} placeholder="Header" className="flex-1 border rounded px-2 py-1 text-sm bg-background" />
                              <input type="text" value={h.value} onChange={e => updateUrlHeader(i, "value", e.target.value)} placeholder="Value" className="flex-1 border rounded px-2 py-1 text-sm bg-background" />
                              <Button type="button" variant="ghost" size="sm" onClick={() => removeUrlHeader(i)}>Remove</Button>
                            </div>
                          ))}
                          <div className="flex gap-2">
                            <Button type="button" variant="outline" size="sm" onClick={addUrlHeader}>Add Header</Button>
                            <Button type="submit" size="sm" disabled={loading}>Save</Button>
                            <Button type="button" variant="ghost" size="sm" onClick={cancelEditUrlTool}>Cancel</Button>
                          </div>
                        </form>
                      ) : (
                        <>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm">{tool.name}</p>
                            <p className="text-xs text-muted-foreground">{tool.method} {tool.url}</p>
                            {tool.description && <p className="text-xs text-muted-foreground">{tool.description}</p>}
                          </div>
                          <Button variant="ghost" size="sm" onClick={() => startEditUrlTool(tool)}>Edit</Button>
                          <Button variant="ghost" size="sm" onClick={() => handleDeleteUrlTool(tool.id)} className="text-destructive hover:text-destructive">Delete</Button>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {!editingUrlTool && (
                <form onSubmit={handleAddUrlTool} className="space-y-3 border-t pt-4">
                  <h3 className="text-sm font-medium">Add URL Tool</h3>
                  <input type="text" value={newUrlToolName} onChange={e => setNewUrlToolName(e.target.value)} placeholder="Name" className="w-full border rounded px-3 py-2 text-sm bg-background" required />
                  <input type="text" value={newUrlToolDescription} onChange={e => setNewUrlToolDescription(e.target.value)} placeholder="Description (optional)" className="w-full border rounded px-3 py-2 text-sm bg-background" />
                  <input type="url" value={newUrlToolUrl} onChange={e => setNewUrlToolUrl(e.target.value)} placeholder="https://..." className="w-full border rounded px-3 py-2 text-sm bg-background" required />
                  <select value={newUrlToolMethod} onChange={e => setNewUrlToolMethod(e.target.value)} className="w-full border rounded px-3 py-2 text-sm bg-background">
                    {["GET", "POST", "PUT", "DELETE", "PATCH"].map(m => <option key={m}>{m}</option>)}
                  </select>
                  {newUrlToolHeaders.map((h, i) => (
                    <div key={i} className="flex gap-2">
                      <input type="text" value={h.key} onChange={e => updateUrlHeader(i, "key", e.target.value)} placeholder="Header" className="flex-1 border rounded px-2 py-1.5 text-sm bg-background" />
                      <input type="text" value={h.value} onChange={e => updateUrlHeader(i, "value", e.target.value)} placeholder="Value" className="flex-1 border rounded px-2 py-1.5 text-sm bg-background" />
                      <Button type="button" variant="ghost" size="sm" onClick={() => removeUrlHeader(i)}>Remove</Button>
                    </div>
                  ))}
                  <div className="flex gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={addUrlHeader}>Add Header</Button>
                    <Button type="submit" disabled={loading}>Add Tool</Button>
                  </div>
                </form>
              )}
            </section>

            {/* Notification Settings */}
            <section className="bg-card border rounded-lg p-6 space-y-4">
              <h2 className="text-base font-semibold">Notification Settings</h2>
              <p className="text-sm text-muted-foreground">Shared notification configuration for team agents.</p>

              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <Switch checked={notifEmailEnabled} onCheckedChange={setNotifEmailEnabled} />
                  <label className="text-sm font-medium">Email notifications enabled</label>
                </div>
                {notifEmailEnabled && (
                  <div className="space-y-3">
                    <h3 className="text-sm font-medium">Email Destinations</h3>
                    {emailAddresses.length > 0 && (
                      <div className="space-y-2">
                        {emailAddresses.map((entry, index) => (
                          <div
                            key={index}
                            className="flex items-center justify-between bg-muted/50 rounded-md px-3 py-2"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="text-sm font-medium truncate">{entry.name}</div>
                              <div className="text-xs text-muted-foreground truncate">{entry.email}</div>
                            </div>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => removeEmailAddress(index)}
                            >
                              Remove
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={newEmailName}
                        onChange={(e) => setNewEmailName(e.target.value)}
                        placeholder="Name (e.g. Ops Team)"
                        className="flex-1 border rounded px-3 py-2 text-sm bg-background"
                      />
                      <input
                        type="email"
                        value={newEmailAddress}
                        onChange={(e) => setNewEmailAddress(e.target.value)}
                        placeholder="team@example.com"
                        className="flex-1 border rounded px-3 py-2 text-sm bg-background"
                      />
                      <Button variant="outline" size="sm" onClick={addEmailAddress}>
                        Add
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Add one or more named email destinations. Agents and schedules can target a specific destination by name.
                    </p>
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium mb-2">Webhook URLs</label>
                  {webhooks.map((wh, i) => (
                    <div key={i} className="flex items-center gap-2 mb-2">
                      <span className="text-sm flex-1">{wh.name}: {wh.url}</span>
                      <Button type="button" variant="ghost" size="sm" onClick={() => removeWebhook(i)} className="text-destructive hover:text-destructive">Remove</Button>
                    </div>
                  ))}
                  <div className="flex gap-2">
                    <input type="text" value={newWebhookName} onChange={e => setNewWebhookName(e.target.value)} placeholder="Name" className="flex-1 border rounded px-3 py-2 text-sm bg-background" />
                    <input type="url" value={newWebhookUrl} onChange={e => setNewWebhookUrl(e.target.value)} placeholder="https://..." className="flex-1 border rounded px-3 py-2 text-sm bg-background" />
                    <Button type="button" variant="outline" size="sm" onClick={addWebhook}>Add</Button>
                  </div>
                </div>

                <div className="border-t pt-4 space-y-3">
                  <div className="flex items-center gap-3">
                    <Switch checked={pushoverEnabled} onCheckedChange={setPushoverEnabled} />
                    <label className="text-sm font-medium">Pushover notifications enabled</label>
                  </div>
                  {pushoverEnabled && (
                    <>
                      <div>
                        <label className="block text-sm font-medium mb-1">Pushover User Key</label>
                        <input type="text" value={pushoverUserKey} onChange={e => setPushoverUserKey(e.target.value)} placeholder="User key" className="w-full border rounded px-3 py-2 text-sm bg-background" />
                      </div>
                      <div>
                        <label className="block text-sm font-medium mb-1">Pushover API Token</label>
                        <input type="password" value={pushoverApiToken} onChange={e => setPushoverApiToken(e.target.value)} placeholder="API token" className="w-full border rounded px-3 py-2 text-sm bg-background" />
                      </div>
                    </>
                  )}
                </div>

                <Button onClick={handleSaveNotificationSettings} disabled={notifLoading}>
                  {notifLoading ? "Saving..." : "Save Notification Settings"}
                </Button>
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
