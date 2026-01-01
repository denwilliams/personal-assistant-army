import indexHtml from "./index.html";
import { runMigrations } from "./backend/migrations/migrate";

interface Config {
  port: number;
  databaseUrl?: string;
  isDevelopment: boolean;
}

function loadConfig(): Config {
  return {
    port: Number(process.env.PORT) || 3000,
    databaseUrl: process.env.DATABASE_URL,
    isDevelopment: process.env.NODE_ENV !== "production",
  };
}

async function startServer(config: Config) {
  const server = Bun.serve({
    port: config.port,
    routes: {
      "/": indexHtml,
      "/api/health": {
        GET: () => {
          return new Response(JSON.stringify({ status: "ok" }), {
            headers: { "Content-Type": "application/json" },
          });
        },
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

  // Run database migrations on startup
  await runMigrations(config.databaseUrl);

  // Start the server
  const server = await startServer(config);

  // Wait for interrupt signal
  await waitForShutdown();

  // Gracefully stop the server
  console.log('Stopping server...');
  server.stop();
  console.log('Server stopped');
}

main();
