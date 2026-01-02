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

interface AgentFactoryDependencies {
  mcpServerRepository: McpServerRepository;
  agentRepository: AgentRepository;
  userRepository: UserRepository;
}

/**
 * Factory for creating OpenAI Agent instances from database configuration
 */
export class AgentFactory {
  constructor(private deps: AgentFactoryDependencies) {}

  /**
   * Create an OpenAI Agent instance from database configuration
   */
  async createAgent<TAgentContext extends { id: number }>(
    context: TAgentContext,
    agentSlug: string
  ): Promise<Agent<TAgentContext>> {
    return this.createAgentRecursive(context, agentSlug, new Set());
  }

  /**
   * Recursively create agent with tools and handoffs, preventing circular dependencies
   */
  private async createAgentRecursive<TAgentContext extends { id: number }>(
    context: TAgentContext,
    agentSlug: string,
    visitedAgents: Set<string>
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
    const handoffAgentData = await this.deps.agentRepository.listHandoffs(
      agentData.id
    );
    // TODO: cache these so we don't look up each time, at the very least on the class as singleton
    const userMcpTools = await this.deps.mcpServerRepository.listByUser(
      context.id
    );

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
      } catch (err) {
        // Skip handoff agents that create circular dependencies
        console.warn(
          `Skipping handoff agent ${handoffAgent.slug}: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
    }

    const tools: Tool<TAgentContext>[] = [];
    if (builtInTools.includes("internet_search")) {
      tools.push(webSearchTool());
    }
    if (builtInTools.includes("memory")) {
      // TODO: tools.push(memoryTool());
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
        hostedMcpTool({
          serverUrl: serverConfig.url,
          serverLabel: serverConfig.name,
          headers: serverConfig.headers || undefined,
          requireApproval: "never",
        })
      );
    }

    // Format date in user's timezone
    const userTimezone = (context as any).timezone || 'UTC';
    const formattedDate = new Intl.DateTimeFormat('en-US', {
      timeZone: userTimezone,
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short'
    }).format(new Date());

    // Create agent instance
    const agent = new Agent<TAgentContext>({
      name: agentData.name,
      instructions: agentData.system_prompt + "\n\nToday's Date: " + formattedDate,
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
}
