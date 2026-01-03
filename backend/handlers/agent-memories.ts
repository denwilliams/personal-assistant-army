import type { BunRequest } from "bun";
import type { AgentRepository } from "../repositories/AgentRepository";
import type { MemoryRepository } from "../repositories/MemoryRepository";
import type { User } from "../types/models";

interface AgentMemoriesHandlerDependencies {
  agentRepository: AgentRepository;
  memoryRepository: MemoryRepository;
  authenticate: (req: BunRequest) => Promise<{ user: User; session: { id: string; userId: number } } | null>;
}

/**
 * Factory function to create agent memories management handlers
 */
export function createAgentMemoriesHandlers(deps: AgentMemoriesHandlerDependencies) {
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
   * GET /api/agents/:slug/memories
   * Get all memories for an agent
   */
  const getMemories = async (req: BunRequest): Promise<Response> => {
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
      const slug = pathParts[pathParts.length - 2] ?? ""; // /api/agents/:slug/memories

      const result = await getAgentWithOwnership(auth.user.id, slug);
      if (result.error) {
        return new Response(JSON.stringify({ error: result.error }), {
          status: result.status,
          headers: { "Content-Type": "application/json" },
        });
      }

      const memories = await deps.memoryRepository.listByAgent(result.agent!.id);

      return new Response(JSON.stringify({ memories }), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (err) {
      console.error("Error getting agent memories:", err);
      return new Response(
        JSON.stringify({ error: "Failed to get memories" }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
  };

  /**
   * DELETE /api/agents/:slug/memories/:key
   * Delete a specific memory by key
   */
  const deleteMemory = async (req: BunRequest): Promise<Response> => {
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
      const slug = pathParts[pathParts.length - 3] ?? ""; // /api/agents/:slug/memories/:key
      const memoryKey = decodeURIComponent(pathParts[pathParts.length - 1] ?? "");

      if (!memoryKey) {
        return new Response(JSON.stringify({ error: "Invalid memory key" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      const result = await getAgentWithOwnership(auth.user.id, slug);
      if (result.error) {
        return new Response(JSON.stringify({ error: result.error }), {
          status: result.status,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Verify the memory belongs to this agent
      const memory = await deps.memoryRepository.get(result.agent!.id, memoryKey);
      if (!memory) {
        return new Response(JSON.stringify({ error: "Memory not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }

      await deps.memoryRepository.delete(result.agent!.id, memoryKey);

      return new Response(JSON.stringify({ success: true }), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (err) {
      console.error("Error deleting memory:", err);
      return new Response(
        JSON.stringify({ error: "Failed to delete memory" }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
  };

  return {
    getMemories,
    deleteMemory,
  };
}
