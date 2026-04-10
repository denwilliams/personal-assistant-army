import { tool } from "ai";
import type { Tool as AiTool } from "ai";
import type { UrlTool as UrlToolModel } from "../types/models";
import { z } from "zod";
import type { ToolStatusUpdate } from "./context";

/**
 * Creates a tool that makes HTTP requests to a configured URL
 */
export function createUrlTool(
  urlToolConfig: UrlToolModel,
  updateStatus: ToolStatusUpdate
): Record<string, AiTool> {
  const name = urlToolConfig.name.replace(/[^a-z0-9_]/gi, "_").toLowerCase();

  const urlTool = tool({
    description:
      urlToolConfig.description ||
      `Make a ${urlToolConfig.method} request to ${urlToolConfig.url}`,
    inputSchema: z.object({}),
    execute: async () => {
      updateStatus(`Loading data from ${urlToolConfig.name}...`);

      try {
        const headers: HeadersInit = {
          ...(urlToolConfig.headers || {}),
        };

        const response = await fetch(urlToolConfig.url, {
          method: urlToolConfig.method,
          headers,
        });

        if (!response.ok) {
          return JSON.stringify({
            success: false,
            error: `HTTP ${response.status}: ${response.statusText}`,
            status: response.status,
          });
        }

        const contentType = response.headers.get("content-type");
        let data: any;

        if (contentType?.includes("application/json")) {
          data = await response.json();
        } else {
          data = await response.text();
        }

        updateStatus(`Loaded data from ${urlToolConfig.name} successfully.`);

        return JSON.stringify({
          success: true,
          status: response.status,
          data,
        });
      } catch (error) {
        return JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  });

  return { [name]: urlTool };
}
