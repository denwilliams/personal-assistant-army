import { Agent } from "@openai/agents";
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
  async createAgent(userId: number, agentSlug: string, openaiApiKey: string): Promise<Agent> {
    // Get agent from database
    const agentData = await this.deps.agentRepository.findBySlug(userId, agentSlug);
    if (!agentData) {
      throw new Error(`Agent not found: ${agentSlug}`);
    }

    // Verify ownership
    if (agentData.user_id !== userId) {
      throw new Error("Unauthorized: Agent does not belong to user");
    }

    // Get agent's configured tools
    const builtInTools = await this.deps.agentRepository.listBuiltInTools(agentData.id);
    const mcpTools = await this.deps.agentRepository.listMcpTools(agentData.id);
    const handoffs = await this.deps.agentRepository.listHandoffs(agentData.id);

    // Create base agent
    const agent = new Agent({
      name: agentData.name,
      instructions: agentData.system_prompt,
      // TODO: Add tools configuration based on builtInTools, mcpTools
      // TODO: Add handoffs configuration
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
