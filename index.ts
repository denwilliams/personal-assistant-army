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
import { createAgentMemoriesHandlers } from "./backend/handlers/agent-memories";
import { createChatHandlers } from "./backend/handlers/chat";
import { createAuthMiddleware } from "./backend/middleware/auth";
import { GoogleOAuthService } from "./backend/auth/google-oauth";
import { PostgresUserRepository } from "./backend/repositories/postgres/PostgresUserRepository";
import { PostgresSessionRepository } from "./backend/repositories/postgres/PostgresSessionRepository";
import { PostgresMcpServerRepository } from "./backend/repositories/postgres/PostgresMcpServerRepository";
import { PostgresAgentRepository } from "./backend/repositories/postgres/PostgresAgentRepository";
import { PostgresConversationRepository } from "./backend/repositories/postgres/PostgresConversationRepository";
import { PostgresMemoryRepository } from "./backend/repositories/postgres/PostgresMemoryRepository";
import { AgentFactory } from "./backend/services/AgentFactory";
import type { SqlClient } from "./backend/types/sql";
import type { UserRepository } from "./backend/repositories/UserRepository";
import type { SessionRepository } from "./backend/repositories/SessionRepository";
import type { McpServerRepository } from "./backend/repositories/McpServerRepository";
import type { AgentRepository } from "./backend/repositories/AgentRepository";
import type { ConversationRepository } from "./backend/repositories/ConversationRepository";
import type { MemoryRepository } from "./backend/repositories/MemoryRepository";

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
  conversationRepository: ConversationRepository | null;
  memoryRepository: MemoryRepository | null;
  googleOAuth: GoogleOAuthService | null;
  agentFactory: AgentFactory | null;
}

function loadConfig(): Config {
  // Handle PostgreSQL schema configuration
  let databaseUrl = process.env.DATABASE_URL;
  const postgresSchema = process.env.POSTGRES_SCHEMA;

  // If a custom schema is specified, append it to the DATABASE_URL
  if (databaseUrl && postgresSchema && postgresSchema !== 'public') {
    try {
      const url = new URL(databaseUrl);
      // Add schema to search_path via options parameter
      url.searchParams.set('options', `-c search_path=${postgresSchema}`);
      databaseUrl = url.toString();
    } catch (err) {
      console.warn('Failed to parse DATABASE_URL, using as-is:', err);
    }
  }

  return {
    port: Number(process.env.PORT) || 3000,
    databaseUrl,
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
    "/chat/:slug": indexHtml,
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
        PUT: mcpServerHandlers.update,
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
        routes["/api/agents/:slug/agent-tools"] = {
          GET: agentToolsHandlers.getAgentTools,
          POST: agentToolsHandlers.addAgentTool,
        };
        routes["/api/agents/:slug/agent-tools/:toolAgentSlug"] = {
          DELETE: agentToolsHandlers.removeAgentTool,
        };
        routes["/api/agents/:slug/handoffs"] = {
          GET: agentToolsHandlers.getHandoffs,
          POST: agentToolsHandlers.addHandoff,
        };
        routes["/api/agents/:slug/handoffs/:toAgentSlug"] = {
          DELETE: agentToolsHandlers.removeHandoff,
        };

        // Add agent memories routes
        if (deps.memoryRepository) {
          const agentMemoriesHandlers = createAgentMemoriesHandlers({
            agentRepository: deps.agentRepository,
            memoryRepository: deps.memoryRepository,
            authenticate,
          });

          routes["/api/agents/:slug/memories"] = {
            GET: agentMemoriesHandlers.getMemories,
          };
          routes["/api/agents/:slug/memories/:key"] = {
            DELETE: agentMemoriesHandlers.deleteMemory,
          };
        }
      }

      // Add chat routes
      if (deps.conversationRepository && deps.agentFactory && config.encryptionSecret) {
        const chatHandlers = createChatHandlers({
          agentFactory: deps.agentFactory,
          conversationRepository: deps.conversationRepository,
          authenticate,
          encryptionSecret: config.encryptionSecret,
        });

        routes["/api/chat/:slug"] = {
          POST: chatHandlers.sendMessage,
        };
        routes["/api/chat/:slug/stream"] = {
          POST: chatHandlers.sendMessageStream,
        };
        routes["/api/chat/:slug/history"] = {
          GET: chatHandlers.getHistory,
        };
        routes["/api/chat/:slug/conversation/:id"] = {
          GET: chatHandlers.getConversation,
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
    // Increase timeout for AI agent responses (2 minutes)
    idleTimeout: 120,
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
    conversationRepository: null,
    memoryRepository: null,
    googleOAuth: null,
    agentFactory: null,
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
    deps.conversationRepository = new PostgresConversationRepository();
    deps.memoryRepository = new PostgresMemoryRepository();

    // Create AgentFactory
    if (deps.agentRepository && deps.userRepository && deps.mcpServerRepository && deps.memoryRepository) {
      deps.agentFactory = new AgentFactory({
        agentRepository: deps.agentRepository,
        userRepository: deps.userRepository,
        mcpServerRepository: deps.mcpServerRepository,
        memoryRepository: deps.memoryRepository,
      });
    }
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
