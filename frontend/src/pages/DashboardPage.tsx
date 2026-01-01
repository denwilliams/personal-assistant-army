import React from "react";
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
            <Button variant="outline" onClick={logout}>
              Logout
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold mb-4">Dashboard</h2>
          <p className="text-slate-600">
            Your AI agent management dashboard will appear here.
          </p>
        </div>
      </main>
    </div>
  );
}
