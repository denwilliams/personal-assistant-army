import { tool, ToolLoopAgent, stepCountIs } from "ai";
import type { ToolSet } from "ai";
import type { Agent as AgentModel } from "../types/models";
import type { AgentRepository } from "../repositories/AgentRepository";
import type { UserRepository } from "../repositories/UserRepository";
import type { McpServerRepository } from "backend/repositories/McpServerRepository";
import type { UrlToolRepository } from "../repositories/UrlToolRepository";
import type { MemoryRepository } from "../repositories/MemoryRepository";
import type { SkillRepository } from "../repositories/SkillRepository";
import type { ScheduleRepository } from "../repositories/ScheduleRepository";
import type { NotificationRepository } from "../repositories/NotificationRepository";
import type { MqttRepository } from "../repositories/MqttRepository";
import type { MqttService } from "./MqttService";
import type { TeamRepository } from "../repositories/TeamRepository";
import { memoryTools } from "../tools/memoryTools";
import { createUrlTool } from "../tools/urlTool";
import { skillTools } from "../tools/skillTools";
import { scheduleTools } from "../tools/scheduleTool";
import { notifyTools } from "../tools/notifyTool";
import { mqttTools } from "../tools/mqttTools";
import { webSearchTools } from "../tools/webSearchTool";
import { workflowTools } from "../tools/workflowTools";
import type { ToolStatusUpdate, AgentToolContext, WorkflowToolContext } from "../tools/context";
import { resolveModel, DEFAULT_MODEL, type ApiKeys } from "./ModelResolver";
import type { WorkflowEngine } from "../workflows/WorkflowEngine";
import type { WorkflowDefinition, WorkflowStep, CollectedFact } from "../workflows/types";
import { z } from "zod";

export interface AgentFactoryDependencies {
  mcpServerRepository: McpServerRepository;
  urlToolRepository: UrlToolRepository;
  agentRepository: AgentRepository;
  userRepository: UserRepository;
  memoryRepository: MemoryRepository;
  skillRepository: SkillRepository;
  scheduleRepository: ScheduleRepository;
  notificationRepository: NotificationRepository;
  mqttRepository: MqttRepository | null;
  mqttService: MqttService | null;
  teamRepository: TeamRepository | null;
}

export interface CreateAgentOptions {
  conversationId?: number;
  generateEmbedding?: (text: string) => Promise<number[]>;
  /** Decrypted Google Custom Search API key for web search */
  googleSearchApiKey?: string;
  googleSearchEngineId?: string;
  /** User's email domain for team agent access */
  domain?: string;
  /** Workflow context for active workflow execution */
  workflowContext?: {
    engine: WorkflowEngine;
    definition: WorkflowDefinition;
    executionId: number;
    currentStep: WorkflowStep;
    currentStepIndex: number;
    facts: Record<string, CollectedFact>;
  };
}

/**
 * A ToolLoopAgent bundled with metadata needed by the chat handler.
 */
export interface AgentInstance {
  name: string;
  slug: string;
  agent: ToolLoopAgent;
}

/**
 * Factory for creating ToolLoopAgent instances from database settings.
 * Returns AgentInstance objects whose .agent handles the full tool loop.
 *
 * Tools receive their dependencies via experimental_context (AgentToolContext)
 * rather than closure variables, following the AI SDK skills pattern.
 */
export class AgentFactory {
  constructor(private deps: AgentFactoryDependencies) {}

  /**
   * Create a ToolLoopAgent from database settings
   */
  async createAgent(
    userId: number,
    agentSlug: string,
    updateStatus: ToolStatusUpdate,
    apiKeys: ApiKeys,
    options?: CreateAgentOptions
  ): Promise<AgentInstance> {
    return this.createAgentRecursive(userId, agentSlug, updateStatus, apiKeys, new Set(), options);
  }

  /**
   * Recursively create ToolLoopAgent with tools and handoffs, preventing circular dependencies
   */
  private async createAgentRecursive(
    userId: number,
    agentSlug: string,
    updateStatus: ToolStatusUpdate,
    apiKeys: ApiKeys,
    visitedAgents: Set<string>,
    options?: CreateAgentOptions
  ): Promise<AgentInstance> {
    // Prevent circular dependencies
    if (visitedAgents.has(agentSlug)) {
      throw new Error(`Circular agent dependency detected: ${agentSlug}`);
    }
    visitedAgents.add(agentSlug);

    // Get agent from database - use accessible lookup if domain is provided
    const agentData = options?.domain
      ? await this.deps.agentRepository.findAccessibleBySlug(userId, options.domain, agentSlug)
      : await this.deps.agentRepository.findBySlug(userId, agentSlug);
    if (!agentData) {
      throw new Error(`Agent not found: ${agentSlug}`);
    }

    // For personal agents, verify ownership
    if (agentData.pool_type === 'personal' && agentData.user_id !== userId) {
      throw new Error("Unauthorized: Agent does not belong to user");
    }

    // Get agent's configured tools
    const builtInTools = await this.deps.agentRepository.listBuiltInTools(agentData.id);
    const mcpToolIds = await this.deps.agentRepository.listMcpTools(agentData.id);
    const urlToolIds = await this.deps.agentRepository.listUrlTools(agentData.id);
    const agentToolsData = await this.deps.agentRepository.listAgentTools(agentData.id);
    const handoffAgentData = await this.deps.agentRepository.listHandoffs(agentData.id);

    // For team agents, use team-level MCP/URL tools instead of personal ones
    const isTeamAgent = agentData.pool_type === 'team' && !!agentData.domain;
    const userMcpTools = isTeamAgent && this.deps.teamRepository
      ? await this.deps.teamRepository.listMcpServers(agentData.domain!)
      : await this.deps.mcpServerRepository.listByUser(userId);
    const userUrlTools = isTeamAgent && this.deps.teamRepository
      ? await this.deps.teamRepository.listUrlTools(agentData.domain!)
      : await this.deps.urlToolRepository.listByUser(userId);

    // Assemble tools — module-level tools use experimental_context for deps
    const tools: ToolSet = {};

    // Web search tool (reads credentials from context at execution time)
    if (builtInTools.includes("internet_search")) {
      Object.assign(tools, webSearchTools);
    }

    // Memory tools
    if (builtInTools.includes("memory")) {
      Object.assign(tools, memoryTools);
    }

    // Skill tools (always available)
    Object.assign(tools, skillTools);

    // Schedule tools (always available)
    Object.assign(tools, scheduleTools);

    // Notify tool (always available)
    Object.assign(tools, notifyTools);

    // MQTT tools
    if (builtInTools.includes("mqtt") && this.deps.mqttRepository && this.deps.mqttService) {
      Object.assign(tools, mqttTools);
    }

    // MCP tools - config-specific, created per agent (closures are fine here)
    for (const mcpToolId of mcpToolIds) {
      const serverConfig = userMcpTools.find((server) => server.id === mcpToolId);
      if (!serverConfig) {
        console.warn(`MCP tool server config not found for tool ID ${mcpToolId} on agent ${agentSlug}`);
        continue;
      }
      const safeName = serverConfig.name.replace(/[^a-z0-9_]/gi, "_").toLowerCase();
      tools[`mcp_${safeName}`] = tool({
        description: `Execute tools from MCP server: ${serverConfig.name}. Send a JSON request with the tool name and arguments.`,
        inputSchema: z.object({
          tool_name: z.string().describe("The MCP tool name to call"),
          arguments: z.string().describe("JSON-encoded arguments for the tool"),
        }),
        execute: async (params) => {
          updateStatus(`Calling MCP tool: ${params.tool_name}...`);
          try {
            let args: Record<string, unknown>;
            try {
              args = JSON.parse(params.arguments);
            } catch {
              args = {};
            }
            const response = await fetch(serverConfig.url, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                ...(serverConfig.headers || {}),
              },
              body: JSON.stringify({
                jsonrpc: "2.0",
                method: "tools/call",
                params: { name: params.tool_name, arguments: args },
                id: Date.now(),
              }),
            });
            const data = await response.json();
            return JSON.stringify(data.result ?? data);
          } catch (err) {
            return JSON.stringify({
              error: err instanceof Error ? err.message : "MCP call failed",
            });
          }
        },
      });
    }

    // URL tools - config-specific, created per agent
    for (const urlToolId of urlToolIds) {
      const urlToolConfig = userUrlTools.find((t) => t.id === urlToolId);
      if (!urlToolConfig) {
        console.warn(`URL tool config not found for tool ID ${urlToolId} on agent ${agentSlug}`);
        continue;
      }
      Object.assign(tools, createUrlTool(urlToolConfig as any, updateStatus));
    }

    // Agent-as-tool: recursively create sub-agents and wrap as tools
    for (const toolAgentData of agentToolsData) {
      try {
        const subAgentInstance = await this.createAgentRecursive(
          userId,
          toolAgentData.slug,
          updateStatus,
          apiKeys,
          new Set(visitedAgents),
          options
        );

        const toolName = `call_${toolAgentData.name.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
        tools[toolName] = tool({
          description: toolAgentData.purpose || `Delegate tasks to ${toolAgentData.name}`,
          inputSchema: z.object({
            request: z.string().describe(`The request to send to ${toolAgentData.name}`),
          }),
          execute: async (params) => {
            updateStatus(`Asking ${toolAgentData.name}...`);
            try {
              const result = await subAgentInstance.agent.generate({
                prompt: params.request,
              });
              return result.text || "[No response from agent]";
            } catch (err) {
              return JSON.stringify({
                error: err instanceof Error ? err.message : "Agent call failed",
              });
            }
          },
        });
      } catch (err) {
        console.warn(
          `Skipping agent tool ${toolAgentData.slug}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    // Handoff tools: create transfer tools that return a handoff marker
    for (const handoffAgent of handoffAgentData) {
      try {
        // Validate the handoff target exists and build its config
        await this.createAgentRecursive(
          userId,
          handoffAgent.slug,
          updateStatus,
          apiKeys,
          new Set(visitedAgents),
          options
        );

        const safeName = handoffAgent.name.toLowerCase().replace(/[^a-z0-9]/g, '_');
        tools[`transfer_to_${safeName}`] = tool({
          description: `Transfer the conversation to ${handoffAgent.name}. ${handoffAgent.purpose || ''}. Use when the user's request is better handled by this agent.`,
          inputSchema: z.object({}),
          execute: async () => {
            return JSON.stringify({
              __handoff: true,
              slug: handoffAgent.slug,
              name: handoffAgent.name,
            });
          },
        });
      } catch (err) {
        console.warn(
          `Skipping handoff agent ${handoffAgent.slug}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    // Format date in user's (or team's) timezone
    const user = await this.deps.userRepository.findById(userId);
    let userTimezone = user?.timezone || "UTC";
    if (isTeamAgent && this.deps.teamRepository && agentData.domain) {
      const teamSettings = await this.deps.teamRepository.getSettings(agentData.domain);
      userTimezone = teamSettings?.timezone || "UTC";
    }
    const dateFormatter = new Intl.DateTimeFormat("en-US", {
      timeZone: userTimezone,
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZoneName: "short",
    });
    const formattedDate = dateFormatter.format(new Date());

    // Build system prompt with context
    let instructionsWithContext =
      agentData.system_prompt + "\n\nToday's Date: " + formattedDate;

    // Inject memories
    if (builtInTools.includes("memory")) {
      const coreMemories = await this.deps.memoryRepository.listByTier(agentData.id, "core");
      const workingMemories = await this.deps.memoryRepository.listByTier(agentData.id, "working");
      const referenceCount = await this.deps.memoryRepository.countByTier(agentData.id, "reference");

      const allLoadedKeys = [...coreMemories, ...workingMemories].map((m) => m.key);
      if (allLoadedKeys.length > 0) {
        this.deps.memoryRepository.bumpAccess(agentData.id, allLoadedKeys).catch(console.error);
      }

      if (coreMemories.length > 0) {
        instructionsWithContext += "\n\n# Core Knowledge\n";
        instructionsWithContext += "Fundamental, always-available memories (permanent):\n";
        for (const m of coreMemories) {
          instructionsWithContext += `- **${m.key}**: ${m.value}\n`;
        }
      }

      if (workingMemories.length > 0) {
        instructionsWithContext += "\n\n# Working Memory\n";
        instructionsWithContext += "Recently relevant context (auto-archived when unused):\n";
        for (const m of workingMemories) {
          instructionsWithContext += `- **${m.key}**: ${m.value}`;
          if (m.access_count > 0) {
            instructionsWithContext += ` (accessed ${m.access_count}x)`;
          }
          instructionsWithContext += "\n";
        }

        const PROMOTION_THRESHOLD = 10;
        const candidates = workingMemories.filter((m) => m.access_count >= PROMOTION_THRESHOLD);
        for (const c of candidates) {
          instructionsWithContext += `\n> "${c.key}" has been accessed ${c.access_count} times — consider promoting to Core with promote_memory.\n`;
        }
      }

      if (referenceCount > 0) {
        instructionsWithContext += `\nYou have ${referenceCount} archived memories searchable via the recall tool.\n`;
      }

      instructionsWithContext +=
        "\nUse 'remember' to store facts/preferences (tier: core or working). Use 'recall' to search your archive. Use 'create_skill' for reusable procedures.\n";
    }

    // Inject skills catalog (progressive disclosure — names + descriptions only)
    const skills = await this.deps.skillRepository.listForAgent(userId, agentData.id);
    if (skills.length > 0) {
      instructionsWithContext += "\n\n# Available Skills\n";
      instructionsWithContext +=
        "You have specialized skills you can load when needed. Only load a skill when a task matches its description.\n\n";
      for (const skill of skills.slice(0, 30)) {
        instructionsWithContext += `- **${skill.name}**: ${skill.summary}\n`;
      }
      instructionsWithContext +=
        "\nUse the load_skill tool to load a skill's full instructions when needed.\n";
      instructionsWithContext +=
        "\n**Memory vs Skills**: Use 'remember' for facts and preferences. Use 'create_skill' for reusable procedures, workflows, or multi-step patterns.\n";
    }

    // Inject MQTT subscription context
    if (builtInTools.includes("mqtt") && this.deps.mqttRepository) {
      try {
        const mqttSubs = await this.deps.mqttRepository.listSubscriptionsByAgent(agentData.id);
        if (mqttSubs.length > 0) {
          instructionsWithContext += "\n\n# Active MQTT Subscriptions\n";
          for (const sub of mqttSubs) {
            instructionsWithContext += `- **${sub.topic}** (QoS ${sub.qos}, ${sub.enabled ? "enabled" : "disabled"}) — ${sub.conversation_mode} mode\n`;
          }
        }
      } catch (err) {
        console.error("Error loading MQTT subscriptions for agent context:", err);
      }
    }

    // Inject workflow step instructions if a workflow is active
    let workflowToolCtx: WorkflowToolContext | undefined;
    if (options?.workflowContext) {
      const wf = options.workflowContext;
      instructionsWithContext += wf.engine.buildStepPrompt(
        wf.definition,
        wf.currentStep,
        wf.facts,
        wf.currentStepIndex
      );

      // Add workflow tools
      Object.assign(tools, workflowTools);

      // Filter tools based on step's allowed_tools
      const filteredTools = wf.engine.filterTools(tools, wf.currentStep);
      // Replace tools with filtered set
      for (const key of Object.keys(tools)) {
        if (!(key in filteredTools)) {
          delete tools[key];
        }
      }

      workflowToolCtx = {
        workflowEngine: wf.engine,
        executionId: wf.executionId,
        currentStepId: wf.currentStep.id,
      };
    }

    // Build the AgentToolContext passed to all tools via experimental_context
    const toolContext: AgentToolContext = {
      updateStatus,
      userId,
      agentId: agentData.id,
      conversationId: options?.conversationId ?? null,
      timezone: userTimezone,
      memoryRepository: this.deps.memoryRepository,
      skillRepository: this.deps.skillRepository,
      scheduleRepository: this.deps.scheduleRepository,
      notificationRepository: this.deps.notificationRepository,
      mqttRepository: this.deps.mqttRepository,
      mqttService: this.deps.mqttService,
      generateEmbedding: options?.generateEmbedding,
      googleSearchApiKey: options?.googleSearchApiKey,
      googleSearchEngineId: options?.googleSearchEngineId,
      workflow: workflowToolCtx,
    };

    const model = resolveModel(agentData.model || DEFAULT_MODEL, apiKeys);

    return {
      name: agentData.name,
      slug: agentData.slug,
      agent: new ToolLoopAgent({
        model,
        instructions: instructionsWithContext,
        tools,
        stopWhen: stepCountIs(10),
        experimental_context: toolContext,
      }),
    };
  }

  /**
   * Get agent configuration from database without creating full run config
   */
  async getAgentConfig(userId: number, agentSlug: string, domain?: string): Promise<AgentModel> {
    const agentData = domain
      ? await this.deps.agentRepository.findAccessibleBySlug(userId, domain, agentSlug)
      : await this.deps.agentRepository.findBySlug(userId, agentSlug);
    if (!agentData) {
      throw new Error(`Agent not found: ${agentSlug}`);
    }

    if (agentData.pool_type === 'personal' && agentData.user_id !== userId) {
      throw new Error("Unauthorized: Agent does not belong to user");
    }

    return agentData;
  }

  /**
   * Get agent configuration by ID (used by scheduler which stores agent_id, not slug)
   */
  async getAgentConfigById(userId: number, agentId: number): Promise<AgentModel> {
    const agentData = await this.deps.agentRepository.findById(agentId);
    if (!agentData) {
      throw new Error(`Agent not found: id=${agentId}`);
    }

    if (agentData.user_id !== userId) {
      throw new Error("Unauthorized: Agent does not belong to user");
    }

    return agentData;
  }
}
