import type { SqlClient } from "../types/sql";

interface HealthHandlerDependencies {
  sql: SqlClient | null;
}

/**
 * Factory function to create health check handler
 */
export function createHealthHandler(deps: HealthHandlerDependencies) {
  return async (): Promise<Response> => {
    const health: { status: string; database?: string } = { status: "ok" };

    // Check database connection if configured
    if (deps.sql) {
      try {
        await deps.sql`SELECT 1 as test`;
        health.database = "connected";
      } catch (error) {
        health.status = "degraded";
        health.database = "disconnected";
      }
    }

    return new Response(JSON.stringify(health), {
      headers: { "Content-Type": "application/json" },
    });
  };
}
