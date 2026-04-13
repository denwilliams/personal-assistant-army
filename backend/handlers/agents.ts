import type { BunRequest } from "bun";
import type { AgentRepository, CreateAgentData, UpdateAgentData } from "../repositories/AgentRepository";
import type { User, PoolType, NotifierChannel } from "../types/models";

function getDomain(email: string): string {
  return email.split("@")[1] || "";
}

interface AgentHandlerDependencies {
  agentRepository: AgentRepository;
  authenticate: (req: BunRequest) => Promise<{ user: User; session: { id: string; userId: number } } | null>;
}

const VALID_NOTIFIER_CHANNELS: NotifierChannel[] = ['email', 'webhook', 'pushover'];

interface CreateAgentRequest {
  slug: string;
  name: string;
  purpose?: string;
  system_prompt: string;
  model?: string;
  internet_search_enabled?: boolean;
  pool_type?: PoolType;
  default_notifier?: NotifierChannel | null;
  default_notifier_destination?: string | null;
}

interface UpdateAgentRequest {
  name?: string;
  purpose?: string;
  system_prompt?: string;
  model?: string;
  internet_search_enabled?: boolean;
  default_notifier?: NotifierChannel | null;
  default_notifier_destination?: string | null;
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

    const domain = getDomain(auth.user.email);
    const agents = await deps.agentRepository.listAccessible(auth.user.id, domain);

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

      const poolType = body.pool_type || 'personal';
      if (poolType !== 'personal' && poolType !== 'team') {
        return new Response(
          JSON.stringify({ error: "pool_type must be 'personal' or 'team'" }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      const domain = getDomain(auth.user.email);

      // Check if slug already exists in the accessible scope
      const existing = await deps.agentRepository.findAccessibleBySlug(auth.user.id, domain, body.slug);
      if (existing) {
        return new Response(
          JSON.stringify({ error: "An agent with this slug already exists" }),
          {
            status: 409,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      // Validate default_notifier if provided
      if (body.default_notifier !== undefined && body.default_notifier !== null) {
        if (!VALID_NOTIFIER_CHANNELS.includes(body.default_notifier)) {
          return new Response(
            JSON.stringify({ error: "default_notifier must be 'email', 'webhook', 'pushover', or null" }),
            { status: 400, headers: { "Content-Type": "application/json" } }
          );
        }
      }

      // Create agent
      const agentData: CreateAgentData = {
        user_id: auth.user.id,
        slug: body.slug,
        name: body.name,
        purpose: body.purpose,
        system_prompt: body.system_prompt,
        model: body.model,
        internet_search_enabled: body.internet_search_enabled ?? false,
        pool_type: poolType,
        domain: poolType === 'team' ? domain : undefined,
        default_notifier: body.default_notifier ?? null,
        default_notifier_destination: body.default_notifier_destination ?? null,
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

      const domain = getDomain(auth.user.email);
      const agent = await deps.agentRepository.findAccessibleBySlug(auth.user.id, domain, slug);
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

      // Find agent - use accessible lookup so we can find team agents too
      const domain = getDomain(auth.user.email);
      const agent = await deps.agentRepository.findAccessibleBySlug(auth.user.id, domain, slug);
      if (!agent) {
        return new Response(JSON.stringify({ error: "Agent not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Only the creator can update an agent
      if (agent.user_id !== auth.user.id) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
          headers: { "Content-Type": "application/json" },
        });
      }

      const body: UpdateAgentRequest = await req.json();

      // Validate default_notifier if provided
      if (body.default_notifier !== undefined && body.default_notifier !== null) {
        if (!VALID_NOTIFIER_CHANNELS.includes(body.default_notifier)) {
          return new Response(
            JSON.stringify({ error: "default_notifier must be 'email', 'webhook', 'pushover', or null" }),
            { status: 400, headers: { "Content-Type": "application/json" } }
          );
        }
      }

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

      // Find agent - use accessible lookup so we can find team agents too
      const domain = getDomain(auth.user.email);
      const agent = await deps.agentRepository.findAccessibleBySlug(auth.user.id, domain, slug);
      if (!agent) {
        return new Response(JSON.stringify({ error: "Agent not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Only the creator can delete an agent
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

      const domain = getDomain(auth.user.email);
      const agent = await deps.agentRepository.findAccessibleBySlug(auth.user.id, domain, slug);

      if (!agent) {
        return new Response(JSON.stringify({ error: "Agent not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Only the creator can set favorite on their agents
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
