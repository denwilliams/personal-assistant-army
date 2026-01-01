import { Agent, imageGenerationTool, webSearchTool, type Tool } from "@openai/agents";
import type { Agent as AgentModel } from "../types/models";
import type { AgentRepository } from "../repositories/AgentRepository";
import type { UserRepository } from "../repositories/UserRepository";

interface AgentFactoryDependencies {
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
  async createAgent<TAgentContext extends {id: number}>(context: TAgentContext, agentSlug: string, openaiApiKey: string): Promise<Agent<TAgentContext>> {
    // Get agent from database
    const agentData = await this.deps.agentRepository.findBySlug(context.id, agentSlug);
    if (!agentData) {
      throw new Error(`Agent not found: ${agentSlug}`);
    }

    // Verify ownership
    if (agentData.user_id !== context.id) {
      throw new Error("Unauthorized: Agent does not belong to user");
    }

    // Get agent's configured tools
    const builtInTools = await this.deps.agentRepository.listBuiltInTools(agentData.id);
    const mcpTools = await this.deps.agentRepository.listMcpTools(agentData.id);
    const handoffAgents = await this.deps.agentRepository.listHandoffs(agentData.id);

    const handoffs = handoffAgents.map((agent) => new Agent<TAgentContext>({
      name: agent.name,
      instructions: agent.system_prompt,
      model: "gpt-4.1-mini",
      // tools,
      // handoffs,
    }));

    const tools: Tool<TAgentContext>[] = [];
    if (builtInTools.includes("internet_search")) {
      tools.push(webSearchTool());
    }
    if (builtInTools.includes("memory")) {
      // tools.push(...);
    }

    // Create base agent
    const agent = new Agent<TAgentContext>({
      name: agentData.name,
      instructions: agentData.system_prompt,
      // TODO: interestingly we can shim in Claude here by implementing Model#getResponse / Model#getStreamedResponse
      // TODO: we should allow this to be set on the agent
      model: "gpt-4.1-mini",
      // TODO: Add tools configuration based on builtInTools, mcpTools
      tools,
      // TODO: Add handoffs configuration
      handoffs,
    });

    return agent;
  }

  /**
   * Get agent configuration from database without creating OpenAI agent
   */
  async getAgentConfig(userId: number, agentSlug: string): Promise<AgentModel> {
    const agentData = await this.deps.agentRepository.findBySlug(userId, agentSlug);
    if (!agentData) {
      throw new Error(`Agent not found: ${agentSlug}`);
    }

    if (agentData.user_id !== userId) {
      throw new Error("Unauthorized: Agent does not belong to user");
    }

    return agentData;
  }
}
