import type { BunRequest } from "bun";
import type { AgentRepository } from "../repositories/AgentRepository";
import type { McpServerRepository } from "../repositories/McpServerRepository";
import type { User } from "../types/models";

interface AgentToolsHandlerDependencies {
  agentRepository: AgentRepository;
  mcpServerRepository: McpServerRepository;
  authenticate: (req: BunRequest) => Promise<{ user: User; session: { id: string; userId: number } } | null>;
}

/**
 * Factory function to create agent tools/handoffs management handlers
 */
export function createAgentToolsHandlers(deps: AgentToolsHandlerDependencies) {
  /**
   * Helper to get agent and verify ownership
   */
  const getAgentWithOwnership = async (userId: number, slug: string) => {
    const agent = await deps.agentRepository.findBySlug(userId, slug);
    if (!agent) {
      return { error: "Agent not found", status: 404 };
    }
    if (agent.user_id !== userId) {
      return { error: "Forbidden", status: 403 };
    }
    return { agent };
  };

  /**
   * GET /api/agents/:slug/tools
   * Get all tools configured for an agent
   */
  const getTools = async (req: BunRequest): Promise<Response> => {
    const auth = await deps.authenticate(req);
    if (!auth) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    try {
      const url = new URL(req.url);
      const pathParts = url.pathname.split("/");
      const slug = pathParts[pathParts.length - 2] ?? ""; // /api/agents/:slug/tools

      const result = await getAgentWithOwnership(auth.user.id, slug);
      if (result.error) {
        return new Response(JSON.stringify({ error: result.error }), {
          status: result.status,
          headers: { "Content-Type": "application/json" },
        });
      }

      const builtInToolIds = await deps.agentRepository.listBuiltInTools(result.agent!.id);
      const mcpToolIds = await deps.agentRepository.listMcpTools(result.agent!.id);

      return new Response(
        JSON.stringify({
          built_in_tools: builtInToolIds,
          mcp_tools: mcpToolIds,
        }),
        { headers: { "Content-Type": "application/json" } }
      );
    } catch (error) {
      console.error("Error fetching agent tools:", error);
      return new Response(JSON.stringify({ error: "Failed to fetch tools" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  };

  /**
   * POST /api/agents/:slug/tools/built-in
   * Add a built-in tool to an agent
   */
  const addBuiltInTool = async (req: BunRequest): Promise<Response> => {
    const auth = await deps.authenticate(req);
    if (!auth) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    try {
      const url = new URL(req.url);
      const pathParts = url.pathname.split("/");
      const slug = pathParts[pathParts.length - 3] ?? ""; // /api/agents/:slug/tools/built-in

      const result = await getAgentWithOwnership(auth.user.id, slug);
      if (result.error) {
        return new Response(JSON.stringify({ error: result.error }), {
          status: result.status,
          headers: { "Content-Type": "application/json" },
        });
      }

      const body = await req.json();
      const { tool_id } = body;

      if (!tool_id) {
        return new Response(JSON.stringify({ error: "tool_id is required" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      await deps.agentRepository.addBuiltInTool(result.agent!.id, tool_id);

      return new Response(JSON.stringify({ success: true }), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      console.error("Error adding built-in tool:", error);
      return new Response(JSON.stringify({ error: "Failed to add tool" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  };

  /**
   * DELETE /api/agents/:slug/tools/built-in/:toolName
   * Remove a built-in tool from an agent
   */
  const removeBuiltInTool = async (req: BunRequest): Promise<Response> => {
    const auth = await deps.authenticate(req);
    if (!auth) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    try {
      const url = new URL(req.url);
      const pathParts = url.pathname.split("/");
      const slug = pathParts[pathParts.length - 4] ?? ""; // /api/agents/:slug/tools/built-in/:toolName
      const toolName = pathParts[pathParts.length - 1] ?? "";

      const result = await getAgentWithOwnership(auth.user.id, slug);
      if (result.error) {
        return new Response(JSON.stringify({ error: result.error }), {
          status: result.status,
          headers: { "Content-Type": "application/json" },
        });
      }

      await deps.agentRepository.removeBuiltInTool(result.agent!.id, toolName);

      return new Response(JSON.stringify({ success: true }), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      console.error("Error removing built-in tool:", error);
      return new Response(JSON.stringify({ error: "Failed to remove tool" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  };

  /**
   * POST /api/agents/:slug/tools/mcp
   * Add an MCP tool to an agent
   */
  const addMcpTool = async (req: BunRequest): Promise<Response> => {
    const auth = await deps.authenticate(req);
    if (!auth) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    try {
      const url = new URL(req.url);
      const pathParts = url.pathname.split("/");
      const slug = pathParts[pathParts.length - 3] ?? ""; // /api/agents/:slug/tools/mcp

      const result = await getAgentWithOwnership(auth.user.id, slug);
      if (result.error) {
        return new Response(JSON.stringify({ error: result.error }), {
          status: result.status,
          headers: { "Content-Type": "application/json" },
        });
      }

      const body = await req.json();
      const { mcp_server_id } = body;

      if (!mcp_server_id) {
        return new Response(JSON.stringify({ error: "mcp_server_id is required" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Verify MCP server belongs to user
      const mcpServer = await deps.mcpServerRepository.findById(mcp_server_id);
      if (!mcpServer || mcpServer.user_id !== auth.user.id) {
        return new Response(JSON.stringify({ error: "MCP server not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }

      await deps.agentRepository.addMcpTool(result.agent!.id, mcp_server_id);

      return new Response(JSON.stringify({ success: true }), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      console.error("Error adding MCP tool:", error);
      return new Response(JSON.stringify({ error: "Failed to add MCP tool" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  };

  /**
   * DELETE /api/agents/:slug/tools/mcp/:mcpServerId
   * Remove an MCP tool from an agent
   */
  const removeMcpTool = async (req: BunRequest): Promise<Response> => {
    const auth = await deps.authenticate(req);
    if (!auth) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    try {
      const url = new URL(req.url);
      const pathParts = url.pathname.split("/");
      const slug = pathParts[pathParts.length - 4] ?? ""; // /api/agents/:slug/tools/mcp/:mcpServerId
      const mcpServerId = parseInt(pathParts[pathParts.length - 1] ?? "");

      const result = await getAgentWithOwnership(auth.user.id, slug);
      if (result.error) {
        return new Response(JSON.stringify({ error: result.error }), {
          status: result.status,
          headers: { "Content-Type": "application/json" },
        });
      }

      await deps.agentRepository.removeMcpTool(result.agent!.id, mcpServerId);

      return new Response(JSON.stringify({ success: true }), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      console.error("Error removing MCP tool:", error);
      return new Response(JSON.stringify({ error: "Failed to remove MCP tool" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  };

  /**
   * GET /api/agents/:slug/handoffs
   * Get all handoffs configured for an agent
   */
  const getHandoffs = async (req: BunRequest): Promise<Response> => {
    const auth = await deps.authenticate(req);
    if (!auth) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    try {
      const url = new URL(req.url);
      const pathParts = url.pathname.split("/");
      const slug = pathParts[pathParts.length - 2] ?? ""; // /api/agents/:slug/handoffs

      const result = await getAgentWithOwnership(auth.user.id, slug);
      if (result.error) {
        return new Response(JSON.stringify({ error: result.error }), {
          status: result.status,
          headers: { "Content-Type": "application/json" },
        });
      }

      const handoffAgents = await deps.agentRepository.listHandoffs(result.agent!.id);
      const handoffIds = handoffAgents.map((agent) => agent.id);

      return new Response(JSON.stringify({ handoff_agent_ids: handoffIds }), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      console.error("Error fetching handoffs:", error);
      return new Response(JSON.stringify({ error: "Failed to fetch handoffs" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  };

  /**
   * POST /api/agents/:slug/handoffs
   * Add a handoff to another agent
   */
  const addHandoff = async (req: BunRequest): Promise<Response> => {
    const auth = await deps.authenticate(req);
    if (!auth) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    try {
      const url = new URL(req.url);
      const pathParts = url.pathname.split("/");
      const slug = pathParts[pathParts.length - 2] ?? ""; // /api/agents/:slug/handoffs

      const result = await getAgentWithOwnership(auth.user.id, slug);
      if (result.error) {
        return new Response(JSON.stringify({ error: result.error }), {
          status: result.status,
          headers: { "Content-Type": "application/json" },
        });
      }

      const body = await req.json();
      const { to_agent_slug } = body;

      if (!to_agent_slug) {
        return new Response(JSON.stringify({ error: "to_agent_slug is required" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Find target agent and verify ownership
      const toAgent = await deps.agentRepository.findBySlug(auth.user.id, to_agent_slug);
      if (!toAgent) {
        return new Response(JSON.stringify({ error: "Target agent not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Prevent self-handoff
      if (result.agent!.id === toAgent.id) {
        return new Response(JSON.stringify({ error: "Cannot handoff to self" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      await deps.agentRepository.addHandoff(result.agent!.id, toAgent.id);

      return new Response(JSON.stringify({ success: true }), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      console.error("Error adding handoff:", error);
      return new Response(JSON.stringify({ error: "Failed to add handoff" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  };

  /**
   * DELETE /api/agents/:slug/handoffs/:toAgentSlug
   * Remove a handoff to another agent
   */
  const removeHandoff = async (req: BunRequest): Promise<Response> => {
    const auth = await deps.authenticate(req);
    if (!auth) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    try {
      const url = new URL(req.url);
      const pathParts = url.pathname.split("/");
      const slug = pathParts[pathParts.length - 3] ?? ""; // /api/agents/:slug/handoffs/:toAgentSlug
      const toAgentSlug = pathParts[pathParts.length - 1] ?? "";

      const result = await getAgentWithOwnership(auth.user.id, slug);
      if (result.error) {
        return new Response(JSON.stringify({ error: result.error }), {
          status: result.status,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Find target agent
      const toAgent = await deps.agentRepository.findBySlug(auth.user.id, toAgentSlug);
      if (!toAgent) {
        return new Response(JSON.stringify({ error: "Target agent not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }

      await deps.agentRepository.removeHandoff(result.agent!.id, toAgent.id);

      return new Response(JSON.stringify({ success: true }), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      console.error("Error removing handoff:", error);
      return new Response(JSON.stringify({ error: "Failed to remove handoff" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  };

  return {
    getTools,
    addBuiltInTool,
    removeBuiltInTool,
    addMcpTool,
    removeMcpTool,
    getHandoffs,
    addHandoff,
    removeHandoff,
  };
}
