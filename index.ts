// IMPORTANT: Configure DATABASE_URL before importing sql client
// Heroku Postgres requires SSL, and we need to set it on the env var before Bun's sql client reads it
if (process.env.DATABASE_URL) {
  try {
    const url = new URL(process.env.DATABASE_URL);

    // Enable SSL for Heroku Postgres (or any production DB that requires it)
    // Skip SSL only if explicitly disabled via DISABLE_SSL=true
    if (process.env.DISABLE_SSL !== 'true' && !url.searchParams.has('sslmode')) {
      url.searchParams.set('sslmode', 'require');
      console.log('Configuring database connection with SSL');
    }

    // Add custom schema if specified
    const postgresSchema = process.env.POSTGRES_SCHEMA;
    if (postgresSchema && postgresSchema !== 'public') {
      url.searchParams.set('options', `-c search_path=${postgresSchema}`);
      console.log(`Configuring custom schema: ${postgresSchema}`);
    }

    process.env.DATABASE_URL = url.toString();
  } catch (err) {
    console.warn('Failed to configure DATABASE_URL:', err);
  }
}

import { sql } from "bun";
import indexHtml from "./frontend/index.html";
import { initializeDatabase } from "./backend/db/connection";
import { runMigrations } from "./backend/migrations/migrate";
import { createHealthHandler } from "./backend/handlers/health";
import { createAuthHandlers, createDemoLoginHandler } from "./backend/handlers/auth";
import { createUserHandlers } from "./backend/handlers/user";
import { createMcpServerHandlers } from "./backend/handlers/mcp-servers";
import { createUrlToolHandlers } from "./backend/handlers/url-tools";
import { createAgentHandlers } from "./backend/handlers/agents";
import { createAgentToolsHandlers } from "./backend/handlers/agent-tools";
import { createAgentMemoriesHandlers } from "./backend/handlers/agent-memories";
import { createSkillsHandlers } from "./backend/handlers/skills";
import { createScheduleHandlers } from "./backend/handlers/schedules";
import { createNotificationHandlers } from "./backend/handlers/notifications";
import { createMqttHandlers } from "./backend/handlers/mqtt";
import { createChatHandlers } from "./backend/handlers/chat";
import { createTeamHandlers } from "./backend/handlers/team";
import { createWorkflowHandlers } from "./backend/handlers/workflows";
import { createAuthMiddleware } from "./backend/middleware/auth";
import { GoogleOAuthService } from "./backend/auth/google-oauth";
import { PostgresUserRepository } from "./backend/repositories/postgres/PostgresUserRepository";
import { PostgresSessionRepository } from "./backend/repositories/postgres/PostgresSessionRepository";
import { PostgresMcpServerRepository } from "./backend/repositories/postgres/PostgresMcpServerRepository";
import { PostgresUrlToolRepository } from "./backend/repositories/postgres/PostgresUrlToolRepository";
import { PostgresAgentRepository } from "./backend/repositories/postgres/PostgresAgentRepository";
import { PostgresConversationRepository } from "./backend/repositories/postgres/PostgresConversationRepository";
import { PostgresMemoryRepository } from "./backend/repositories/postgres/PostgresMemoryRepository";
import { PostgresSkillRepository } from "./backend/repositories/postgres/PostgresSkillRepository";
import { PostgresScheduleRepository } from "./backend/repositories/postgres/PostgresScheduleRepository";
import { PostgresNotificationRepository } from "./backend/repositories/postgres/PostgresNotificationRepository";
import { PostgresMqttRepository } from "./backend/repositories/postgres/PostgresMqttRepository";
import { PostgresTeamRepository } from "./backend/repositories/postgres/PostgresTeamRepository";
import { PostgresWorkflowRepository } from "./backend/repositories/postgres/PostgresWorkflowRepository";
import { AgentFactory } from "./backend/services/AgentFactory";
import { AVAILABLE_MODELS } from "./backend/services/ModelResolver";
import { SchedulerService } from "./backend/services/SchedulerService";
import { NotificationService } from "./backend/services/NotificationService";
import { MqttService } from "./backend/services/MqttService";
import type { SqlClient } from "./backend/types/sql";
import type { UserRepository } from "./backend/repositories/UserRepository";
import type { SessionRepository } from "./backend/repositories/SessionRepository";
import type { McpServerRepository } from "./backend/repositories/McpServerRepository";
import type { UrlToolRepository } from "./backend/repositories/UrlToolRepository";
import type { AgentRepository } from "./backend/repositories/AgentRepository";
import type { ConversationRepository } from "./backend/repositories/ConversationRepository";
import type { MemoryRepository } from "./backend/repositories/MemoryRepository";
import type { SkillRepository } from "./backend/repositories/SkillRepository";
import type { ScheduleRepository } from "./backend/repositories/ScheduleRepository";
import type { NotificationRepository } from "./backend/repositories/NotificationRepository";
import type { MqttRepository } from "./backend/repositories/MqttRepository";
import type { TeamRepository } from "./backend/repositories/TeamRepository";
import type { WorkflowRepository } from "./backend/repositories/WorkflowRepository";

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
  urlToolRepository: UrlToolRepository | null;
  agentRepository: AgentRepository | null;
  conversationRepository: ConversationRepository | null;
  memoryRepository: MemoryRepository | null;
  skillRepository: SkillRepository | null;
  scheduleRepository: ScheduleRepository | null;
  notificationRepository: NotificationRepository | null;
  mqttRepository: MqttRepository | null;
  teamRepository: TeamRepository | null;
  workflowRepository: WorkflowRepository | null;
  googleOAuth: GoogleOAuthService | null;
  agentFactory: AgentFactory | null;
  schedulerService: SchedulerService | null;
  notificationService: NotificationService | null;
  mqttService: MqttService | null;
}

function loadConfig(): Config {
  return {
    port: Number(process.env.PORT) || 3000,
    databaseUrl: process.env.DATABASE_URL,
    isDevelopment: process.env.NODE_ENV === "development",
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
    "/skills": indexHtml,
    "/schedules": indexHtml,
    "/notifications": indexHtml,
    "/team": indexHtml,
    "/api/health": {
      GET: healthHandler,
    },
    "/api/models": {
      GET: () => Response.json(AVAILABLE_MODELS),
    },
  };

  // Add demo login route in development mode (works without Google OAuth)
  if (config.isDevelopment && deps.userRepository && deps.sessionRepository) {
    const demoLogin = createDemoLoginHandler({
      userRepository: deps.userRepository,
      sessionRepository: deps.sessionRepository,
      frontendUrl: config.frontendUrl,
    });
    routes["/api/auth/demo-login"] = {
      GET: demoLogin,
    };
    console.log("Demo login enabled at /api/auth/demo-login");
  }

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

    // Add URL tool routes
    if (deps.urlToolRepository) {
      const urlToolHandlers = createUrlToolHandlers({
        urlToolRepository: deps.urlToolRepository,
        authenticate,
      });

      routes["/api/user/url-tools"] = {
        GET: urlToolHandlers.list,
        POST: urlToolHandlers.create,
      };
      routes["/api/user/url-tools/:id"] = {
        PUT: urlToolHandlers.update,
        DELETE: urlToolHandlers.remove,
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
      routes["/api/agents/:slug/favorite"] = {
        PATCH: agentHandlers.setFavorite,
      };

      // Add agent tools/handoffs routes
      if (deps.mcpServerRepository && deps.urlToolRepository) {
        const agentToolsHandlers = createAgentToolsHandlers({
          agentRepository: deps.agentRepository,
          mcpServerRepository: deps.mcpServerRepository,
          urlToolRepository: deps.urlToolRepository,
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
        routes["/api/agents/:slug/tools/url"] = {
          POST: agentToolsHandlers.addUrlTool,
        };
        routes["/api/agents/:slug/tools/url/:urlToolId"] = {
          DELETE: agentToolsHandlers.removeUrlTool,
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
        if (deps.memoryRepository && deps.userRepository && config.encryptionSecret) {
          const agentMemoriesHandlers = createAgentMemoriesHandlers({
            agentRepository: deps.agentRepository,
            memoryRepository: deps.memoryRepository,
            userRepository: deps.userRepository,
            authenticate,
            encryptionSecret: config.encryptionSecret,
          });

          routes["/api/agents/:slug/memories"] = {
            GET: agentMemoriesHandlers.getMemories,
            POST: agentMemoriesHandlers.createMemory,
          };
          routes["/api/agents/:slug/memories/:key"] = {
            PUT: agentMemoriesHandlers.updateMemory,
            DELETE: agentMemoriesHandlers.deleteMemory,
          };
          routes["/api/agents/:slug/memories/:key/tier"] = {
            PATCH: agentMemoriesHandlers.changeTier,
          };
        }

        // Add skills routes
        if (deps.skillRepository) {
          const skillsHandlers = createSkillsHandlers({
            agentRepository: deps.agentRepository,
            skillRepository: deps.skillRepository,
            authenticate,
          });

          // User-level skills
          routes["/api/skills"] = {
            GET: skillsHandlers.listUserSkills,
            POST: skillsHandlers.createUserSkill,
          };
          routes["/api/skills/:id"] = {
            PUT: skillsHandlers.updateSkill,
            DELETE: skillsHandlers.deleteSkill,
          };
          routes["/api/skills/:id/promote"] = {
            PATCH: skillsHandlers.promoteSkill,
          };

          // Agent-scoped skills
          routes["/api/agents/:slug/skills"] = {
            GET: skillsHandlers.listAgentSkills,
            POST: skillsHandlers.createAgentSkill,
          };
          routes["/api/agents/:slug/skills/:skillId/toggle"] = {
            PATCH: skillsHandlers.toggleAgentSkill,
          };
        }

        // Add schedule routes
        if (deps.scheduleRepository) {
          const scheduleHandlers = createScheduleHandlers({
            agentRepository: deps.agentRepository,
            scheduleRepository: deps.scheduleRepository,
            authenticate,
          });

          routes["/api/schedules"] = {
            GET: scheduleHandlers.listSchedules,
          };
          routes["/api/schedules/:id"] = {
            PUT: scheduleHandlers.updateSchedule,
            DELETE: scheduleHandlers.deleteSchedule,
          };
          routes["/api/schedules/:id/toggle"] = {
            PATCH: scheduleHandlers.toggleSchedule,
          };
          routes["/api/schedules/:id/executions"] = {
            GET: scheduleHandlers.listExecutions,
          };
          routes["/api/schedules/:id/trigger"] = {
            POST: scheduleHandlers.triggerSchedule,
          };
          routes["/api/agents/:slug/schedules"] = {
            GET: scheduleHandlers.listAgentSchedules,
            POST: scheduleHandlers.createSchedule,
          };
        }

        // Add notification routes
        if (deps.notificationRepository) {
          const notificationHandlers = createNotificationHandlers({
            agentRepository: deps.agentRepository,
            notificationRepository: deps.notificationRepository,
            authenticate,
          });

          routes["/api/notifications"] = {
            GET: notificationHandlers.listNotifications,
          };
          routes["/api/notifications/unread-count"] = {
            GET: notificationHandlers.getUnreadCount,
          };
          routes["/api/notifications/:id/read"] = {
            PATCH: notificationHandlers.markRead,
          };
          routes["/api/notifications/read-all"] = {
            POST: notificationHandlers.markAllRead,
          };
          routes["/api/user/notification-settings"] = {
            GET: notificationHandlers.getSettings,
            PUT: notificationHandlers.updateSettings,
          };
          routes["/api/agents/:slug/notifications/mute"] = {
            POST: notificationHandlers.muteAgent,
            DELETE: notificationHandlers.unmuteAgent,
          };
        }

        // Add MQTT routes
        if (deps.mqttRepository && config.encryptionSecret) {
          const mqttHandlers = createMqttHandlers({
            mqttRepository: deps.mqttRepository,
            authenticate,
            encryptionSecret: config.encryptionSecret,
            // Late-bind to deps.mqttService since it's created after server starts
            getMqttStatus: (userId) =>
              deps.mqttService ? deps.mqttService.getStatus(userId) : { connected: false },
            reconnectMqtt: async (userId) => {
              if (deps.mqttService) await deps.mqttService.connectUser(userId);
            },
            disconnectMqtt: async (userId) => {
              if (deps.mqttService) await deps.mqttService.disconnectUser(userId);
            },
          });

          routes["/api/user/mqtt/broker"] = {
            GET: mqttHandlers.getBrokerConfig,
            PUT: mqttHandlers.upsertBrokerConfig,
            DELETE: mqttHandlers.deleteBrokerConfig,
          };
          routes["/api/user/mqtt/status"] = {
            GET: mqttHandlers.getStatus,
          };
          routes["/api/user/mqtt/reconnect"] = {
            POST: mqttHandlers.reconnect,
          };
        }
      }

      // Add chat routes
      if (deps.conversationRepository && deps.agentFactory && config.encryptionSecret) {
        const chatHandlers = createChatHandlers({
          agentFactory: deps.agentFactory,
          conversationRepository: deps.conversationRepository,
          teamRepository: deps.teamRepository,
          workflowRepository: deps.workflowRepository,
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

      // Add workflow routes
      if (deps.workflowRepository) {
        const workflowHandlers = createWorkflowHandlers({
          workflowRepository: deps.workflowRepository,
          agentRepository: deps.agentRepository,
          authenticate,
        });

        routes["/api/workflows"] = {
          GET: workflowHandlers.listWorkflows,
          POST: workflowHandlers.createWorkflow,
        };
        routes["/api/workflows/:id"] = {
          GET: workflowHandlers.getWorkflow,
          PUT: workflowHandlers.updateWorkflow,
          DELETE: workflowHandlers.deleteWorkflow,
        };
        routes["/api/workflows/validate"] = {
          POST: workflowHandlers.validateWorkflow,
        };
        routes["/api/agents/:slug/workflows"] = {
          GET: workflowHandlers.listAgentWorkflows,
          POST: workflowHandlers.assignAgentWorkflow,
        };
        routes["/api/agents/:slug/workflows/:workflowId"] = {
          DELETE: workflowHandlers.unassignAgentWorkflow,
        };
        routes["/api/agents/:slug/workflows/:workflowId/default"] = {
          PATCH: workflowHandlers.setDefaultAgentWorkflow,
        };
      }

      // Add team settings routes
      if (deps.teamRepository && config.encryptionSecret) {
        const teamHandlers = createTeamHandlers({
          teamRepository: deps.teamRepository,
          authenticate,
          encryptionSecret: config.encryptionSecret,
        });

        routes["/api/team/settings"] = {
          GET: teamHandlers.getSettings,
          PUT: teamHandlers.updateSettings,
        };
        routes["/api/team/credentials"] = {
          PUT: teamHandlers.updateCredentials,
        };
        routes["/api/team/mcp-servers"] = {
          GET: teamHandlers.listMcpServers,
          POST: teamHandlers.createMcpServer,
        };
        routes["/api/team/mcp-servers/:id"] = {
          PUT: teamHandlers.updateMcpServer,
          DELETE: teamHandlers.deleteMcpServer,
        };
        routes["/api/team/url-tools"] = {
          GET: teamHandlers.listUrlTools,
          POST: teamHandlers.createUrlTool,
        };
        routes["/api/team/url-tools/:id"] = {
          PUT: teamHandlers.updateUrlTool,
          DELETE: teamHandlers.deleteUrlTool,
        };
        routes["/api/team/notification-settings"] = {
          GET: teamHandlers.getNotificationSettings,
          PUT: teamHandlers.updateNotificationSettings,
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
    urlToolRepository: null,
    agentRepository: null,
    conversationRepository: null,
    memoryRepository: null,
    skillRepository: null,
    scheduleRepository: null,
    notificationRepository: null,
    mqttRepository: null,
    teamRepository: null,
    workflowRepository: null,
    googleOAuth: null,
    agentFactory: null,
    schedulerService: null,
    notificationService: null,
    mqttService: null,
  };


  // Initialize database connection and run migrations on startup
  if (deps.sql) {
    console.log('Initializing database connection...');
    await initializeDatabase(deps.sql, config.databaseUrl);


    console.log('Running database migrations...');
    await runMigrations(deps.sql);


    // Create repository instances (only if database is configured)
    console.log('Creating repository instances...');
    deps.userRepository = new PostgresUserRepository();
    deps.sessionRepository = new PostgresSessionRepository();
    deps.mcpServerRepository = new PostgresMcpServerRepository();
    deps.urlToolRepository = new PostgresUrlToolRepository();
    deps.agentRepository = new PostgresAgentRepository();
    deps.conversationRepository = new PostgresConversationRepository();
    deps.memoryRepository = new PostgresMemoryRepository();
    deps.skillRepository = new PostgresSkillRepository();
    deps.scheduleRepository = new PostgresScheduleRepository();
    deps.notificationRepository = new PostgresNotificationRepository();
    deps.mqttRepository = new PostgresMqttRepository();
    deps.teamRepository = new PostgresTeamRepository();
    deps.workflowRepository = new PostgresWorkflowRepository();


    // Create AgentFactory
    if (deps.agentRepository && deps.userRepository && deps.mcpServerRepository && deps.urlToolRepository && deps.memoryRepository && deps.skillRepository && deps.scheduleRepository && deps.notificationRepository) {
      console.log('Creating AgentFactory...');
      deps.agentFactory = new AgentFactory({
        agentRepository: deps.agentRepository,
        userRepository: deps.userRepository,
        mcpServerRepository: deps.mcpServerRepository,
        urlToolRepository: deps.urlToolRepository,
        memoryRepository: deps.memoryRepository,
        skillRepository: deps.skillRepository,
        scheduleRepository: deps.scheduleRepository,
        notificationRepository: deps.notificationRepository,
        mqttRepository: deps.mqttRepository,
        mqttService: null, // Will be set after MqttService is created
        teamRepository: deps.teamRepository,
      });

    }
  }

  // Create Google OAuth service if configured
  if (config.googleClientId && config.googleClientSecret && config.googleRedirectUri) {
    console.log('Creating Google OAuth service...');
    deps.googleOAuth = new GoogleOAuthService({
      clientId: config.googleClientId,
      clientSecret: config.googleClientSecret,
      redirectUri: config.googleRedirectUri,
    });

  } else {
    console.warn("Google OAuth credentials not configured");
  }

  // Start the server
  console.log('Starting server...');
  const server = await startServer(config, deps);


  // Start background services
  if (deps.scheduleRepository && deps.agentFactory && deps.conversationRepository && deps.userRepository && config.encryptionSecret) {
    console.log('Starting scheduler service...');
    deps.schedulerService = new SchedulerService({
      scheduleRepository: deps.scheduleRepository,
      agentFactory: deps.agentFactory,
      conversationRepository: deps.conversationRepository,
      userRepository: deps.userRepository,
      encryptionSecret: config.encryptionSecret,
    });
    deps.schedulerService.start();
  }

  if (deps.notificationRepository) {
    console.log('Starting notification service...');
    deps.notificationService = new NotificationService({
      notificationRepository: deps.notificationRepository,
    });
    deps.notificationService.start();
  }

  if (deps.mqttRepository && deps.agentFactory && deps.conversationRepository && deps.userRepository && config.encryptionSecret) {
    console.log('Starting MQTT service...');
    deps.mqttService = new MqttService({
      mqttRepository: deps.mqttRepository,
      agentFactory: deps.agentFactory,
      conversationRepository: deps.conversationRepository,
      userRepository: deps.userRepository,
      encryptionSecret: config.encryptionSecret,
    });
    // Wire MqttService back to AgentFactory so tools can reference it
    (deps.agentFactory as any).deps.mqttService = deps.mqttService;
    await deps.mqttService.start();
  }

  // Wait for interrupt signal
  await waitForShutdown();

  // Gracefully stop background services
  deps.schedulerService?.stop();
  deps.notificationService?.stop();
  deps.mqttService?.stop();

  // Gracefully stop the server
  console.log('Stopping server...');
  await server.stop();
  console.log('Server stopped');

  // Exit process after graceful shutdown
  process.exit(0);
}

main();
