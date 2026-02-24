import { tool } from "@openai/agents";
import type { UrlTool as UrlToolModel } from "../types/models";
type Properties = { background: boolean };

type Parameters = {
  type: "object";
  properties: Properties;
  required: (keyof Properties)[];
  additionalProperties: false;
};

const parameters: Parameters = {
  type: "object",
  properties: {} as Properties,
  required: [],
  additionalProperties: false,
};

/**
 * Creates a tool that makes HTTP requests to a configured URL
 */
import type { ToolContext } from "./context";

export function createUrlTool<TContext extends ToolContext>(
  urlToolConfig: UrlToolModel
) {
  return tool<Parameters, TContext>({
    name: urlToolConfig.name.replace(/[^a-z0-9_]/gi, "_").toLowerCase(),
    description:
      urlToolConfig.description ||
      `Make a ${urlToolConfig.method} request to ${urlToolConfig.url}`,
    parameters,
    execute: async (params, context) => {
      context?.context.updateStatus(
        `Loading data from ${urlToolConfig.name}...`
      );

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

        // TODO: look for standard interface in response to determine success/failure and status update
        context?.context.updateStatus(
          `Loaded data from ${urlToolConfig.name} successfully.`
        );

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
