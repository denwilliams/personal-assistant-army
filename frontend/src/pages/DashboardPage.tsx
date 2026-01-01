import React from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useAuth } from "../contexts/AuthContext";

export default function DashboardPage() {
  const { user, logout } = useAuth();

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
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Agents Card */}
          <Link to="/agents">
            <div className="bg-white rounded-lg shadow p-6 hover:shadow-lg transition-shadow cursor-pointer">
              <h2 className="text-xl font-semibold mb-2">🤖 Agents</h2>
              <p className="text-slate-600 mb-4">
                Create and manage your AI agents with custom tools and capabilities
              </p>
              <Button>Manage Agents →</Button>
            </div>
          </Link>

          {/* Profile Card */}
          <Link to="/profile">
            <div className="bg-white rounded-lg shadow p-6 hover:shadow-lg transition-shadow cursor-pointer">
              <h2 className="text-xl font-semibold mb-2">⚙️ Settings</h2>
              <p className="text-slate-600 mb-4">
                Configure API keys, MCP servers, and account preferences
              </p>
              <Button variant="outline">Go to Profile →</Button>
            </div>
          </Link>
        </div>

        {/* Quick Stats */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-4">Quick Overview</h2>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <p className="text-2xl font-bold text-slate-900">-</p>
              <p className="text-sm text-slate-600">Active Agents</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-900">
                {user?.has_openai_key ? "✓" : "✗"}
              </p>
              <p className="text-sm text-slate-600">OpenAI Key</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-900">-</p>
              <p className="text-sm text-slate-600">MCP Servers</p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
