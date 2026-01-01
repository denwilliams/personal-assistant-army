import { sql } from "bun";
import type { Agent } from "../../types/models";
import type { AgentRepository, CreateAgentData, UpdateAgentData } from "../AgentRepository";

export class PostgresAgentRepository implements AgentRepository {
  async listByUser(userId: number): Promise<Agent[]> {
    return await sql`
      SELECT * FROM agents WHERE user_id = ${userId} ORDER BY created_at DESC
    `;
  }

  async findById(id: number): Promise<Agent | null> {
    const result = await sql`
      SELECT * FROM agents WHERE id = ${id}
    `;
    return result[0] || null;
  }

  async findBySlug(userId: number, slug: string): Promise<Agent | null> {
    const result = await sql`
      SELECT * FROM agents WHERE user_id = ${userId} AND slug = ${slug}
    `;
    return result[0] || null;
  }

  async create(data: CreateAgentData): Promise<Agent> {
    const result = await sql`
      INSERT INTO agents (user_id, slug, name, purpose, system_prompt, internet_search_enabled)
      VALUES (
        ${data.user_id},
        ${data.slug},
        ${data.name},
        ${data.purpose || null},
        ${data.system_prompt},
        ${data.internet_search_enabled ?? false}
      )
      RETURNING *
    `;
    return result[0];
  }

  async update(id: number, data: UpdateAgentData): Promise<Agent> {
    const updates: string[] = [];

    if (data.name !== undefined) {
      await sql`UPDATE agents SET name = ${data.name} WHERE id = ${id}`;
    }
    if (data.purpose !== undefined) {
      await sql`UPDATE agents SET purpose = ${data.purpose} WHERE id = ${id}`;
    }
    if (data.system_prompt !== undefined) {
      await sql`UPDATE agents SET system_prompt = ${data.system_prompt} WHERE id = ${id}`;
    }
    if (data.internet_search_enabled !== undefined) {
      await sql`UPDATE agents SET internet_search_enabled = ${data.internet_search_enabled} WHERE id = ${id}`;
    }

    await sql`UPDATE agents SET updated_at = CURRENT_TIMESTAMP WHERE id = ${id}`;

    const result = await sql`SELECT * FROM agents WHERE id = ${id}`;
    return result[0];
  }

  async delete(id: number): Promise<void> {
    await sql`DELETE FROM agents WHERE id = ${id}`;
  }

  async addBuiltInTool(agentId: number, toolId: number): Promise<void> {
    await sql`
      INSERT INTO agent_built_in_tools (agent_id, tool_id)
      VALUES (${agentId}, ${toolId})
      ON CONFLICT (agent_id, tool_id) DO NOTHING
    `;
  }

  async removeBuiltInTool(agentId: number, toolId: number): Promise<void> {
    await sql`
      DELETE FROM agent_built_in_tools
      WHERE agent_id = ${agentId} AND tool_id = ${toolId}
    `;
  }

  async listBuiltInTools(agentId: number): Promise<number[]> {
    const result = await sql`
      SELECT tool_id FROM agent_built_in_tools WHERE agent_id = ${agentId}
    `;
    return result.map((row: any) => row.tool_id);
  }

  async addMcpTool(agentId: number, mcpServerId: number): Promise<void> {
    await sql`
      INSERT INTO agent_mcp_tools (agent_id, mcp_server_id)
      VALUES (${agentId}, ${mcpServerId})
      ON CONFLICT (agent_id, mcp_server_id) DO NOTHING
    `;
  }

  async removeMcpTool(agentId: number, mcpServerId: number): Promise<void> {
    await sql`
      DELETE FROM agent_mcp_tools
      WHERE agent_id = ${agentId} AND mcp_server_id = ${mcpServerId}
    `;
  }

  async listMcpTools(agentId: number): Promise<number[]> {
    const result = await sql`
      SELECT mcp_server_id FROM agent_mcp_tools WHERE agent_id = ${agentId}
    `;
    return result.map((row: any) => row.mcp_server_id);
  }

  async addHandoff(fromAgentId: number, toAgentId: number): Promise<void> {
    await sql`
      INSERT INTO agent_handoffs (from_agent_id, to_agent_id)
      VALUES (${fromAgentId}, ${toAgentId})
      ON CONFLICT (from_agent_id, to_agent_id) DO NOTHING
    `;
  }

  async removeHandoff(fromAgentId: number, toAgentId: number): Promise<void> {
    await sql`
      DELETE FROM agent_handoffs
      WHERE from_agent_id = ${fromAgentId} AND to_agent_id = ${toAgentId}
    `;
  }

  async listHandoffs(fromAgentId: number): Promise<number[]> {
    const result = await sql`
      SELECT to_agent_id FROM agent_handoffs WHERE from_agent_id = ${fromAgentId}
    `;
    return result.map((row: any) => row.to_agent_id);
  }
}
