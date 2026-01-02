import type { BunRequest } from "bun";
import type { McpServerRepository } from "../repositories/McpServerRepository";
import type { User } from "../types/models";

interface McpServerHandlerDependencies {
  mcpServerRepository: McpServerRepository;
  authenticate: (req: BunRequest) => Promise<{ user: User; session: { id: string; userId: number } } | null>;
}

interface CreateMcpServerRequest {
  name: string;
  url: string;
  headers?: Record<string, string>;
}

/**
 * Factory function to create MCP server management handlers
 */
export function createMcpServerHandlers(deps: McpServerHandlerDependencies) {
  /**
   * GET /api/user/mcp-servers
   * List all MCP servers for the current user
   */
  const list = async (req: BunRequest): Promise<Response> => {
    const auth = await deps.authenticate(req);
    if (!auth) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const servers = await deps.mcpServerRepository.listByUser(auth.user.id);

    return new Response(JSON.stringify(servers), {
      headers: { "Content-Type": "application/json" },
    });
  };

  /**
   * POST /api/user/mcp-servers
   * Add a new MCP server for the current user
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
      const body: CreateMcpServerRequest = await req.json();

      // Validate input
      if (!body.name || !body.url) {
        return new Response(JSON.stringify({ error: "Name and URL are required" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Validate URL format
      try {
        new URL(body.url);
      } catch {
        return new Response(JSON.stringify({ error: "Invalid URL format" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Create MCP server
      const server = await deps.mcpServerRepository.create(
        auth.user.id,
        body.name,
        body.url,
        body.headers
      );

      return new Response(JSON.stringify(server), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      console.error("Error creating MCP server:", error);

      // Check for unique constraint violation (duplicate name)
      if (error instanceof Error && error.message.includes("unique")) {
        return new Response(JSON.stringify({ error: "MCP server with this name already exists" }), {
          status: 409,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ error: "Failed to create MCP server" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  };

  /**
   * PUT /api/user/mcp-servers/:id
   * Update an MCP server
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
      const url = new URL(req.url);
      const pathParts = url.pathname.split("/");
      const id = parseInt(pathParts[pathParts.length - 1] ?? "");

      if (isNaN(id)) {
        return new Response(JSON.stringify({ error: "Invalid server ID" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Verify the server belongs to the user
      const server = await deps.mcpServerRepository.findById(id);
      if (!server) {
        return new Response(JSON.stringify({ error: "Server not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (server.user_id !== auth.user.id) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
          headers: { "Content-Type": "application/json" },
        });
      }

      const body: Partial<CreateMcpServerRequest> = await req.json();

      // Validate URL if provided
      if (body.url) {
        try {
          new URL(body.url);
        } catch {
          return new Response(JSON.stringify({ error: "Invalid URL format" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }
      }

      // Update the server
      const updated = await deps.mcpServerRepository.update(id, {
        name: body.name,
        url: body.url,
        headers: body.headers,
      });

      return new Response(JSON.stringify(updated), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      console.error("Error updating MCP server:", error);
      return new Response(JSON.stringify({ error: "Failed to update MCP server" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  };

  /**
   * DELETE /api/user/mcp-servers/:id
   * Remove an MCP server
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
      // Extract ID from URL path
      const url = new URL(req.url);
      const pathParts = url.pathname.split("/");
      const id = parseInt(pathParts[pathParts.length - 1] ?? "");

      if (isNaN(id)) {
        return new Response(JSON.stringify({ error: "Invalid server ID" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Verify the server belongs to the user
      const server = await deps.mcpServerRepository.findById(id);
      if (!server) {
        return new Response(JSON.stringify({ error: "Server not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (server.user_id !== auth.user.id) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Delete the server
      await deps.mcpServerRepository.delete(id);

      return new Response(JSON.stringify({ success: true }), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      console.error("Error deleting MCP server:", error);
      return new Response(JSON.stringify({ error: "Failed to delete MCP server" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  };

  return { list, create, update, remove };
}
