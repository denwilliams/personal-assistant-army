import { sql } from "bun";
import type { Agent } from "../../types/models";
import type { AgentRepository, CreateAgentData, UpdateAgentData } from "../AgentRepository";

export class PostgresAgentRepository implements AgentRepository {
  async listByUser(userId: number): Promise<Agent[]> {
    return await sql`
      SELECT * FROM agents
      WHERE user_id = ${userId}
      ORDER BY is_favorite DESC, created_at DESC
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

  async setFavorite(agentId: number, isFavorite: boolean): Promise<void> {
    await sql`UPDATE agents SET is_favorite = ${isFavorite} WHERE id = ${agentId}`;
  }

  async addBuiltInTool(agentId: number, toolName: string): Promise<void> {
    // Look up tool ID by name
    const toolResult = await sql`
      SELECT id FROM built_in_tools WHERE type = ${toolName}
    `;

    if (toolResult.length === 0) {
      throw new Error(`Built-in tool not found: ${toolName}`);
    }

    const toolId = toolResult[0].id;

    await sql`
      INSERT INTO agent_built_in_tools (agent_id, tool_id)
      VALUES (${agentId}, ${toolId})
      ON CONFLICT (agent_id, tool_id) DO NOTHING
    `;
  }

  async removeBuiltInTool(agentId: number, toolName: string): Promise<void> {
    // Look up tool ID by name
    const toolResult = await sql`
      SELECT id FROM built_in_tools WHERE type = ${toolName}
    `;

    if (toolResult.length === 0) {
      throw new Error(`Built-in tool not found: ${toolName}`);
    }

    const toolId = toolResult[0].id;

    await sql`
      DELETE FROM agent_built_in_tools
      WHERE agent_id = ${agentId} AND tool_id = ${toolId}
    `;
  }

  async listBuiltInTools(agentId: number): Promise<string[]> {
    const result = await sql`
      SELECT bt.type
      FROM agent_built_in_tools abt
      JOIN built_in_tools bt ON abt.tool_id = bt.id
      WHERE abt.agent_id = ${agentId}
    `;
    return result.map((row: any) => row.type);
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

  async addUrlTool(agentId: number, urlToolId: number): Promise<void> {
    await sql`
      INSERT INTO agent_url_tools (agent_id, url_tool_id)
      VALUES (${agentId}, ${urlToolId})
      ON CONFLICT (agent_id, url_tool_id) DO NOTHING
    `;
  }

  async removeUrlTool(agentId: number, urlToolId: number): Promise<void> {
    await sql`
      DELETE FROM agent_url_tools
      WHERE agent_id = ${agentId} AND url_tool_id = ${urlToolId}
    `;
  }

  async listUrlTools(agentId: number): Promise<number[]> {
    const result = await sql`
      SELECT url_tool_id FROM agent_url_tools WHERE agent_id = ${agentId}
    `;
    return result.map((row: any) => row.url_tool_id);
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

  async listHandoffs(fromAgentId: number): Promise<Agent[]> {
    const result = await sql`
      SELECT a.*
      FROM agent_handoffs ah
      JOIN agents a ON ah.to_agent_id = a.id
      WHERE ah.from_agent_id = ${fromAgentId}
      ORDER BY a.name
    `;
    return result;
  }

  async addAgentTool(agentId: number, toolAgentId: number): Promise<void> {
    await sql`
      INSERT INTO agent_agent_tools (agent_id, tool_agent_id)
      VALUES (${agentId}, ${toolAgentId})
      ON CONFLICT (agent_id, tool_agent_id) DO NOTHING
    `;
  }

  async removeAgentTool(agentId: number, toolAgentId: number): Promise<void> {
    await sql`
      DELETE FROM agent_agent_tools
      WHERE agent_id = ${agentId} AND tool_agent_id = ${toolAgentId}
    `;
  }

  async listAgentTools(agentId: number): Promise<Agent[]> {
    const result = await sql`
      SELECT a.*
      FROM agent_agent_tools aat
      JOIN agents a ON aat.tool_agent_id = a.id
      WHERE aat.agent_id = ${agentId}
      ORDER BY a.name
    `;
    return result;
  }
}
