import { tool } from "@openai/agents";
import type { UrlTool as UrlToolModel } from "../types/models";

/**
 * Creates a tool that makes HTTP requests to a configured URL
 */
export function createUrlTool<TContext>(urlToolConfig: UrlToolModel) {
  return tool<TContext>({
    name: urlToolConfig.name.replace(/[^a-z0-9_]/gi, "_").toLowerCase(),
    description: urlToolConfig.description || `Make a ${urlToolConfig.method} request to ${urlToolConfig.url}`,
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
    execute: async () => {
      try {
        const headers: HeadersInit = {
          ...(urlToolConfig.headers || {}),
        };

        const response = await fetch(urlToolConfig.url, {
          method: urlToolConfig.method,
          headers,
        });

        if (!response.ok) {
          return {
            success: false,
            error: `HTTP ${response.status}: ${response.statusText}`,
            status: response.status,
          };
        }

        // Try to parse as JSON, fall back to text
        const contentType = response.headers.get("content-type");
        let data: any;

        if (contentType?.includes("application/json")) {
          data = await response.json();
        } else {
          data = await response.text();
        }

        return {
          success: true,
          status: response.status,
          data,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  });
}
