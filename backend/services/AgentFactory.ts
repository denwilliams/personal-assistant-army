import {
  Agent,
  handoff,
  imageGenerationTool,
  tool,
  mcpToFunctionTool,
  webSearchTool,
  type Tool,
  hostedMcpTool,
} from "@openai/agents";
import type { Agent as AgentModel } from "../types/models";
import type { AgentRepository } from "../repositories/AgentRepository";
import type { UserRepository } from "../repositories/UserRepository";
import type { McpServerRepository } from "backend/repositories/McpServerRepository";
import type { UrlToolRepository } from "../repositories/UrlToolRepository";
import type { MemoryRepository } from "../repositories/MemoryRepository";
import type { SkillRepository } from "../repositories/SkillRepository";
import type { ScheduleRepository } from "../repositories/ScheduleRepository";
import type { NotificationRepository } from "../repositories/NotificationRepository";
import { createMemoryTools } from "../tools/memoryTools";
import { createUrlTool } from "../tools/urlTool";
import { createSkillTools } from "../tools/skillTools";
import { createScheduleTools } from "../tools/scheduleTool";
import { createNotifyTool } from "../tools/notifyTool";
import type { ToolContext } from "../tools/context";

export interface AgentFactoryDependencies {
  mcpServerRepository: McpServerRepository;
  urlToolRepository: UrlToolRepository;
  agentRepository: AgentRepository;
  userRepository: UserRepository;
  memoryRepository: MemoryRepository;
  skillRepository: SkillRepository;
  scheduleRepository: ScheduleRepository;
  notificationRepository: NotificationRepository;
}

export interface CreateAgentOptions {
  conversationId?: number;
  generateEmbedding?: (text: string) => Promise<number[]>;
}

/**
 * Factory for creating OpenAI Agent instances from database configuration
 */
export class AgentFactory {
  constructor(private deps: AgentFactoryDependencies) {}

  /**
   * Create an OpenAI Agent instance from database configuration
   */
  async createAgent<TAgentContext extends { id: number } & ToolContext>(
    context: TAgentContext,
    agentSlug: string,
    options?: CreateAgentOptions
  ): Promise<Agent<TAgentContext>> {
    return this.createAgentRecursive(context, agentSlug, new Set(), options);
  }

  /**
   * Recursively create agent with tools and handoffs, preventing circular dependencies
   */
  private async createAgentRecursive<TAgentContext extends { id: number } & ToolContext>(
    context: TAgentContext,
    agentSlug: string,
    visitedAgents: Set<string>,
    options?: CreateAgentOptions
  ): Promise<Agent<TAgentContext>> {
    // Prevent circular dependencies
    if (visitedAgents.has(agentSlug)) {
      throw new Error(`Circular agent dependency detected: ${agentSlug}`);
    }
    visitedAgents.add(agentSlug);

    // Get agent from database
    const agentData = await this.deps.agentRepository.findBySlug(
      context.id,
      agentSlug
    );
    if (!agentData) {
      throw new Error(`Agent not found: ${agentSlug}`);
    }

    // Verify ownership
    if (agentData.user_id !== context.id) {
      throw new Error("Unauthorized: Agent does not belong to user");
    }

    // Get agent's configured tools
    const builtInTools = await this.deps.agentRepository.listBuiltInTools(
      agentData.id
    );
    const mcpTools = await this.deps.agentRepository.listMcpTools(agentData.id);
    const urlTools = await this.deps.agentRepository.listUrlTools(agentData.id);
    const agentToolsData = await this.deps.agentRepository.listAgentTools(
      agentData.id
    );
    const handoffAgentData = await this.deps.agentRepository.listHandoffs(
      agentData.id
    );
    // TODO: cache these so we don't look up each time, at the very least on the class as singleton
    const userMcpTools = await this.deps.mcpServerRepository.listByUser(
      context.id
    );
    const userUrlTools = await this.deps.urlToolRepository.listByUser(
      context.id
    );

    const tools: Tool<TAgentContext>[] = [];
    if (builtInTools.includes("internet_search")) {
      tools.push(webSearchTool());
    }
    if (builtInTools.includes("memory")) {
      const memoryTools = createMemoryTools<TAgentContext>(
        this.deps.memoryRepository,
        agentData.id,
        options?.generateEmbedding
      );
      tools.push(...memoryTools);
    }
    for (const mcpTool of mcpTools) {
      const serverConfig = userMcpTools.find((server) => server.id === mcpTool);
      if (!serverConfig) {
        console.warn(
          `MCP tool server config not found for tool ID ${mcpTool} on agent ${agentSlug}`
        );
        continue;
      }
      tools.push(
        hostedMcpTool<TAgentContext>({
          serverUrl: serverConfig.url,
          serverLabel: serverConfig.name.replace(/\s+/g, "_"),
          headers: serverConfig.headers || undefined,
          requireApproval: "never",
        })
      );
    }
    for (const urlToolId of urlTools) {
      const urlToolConfig = userUrlTools.find((tool) => tool.id === urlToolId);
      if (!urlToolConfig) {
        console.warn(
          `URL tool config not found for tool ID ${urlToolId} on agent ${agentSlug}`
        );
        continue;
      }
      tools.push(createUrlTool<TAgentContext>(urlToolConfig));
    }

    // Recursively create agent tool instances
    for (const toolAgentData of agentToolsData) {
      try {
        const toolAgentInstance = await this.createAgentRecursive(
          context,
          toolAgentData.slug,
          new Set(visitedAgents) // Pass a copy to allow different branches
        );
        // Convert agent to tool using asTool method
        tools.push(toolAgentInstance.asTool({
          toolName: `call_${toolAgentData.name.toLowerCase().replace(/[^a-z0-9]/g, '_')}`,
          toolDescription: toolAgentData.purpose || `Delegate tasks to ${toolAgentData.name}`,
        }));
      } catch (err) {
        // Skip agent tools that create circular dependencies
        console.warn(
          `Skipping agent tool ${toolAgentData.slug}: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
    }

    // Recursively create handoff agents with their own tools and handoffs
    const handoffs: Agent<TAgentContext>[] = [];
    for (const handoffAgent of handoffAgentData) {
      try {
        const handoffAgentInstance = await this.createAgentRecursive(
          context,
          handoffAgent.slug,
          new Set(visitedAgents) // Pass a copy to allow different branches
        );
        handoffs.push(handoffAgentInstance);
        // tools.push(handoffAgentInstance.asTool({
        //   toolName: handoffAgent.name + " Tool",
        //   toolDescription: handoffAgent.purpose,
        // }));
      } catch (err) {
        // Skip handoff agents that create circular dependencies
        console.warn(
          `Skipping handoff agent ${handoffAgent.slug}: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
    }

    // Format date in user's timezone
    const userTimezone = (context as any).timezone || "UTC";
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

    // Load memories and append to instructions
    let instructionsWithContext =
      agentData.system_prompt + "\n\nToday's Date: " + formattedDate;

    if (builtInTools.includes("memory")) {
      const coreMemories = await this.deps.memoryRepository.listByTier(agentData.id, "core");
      const workingMemories = await this.deps.memoryRepository.listByTier(agentData.id, "working");
      const referenceCount = await this.deps.memoryRepository.countByTier(agentData.id, "reference");

      // Passive access bump (last_accessed_at only, no access_count increment)
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

        // Promotion hints for heavily-accessed Working memories
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

    // Load skills catalog and inject summaries into system prompt
    const skills = await this.deps.skillRepository.listForAgent(
      context.id,
      agentData.id
    );
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

    // Add skill tools (always available - agent can create skills even if none exist yet)
    const skillTools = createSkillTools<TAgentContext>(
      this.deps.skillRepository,
      context.id,
      agentData.id
    );
    tools.push(...skillTools);

    // Add schedule tools
    const scheduleTools = createScheduleTools<TAgentContext>(
      this.deps.scheduleRepository,
      context.id,
      agentData.id,
      options?.conversationId ?? null,
      userTimezone
    );
    tools.push(...scheduleTools);

    // Add notify tool
    const notifyTool = createNotifyTool<TAgentContext>(
      this.deps.notificationRepository,
      context.id,
      agentData.id,
      options?.conversationId ?? null
    );
    tools.push(notifyTool);

    // Create agent instance
    const agent = new Agent<TAgentContext>({
      name: agentData.name,
      instructions: instructionsWithContext,
      // TODO: interestingly we can shim in Claude here by implementing Model#getResponse / Model#getStreamedResponse
      // TODO: we should allow this to be set on the agent
      model: "gpt-4.1-mini",
      tools,
      handoffs,
    });

    return agent;
  }

  /**
   * Get agent configuration from database without creating OpenAI agent
   */
  async getAgentConfig(userId: number, agentSlug: string): Promise<AgentModel> {
    const agentData = await this.deps.agentRepository.findBySlug(
      userId,
      agentSlug
    );
    if (!agentData) {
      throw new Error(`Agent not found: ${agentSlug}`);
    }

    if (agentData.user_id !== userId) {
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
