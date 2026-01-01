import React, { useState } from "react";
import { Button } from "@/components/ui/button";

export default function App() {
  const [healthStatus, setHealthStatus] = useState<string>("");
  const [loading, setLoading] = useState(false);

  const checkHealth = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/health");
      const data = await response.json();
      setHealthStatus(`API Status: ${data.status}`);
    } catch (error) {
      setHealthStatus(`Error: ${error instanceof Error ? error.message : "Unknown error"}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-4">
          Personal Assistant Army
        </h1>
        <p className="text-gray-600 mb-6">
          Welcome to your AI agent platform
        </p>

        <Button
          onClick={checkHealth}
          disabled={loading}
          className="w-full"
        >
          {loading ? "Checking..." : "Test API Connection"}
        </Button>

        {healthStatus && (
          <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-md">
            <p className="text-green-800 text-sm">{healthStatus}</p>
          </div>
        )}
      </div>
    </div>
  );
}
