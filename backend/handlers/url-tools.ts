import type { BunRequest } from "bun";
import type { UrlToolRepository } from "../repositories/UrlToolRepository";
import type { User } from "../types/models";

interface UrlToolHandlerDependencies {
  urlToolRepository: UrlToolRepository;
  authenticate: (req: BunRequest) => Promise<{ user: User; session: { id: string; userId: number } } | null>;
}

interface CreateUrlToolRequest {
  name: string;
  description?: string;
  url: string;
  method: string;
  headers?: Record<string, string>;
}

const VALID_HTTP_METHODS = ["GET", "POST", "PUT", "DELETE", "PATCH"];

/**
 * Factory function to create URL tool management handlers
 */
export function createUrlToolHandlers(deps: UrlToolHandlerDependencies) {
  /**
   * GET /api/user/url-tools
   * List all URL tools for the current user
   */
  const list = async (req: BunRequest): Promise<Response> => {
    const auth = await deps.authenticate(req);
    if (!auth) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const tools = await deps.urlToolRepository.listByUser(auth.user.id);

    return new Response(JSON.stringify(tools), {
      headers: { "Content-Type": "application/json" },
    });
  };

  /**
   * POST /api/user/url-tools
   * Add a new URL tool for the current user
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
      const body: CreateUrlToolRequest = await req.json();

      // Validate input
      if (!body.name || !body.url || !body.method) {
        return new Response(JSON.stringify({ error: "Name, URL, and method are required" }), {
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

      // Validate HTTP method
      const method = body.method.toUpperCase();
      if (!VALID_HTTP_METHODS.includes(method)) {
        return new Response(
          JSON.stringify({
            error: `Invalid HTTP method. Must be one of: ${VALID_HTTP_METHODS.join(", ")}`,
          }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      // Create URL tool
      const tool = await deps.urlToolRepository.create({
        user_id: auth.user.id,
        name: body.name,
        description: body.description,
        url: body.url,
        method,
        headers: body.headers,
      });

      return new Response(JSON.stringify(tool), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      console.error("Error creating URL tool:", error);

      // Check for unique constraint violation (duplicate name)
      if (error instanceof Error && error.message.includes("unique")) {
        return new Response(JSON.stringify({ error: "URL tool with this name already exists" }), {
          status: 409,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ error: "Failed to create URL tool" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  };

  /**
   * PUT /api/user/url-tools/:id
   * Update a URL tool
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
        return new Response(JSON.stringify({ error: "Invalid tool ID" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Verify the tool belongs to the user
      const tool = await deps.urlToolRepository.findById(id);
      if (!tool) {
        return new Response(JSON.stringify({ error: "Tool not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (tool.user_id !== auth.user.id) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
          headers: { "Content-Type": "application/json" },
        });
      }

      const body: Partial<CreateUrlToolRequest> = await req.json();

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

      // Validate HTTP method if provided
      if (body.method) {
        const method = body.method.toUpperCase();
        if (!VALID_HTTP_METHODS.includes(method)) {
          return new Response(
            JSON.stringify({
              error: `Invalid HTTP method. Must be one of: ${VALID_HTTP_METHODS.join(", ")}`,
            }),
            {
              status: 400,
              headers: { "Content-Type": "application/json" },
            }
          );
        }
        body.method = method;
      }

      // Update the tool
      const updated = await deps.urlToolRepository.update(id, {
        name: body.name,
        description: body.description,
        url: body.url,
        method: body.method,
        headers: body.headers,
      });

      return new Response(JSON.stringify(updated), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      console.error("Error updating URL tool:", error);
      return new Response(JSON.stringify({ error: "Failed to update URL tool" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  };

  /**
   * DELETE /api/user/url-tools/:id
   * Remove a URL tool
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
        return new Response(JSON.stringify({ error: "Invalid tool ID" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Verify the tool belongs to the user
      const tool = await deps.urlToolRepository.findById(id);
      if (!tool) {
        return new Response(JSON.stringify({ error: "Tool not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (tool.user_id !== auth.user.id) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Delete the tool
      await deps.urlToolRepository.delete(id);

      return new Response(JSON.stringify({ success: true }), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      console.error("Error deleting URL tool:", error);
      return new Response(JSON.stringify({ error: "Failed to delete URL tool" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  };

  return { list, create, update, remove };
}
