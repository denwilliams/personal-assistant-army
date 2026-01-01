import { sql } from "bun";
import indexHtml from "./frontend/index.html";
import { initializeDatabase } from "./backend/db/connection";
import { runMigrations } from "./backend/migrations/migrate";
import { createHealthHandler } from "./backend/handlers/health";
import { createAuthHandlers } from "./backend/handlers/auth";
import { createUserHandlers } from "./backend/handlers/user";
import { createMcpServerHandlers } from "./backend/handlers/mcp-servers";
import { createAgentHandlers } from "./backend/handlers/agents";
import { createAgentToolsHandlers } from "./backend/handlers/agent-tools";
import { createAuthMiddleware } from "./backend/middleware/auth";
import { GoogleOAuthService } from "./backend/auth/google-oauth";
import { PostgresUserRepository } from "./backend/repositories/postgres/PostgresUserRepository";
import { PostgresSessionRepository } from "./backend/repositories/postgres/PostgresSessionRepository";
import { PostgresMcpServerRepository } from "./backend/repositories/postgres/PostgresMcpServerRepository";
import { PostgresAgentRepository } from "./backend/repositories/postgres/PostgresAgentRepository";
import type { SqlClient } from "./backend/types/sql";
import type { UserRepository } from "./backend/repositories/UserRepository";
import type { SessionRepository } from "./backend/repositories/SessionRepository";
import type { McpServerRepository } from "./backend/repositories/McpServerRepository";
import type { AgentRepository } from "./backend/repositories/AgentRepository";

interface Config {
  port: number;
  databaseUrl?: string;
  isDevelopment: boolean;
  googleClientId?: string;
  googleClientSecret?: string;
  googleRedirectUri?: string;
  frontendUrl: string;
  encryptionSecret?: string;
}

interface Dependencies {
  sql: SqlClient | null;
  userRepository: UserRepository | null;
  sessionRepository: SessionRepository | null;
  mcpServerRepository: McpServerRepository | null;
  agentRepository: AgentRepository | null;
  googleOAuth: GoogleOAuthService | null;
}

function loadConfig(): Config {
  return {
    port: Number(process.env.PORT) || 3000,
    databaseUrl: process.env.DATABASE_URL,
    isDevelopment: process.env.NODE_ENV !== "production",
    googleClientId: process.env.GOOGLE_CLIENT_ID,
    googleClientSecret: process.env.GOOGLE_CLIENT_SECRET,
    googleRedirectUri: process.env.GOOGLE_REDIRECT_URI,
    frontendUrl: process.env.FRONTEND_URL || "http://localhost:3000",
    encryptionSecret: process.env.ENCRYPTION_SECRET,
  };
}

async function startServer(config: Config, deps: Dependencies) {
  // Create handlers with injected dependencies
  const healthHandler = createHealthHandler({ sql: deps.sql });

  // Create routes object
  const routes: Record<string, any> = {
    "/": indexHtml,
    "/login": indexHtml,
    "/profile": indexHtml,
    "/agents": indexHtml,
    "/api/health": {
      GET: healthHandler,
    },
  };

  // Add auth routes if Google OAuth is configured
  if (deps.googleOAuth && deps.userRepository && deps.sessionRepository) {
    const authHandlers = createAuthHandlers({
      googleOAuth: deps.googleOAuth,
      userRepository: deps.userRepository,
      sessionRepository: deps.sessionRepository,
      frontendUrl: config.frontendUrl,
      isProduction: !config.isDevelopment,
    });

    routes["/api/auth/login"] = {
      GET: authHandlers.login,
    };
    routes["/api/auth/callback"] = {
      GET: authHandlers.callback,
    };
    routes["/api/auth/logout"] = {
      POST: authHandlers.logout,
    };

    // Create auth middleware for protected routes
    const authenticate = createAuthMiddleware({
      sessionRepository: deps.sessionRepository,
      userRepository: deps.userRepository,
    });

    // Add user API routes if encryption secret is configured
    if (config.encryptionSecret) {
      const userHandlers = createUserHandlers({
        userRepository: deps.userRepository,
        authenticate,
        encryptionSecret: config.encryptionSecret,
      });

      routes["/api/user/profile"] = {
        GET: userHandlers.getProfile,
        PUT: userHandlers.updateProfile,
      };
      routes["/api/user/credentials"] = {
        PUT: userHandlers.updateCredentials,
      };
    } else {
      console.warn("Encryption secret not configured - user credential routes disabled");
    }

    // Add MCP server routes
    if (deps.mcpServerRepository) {
      const mcpServerHandlers = createMcpServerHandlers({
        mcpServerRepository: deps.mcpServerRepository,
        authenticate,
      });

      routes["/api/user/mcp-servers"] = {
        GET: mcpServerHandlers.list,
        POST: mcpServerHandlers.create,
      };
      routes["/api/user/mcp-servers/:id"] = {
        DELETE: mcpServerHandlers.remove,
      };
    }

    // Add agent routes
    if (deps.agentRepository) {
      const agentHandlers = createAgentHandlers({
        agentRepository: deps.agentRepository,
        authenticate,
      });

      routes["/api/agents"] = {
        GET: agentHandlers.list,
        POST: agentHandlers.create,
      };
      routes["/api/agents/:slug"] = {
        GET: agentHandlers.get,
        PUT: agentHandlers.update,
        DELETE: agentHandlers.remove,
      };

      // Add agent tools/handoffs routes
      if (deps.mcpServerRepository) {
        const agentToolsHandlers = createAgentToolsHandlers({
          agentRepository: deps.agentRepository,
          mcpServerRepository: deps.mcpServerRepository,
          authenticate,
        });

        routes["/api/agents/:slug/tools"] = {
          GET: agentToolsHandlers.getTools,
        };
        routes["/api/agents/:slug/tools/built-in"] = {
          POST: agentToolsHandlers.addBuiltInTool,
        };
        routes["/api/agents/:slug/tools/built-in/:toolId"] = {
          DELETE: agentToolsHandlers.removeBuiltInTool,
        };
        routes["/api/agents/:slug/tools/mcp"] = {
          POST: agentToolsHandlers.addMcpTool,
        };
        routes["/api/agents/:slug/tools/mcp/:mcpServerId"] = {
          DELETE: agentToolsHandlers.removeMcpTool,
        };
        routes["/api/agents/:slug/handoffs"] = {
          GET: agentToolsHandlers.getHandoffs,
          POST: agentToolsHandlers.addHandoff,
        };
        routes["/api/agents/:slug/handoffs/:toAgentSlug"] = {
          DELETE: agentToolsHandlers.removeHandoff,
        };
      }
    }
  } else {
    console.warn("Google OAuth not configured - authentication routes disabled");
  }

  const server = Bun.serve({
    port: config.port,
    routes,
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
    userRepository: null,
    sessionRepository: null,
    mcpServerRepository: null,
    agentRepository: null,
    googleOAuth: null,
  };

  // Initialize database connection and run migrations on startup
  if (deps.sql) {
    await initializeDatabase(deps.sql, config.databaseUrl);
    await runMigrations(deps.sql);

    // Create repository instances (only if database is configured)
    deps.userRepository = new PostgresUserRepository();
    deps.sessionRepository = new PostgresSessionRepository();
    deps.mcpServerRepository = new PostgresMcpServerRepository();
    deps.agentRepository = new PostgresAgentRepository();
  }

  // Create Google OAuth service if configured
  if (config.googleClientId && config.googleClientSecret && config.googleRedirectUri) {
    deps.googleOAuth = new GoogleOAuthService({
      clientId: config.googleClientId,
      clientSecret: config.googleClientSecret,
      redirectUri: config.googleRedirectUri,
    });
  } else {
    console.warn("Google OAuth credentials not configured");
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
