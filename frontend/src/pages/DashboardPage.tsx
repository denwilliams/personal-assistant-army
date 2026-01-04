import React, { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
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
  created_at: string;
  updated_at: string;
}

export default function DashboardPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadAgents();
  }, []);

  // Keyboard shortcuts for first 9 favorite agents
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      // Only handle number keys 1-9
      if (e.key >= '1' && e.key <= '9') {
        // Don't trigger if user is typing in an input field
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
          return;
        }

        const shortcutNumber = parseInt(e.key);
        const favoriteAgents = agents.filter(a => a.is_favorite).slice(0, 9);
        const targetAgent = favoriteAgents[shortcutNumber - 1];

        if (targetAgent) {
          navigate(`/chat/${targetAgent.slug}`);
        }
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [agents, navigate]);

  const loadAgents = async () => {
    try {
      setLoading(true);
      const data = await api.agents.list();
      setAgents(data);
    } catch (err) {
      console.error("Failed to load agents:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">
                Personal Assistant Army
              </h1>
              <p className="text-sm text-slate-600">Welcome back, {user?.name}</p>
            </div>
            <div className="flex gap-2">
              <Link to="/profile">
                <Button variant="outline">Profile</Button>
              </Link>
              <Button variant="outline" onClick={logout}>
                Logout
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        {/* My Agents Section */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-slate-900">My Agents</h2>
            <Link to="/agents">
              <Button variant="outline" size="sm">Manage Agents →</Button>
            </Link>
          </div>

          {loading ? (
            <div className="text-center py-12">
              <p className="text-slate-600">Loading agents...</p>
            </div>
          ) : agents.length === 0 ? (
            <div className="bg-white rounded-lg shadow p-8 text-center">
              <p className="text-slate-600 mb-4">No agents yet</p>
              <Link to="/agents">
                <Button>Create Your First Agent</Button>
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {agents.map((agent, index) => {
                // Calculate keyboard shortcut number (1-9) for favorites
                const favoriteAgents = agents.filter(a => a.is_favorite);
                const favoriteIndex = favoriteAgents.findIndex(a => a.id === agent.id);
                const shortcutNumber = favoriteIndex >= 0 && favoriteIndex < 9 ? favoriteIndex + 1 : null;

                return (
                  <Link key={agent.id} to={`/chat/${agent.slug}`}>
                    <div className={`rounded-lg shadow p-6 hover:shadow-lg transition-shadow cursor-pointer h-full relative ${
                      agent.is_favorite
                        ? 'bg-gradient-to-br from-amber-50 to-white border-2 border-amber-300'
                        : 'bg-white'
                    }`}>
                      {/* Keyboard Shortcut Badge */}
                      {shortcutNumber && (
                        <div className="absolute top-3 right-3 w-8 h-8 bg-slate-700 text-white rounded flex items-center justify-center font-mono font-bold text-sm shadow-md border-2 border-slate-500">
                          {shortcutNumber}
                        </div>
                      )}
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex items-center gap-2">
                          {agent.is_favorite && <span className="text-xl">⭐</span>}
                          <h3 className="text-lg font-semibold text-slate-900">{agent.name}</h3>
                        </div>
                      {agent.internet_search_enabled && (
                        <span className="text-xs text-blue-600 bg-blue-50 px-2 py-1 rounded">
                          🔍
                        </span>
                      )}
                    </div>
                    {agent.purpose && (
                      <p className="text-sm text-slate-600 mb-3">{agent.purpose}</p>
                    )}
                    <p className="text-xs text-slate-500 line-clamp-2">
                      {agent.system_prompt}
                    </p>
                  </div>
                </Link>
                );
              })}
            </div>
          )}
        </section>

        {/* Quick Actions */}
        <section>
          <h2 className="text-xl font-semibold text-slate-900 mb-4">Quick Actions</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Link to="/profile">
              <div className="bg-white rounded-lg shadow p-6 hover:shadow-lg transition-shadow cursor-pointer">
                <h3 className="text-lg font-semibold mb-2">⚙️ Settings</h3>
                <p className="text-sm text-slate-600">
                  Configure API keys, MCP servers, and preferences
                </p>
              </div>
            </Link>

            <Link to="/agents">
              <div className="bg-white rounded-lg shadow p-6 hover:shadow-lg transition-shadow cursor-pointer">
                <h3 className="text-lg font-semibold mb-2">➕ Create Agent</h3>
                <p className="text-sm text-slate-600">
                  Set up a new AI agent with custom tools
                </p>
              </div>
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
