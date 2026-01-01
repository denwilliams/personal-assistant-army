import { sql } from "bun";
import indexHtml from "./index.html";
import { initializeDatabase } from "./backend/db/connection";
import { runMigrations } from "./backend/migrations/migrate";
import { createHealthHandler } from "./backend/handlers/health";
import type { SqlClient } from "./backend/types/sql";

interface Config {
  port: number;
  databaseUrl?: string;
  isDevelopment: boolean;
}

interface Dependencies {
  sql: SqlClient | null;
}

function loadConfig(): Config {
  return {
    port: Number(process.env.PORT) || 3000,
    databaseUrl: process.env.DATABASE_URL,
    isDevelopment: process.env.NODE_ENV !== "production",
  };
}

async function startServer(config: Config, deps: Dependencies) {
  // Create handlers with injected dependencies
  const healthHandler = createHealthHandler({ sql: deps.sql });

  const server = Bun.serve({
    port: config.port,
    routes: {
      "/": indexHtml,
      "/api/health": {
        GET: healthHandler,
      },
    },
    development: config.isDevelopment ? {
      hmr: true,
      console: true,
    } : undefined,
  });

  console.log(`Server running on http://localhost:${config.port}`);
  return server;
}

async function waitForShutdown(): Promise<void> {
  return new Promise((resolve) => {
    const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];

    const handler = (signal: NodeJS.Signals) => {
      console.log(`\nReceived ${signal}, shutting down gracefully...`);
      signals.forEach(sig => process.off(sig, handler));
      resolve();
    };

    signals.forEach(signal => {
      process.on(signal, handler);
    });
  });
}

async function main() {
  const config = loadConfig();

  // Create dependencies
  const deps: Dependencies = {
    sql: config.databaseUrl ? sql : null,
  };

  // Initialize database connection and run migrations on startup
  if (deps.sql) {
    await initializeDatabase(deps.sql, config.databaseUrl);
    await runMigrations(deps.sql);
  }

  // Start the server
  const server = await startServer(config, deps);

  // Wait for interrupt signal
  await waitForShutdown();

  // Gracefully stop the server
  console.log('Stopping server...');
  await server.stop();
  console.log('Server stopped');

  // Exit process after graceful shutdown
  process.exit(0);
}

main();
