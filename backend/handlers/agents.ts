import type { BunRequest } from "bun";
import type { AgentRepository, CreateAgentData, UpdateAgentData } from "../repositories/AgentRepository";
import type { User } from "../types/models";

interface AgentHandlerDependencies {
  agentRepository: AgentRepository;
  authenticate: (req: BunRequest) => Promise<{ user: User; session: { id: string; userId: number } } | null>;
}

interface CreateAgentRequest {
  slug: string;
  name: string;
  purpose?: string;
  system_prompt: string;
  internet_search_enabled?: boolean;
}

interface UpdateAgentRequest {
  name?: string;
  purpose?: string;
  system_prompt?: string;
  internet_search_enabled?: boolean;
}

/**
 * Factory function to create agent management handlers
 */
export function createAgentHandlers(deps: AgentHandlerDependencies) {
  /**
   * GET /api/agents
   * List all agents for the current user
   */
  const list = async (req: BunRequest): Promise<Response> => {
    const auth = await deps.authenticate(req);
    if (!auth) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const agents = await deps.agentRepository.listByUser(auth.user.id);

    return new Response(JSON.stringify(agents), {
      headers: { "Content-Type": "application/json" },
    });
  };

  /**
   * POST /api/agents
   * Create a new agent
   */
  const create = async (req: BunRequest): Promise<Response> => {
    const auth = await deps.authenticate(req);
    if (!auth) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    try {
      const body: CreateAgentRequest = await req.json();

      // Validate input
      if (!body.slug || !body.name || !body.system_prompt) {
        return new Response(
          JSON.stringify({ error: "Slug, name, and system_prompt are required" }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      // Validate slug format (lowercase, alphanumeric, hyphens only)
      if (!/^[a-z0-9-]+$/.test(body.slug)) {
        return new Response(
          JSON.stringify({ error: "Slug must be lowercase alphanumeric with hyphens only" }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      // Check if slug already exists for this user
      const existing = await deps.agentRepository.findBySlug(auth.user.id, body.slug);
      if (existing) {
        return new Response(
          JSON.stringify({ error: "An agent with this slug already exists" }),
          {
            status: 409,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      // Create agent
      const agentData: CreateAgentData = {
        user_id: auth.user.id,
        slug: body.slug,
        name: body.name,
        purpose: body.purpose,
        system_prompt: body.system_prompt,
        internet_search_enabled: body.internet_search_enabled ?? false,
      };

      const agent = await deps.agentRepository.create(agentData);

      return new Response(JSON.stringify(agent), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      console.error("Error creating agent:", error);
      return new Response(JSON.stringify({ error: "Failed to create agent" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  };

  /**
   * GET /api/agents/:slug
   * Get a specific agent by slug
   */
  const get = async (req: BunRequest): Promise<Response> => {
    const auth = await deps.authenticate(req);
    if (!auth) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    try {
      // Extract slug from URL
      const url = new URL(req.url);
      const slug = url.pathname.split("/").pop();

      if (!slug) {
        return new Response(JSON.stringify({ error: "Invalid slug" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      const agent = await deps.agentRepository.findBySlug(auth.user.id, slug);
      if (!agent) {
        return new Response(JSON.stringify({ error: "Agent not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify(agent), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      console.error("Error fetching agent:", error);
      return new Response(JSON.stringify({ error: "Failed to fetch agent" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  };

  /**
   * PUT /api/agents/:slug
   * Update an existing agent
   */
  const update = async (req: BunRequest): Promise<Response> => {
    const auth = await deps.authenticate(req);
    if (!auth) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    try {
      // Extract slug from URL
      const url = new URL(req.url);
      const slug = url.pathname.split("/").pop();

      if (!slug) {
        return new Response(JSON.stringify({ error: "Invalid slug" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Find agent and verify ownership
      const agent = await deps.agentRepository.findBySlug(auth.user.id, slug);
      if (!agent) {
        return new Response(JSON.stringify({ error: "Agent not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (agent.user_id !== auth.user.id) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
          headers: { "Content-Type": "application/json" },
        });
      }

      const body: UpdateAgentRequest = await req.json();

      // Update agent
      const updatedAgent = await deps.agentRepository.update(agent.id, body);

      return new Response(JSON.stringify(updatedAgent), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      console.error("Error updating agent:", error);
      return new Response(JSON.stringify({ error: "Failed to update agent" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  };

  /**
   * DELETE /api/agents/:slug
   * Delete an agent
   */
  const remove = async (req: BunRequest): Promise<Response> => {
    const auth = await deps.authenticate(req);
    if (!auth) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    try {
      // Extract slug from URL
      const url = new URL(req.url);
      const slug = url.pathname.split("/").pop();

      if (!slug) {
        return new Response(JSON.stringify({ error: "Invalid slug" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Find agent and verify ownership
      const agent = await deps.agentRepository.findBySlug(auth.user.id, slug);
      if (!agent) {
        return new Response(JSON.stringify({ error: "Agent not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (agent.user_id !== auth.user.id) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
          headers: { "Content-Type": "application/json" },
        });
      }

      await deps.agentRepository.delete(agent.id);

      return new Response(JSON.stringify({ success: true }), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      console.error("Error deleting agent:", error);
      return new Response(JSON.stringify({ error: "Failed to delete agent" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  };

  /**
   * PATCH /api/agents/:slug/favorite
   * Toggle favorite status for an agent
   */
  const setFavorite = async (req: BunRequest): Promise<Response> => {
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
      const slug = pathParts[pathParts.length - 2] ?? ""; // /api/agents/:slug/favorite

      const agent = await deps.agentRepository.findBySlug(auth.user.id, slug);

      if (!agent) {
        return new Response(JSON.stringify({ error: "Agent not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (agent.user_id !== auth.user.id) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
          headers: { "Content-Type": "application/json" },
        });
      }

      const body = await req.json();
      const isFavorite = body.is_favorite;

      if (typeof isFavorite !== "boolean") {
        return new Response(JSON.stringify({ error: "is_favorite must be a boolean" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      await deps.agentRepository.setFavorite(agent.id, isFavorite);

      return new Response(JSON.stringify({ success: true }), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      console.error("Error setting favorite:", error);
      return new Response(JSON.stringify({ error: "Failed to set favorite" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  };

  return { list, create, get, update, remove, setFavorite };
}
