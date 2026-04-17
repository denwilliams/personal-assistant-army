/**
 * MCP (Model Context Protocol) Streamable HTTP client.
 *
 * Handles JSON-RPC 2.0 over HTTP with SSE response parsing,
 * session management, and in-memory tool list caching.
 */

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface McpClientOptions {
  url: string;
  headers?: Record<string, string>;
}

interface CacheEntry {
  tools: McpTool[];
  sessionId?: string;
  expiresAt: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const FETCH_TIMEOUT_MS = 30_000; // 30 seconds

const toolsCache = new Map<string, CacheEntry>();

let requestIdCounter = 1;

/**
 * Parse a JSON-RPC result from either an SSE or plain JSON response.
 */
async function parseSseJsonRpc(response: Response): Promise<any> {
  const contentType = response.headers.get("content-type") || "";

  if (contentType.includes("text/event-stream")) {
    const text = await response.text();
    const lines = text.split("\n");
    for (const line of lines) {
      if (line.startsWith("data: ")) {
        try {
          return JSON.parse(line.slice(6));
        } catch {
          // continue to next data line
        }
      }
    }
    throw new Error("No valid JSON-RPC response found in SSE stream");
  }

  return response.json();
}

function buildHeaders(
  custom?: Record<string, string>,
  sessionId?: string
): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    ...(custom || {}),
    ...(sessionId ? { "mcp-session-id": sessionId } : {}),
  };
}

async function rpc(
  url: string,
  method: string,
  params: Record<string, unknown>,
  headers: Record<string, string>
): Promise<{ data: any; response: Response }> {
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      method,
      params,
      id: requestIdCounter++,
    }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(
      `MCP server returned ${response.status} ${response.statusText}`
    );
  }

  const data = await parseSseJsonRpc(response);

  if (data.error) {
    throw new Error(
      `MCP error: ${data.error.message || JSON.stringify(data.error)}`
    );
  }

  return { data, response };
}

/**
 * Send an MCP `initialize` request and return the session ID (if any).
 */
export async function mcpInitialize(
  opts: McpClientOptions
): Promise<{ sessionId?: string }> {
  const { data, response } = await rpc(
    opts.url,
    "initialize",
    {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "personal-assistant-army", version: "1.0.0" },
    },
    buildHeaders(opts.headers)
  );

  const sessionId =
    response.headers.get("mcp-session-id") ?? data.result?.sessionId;

  return { sessionId: sessionId || undefined };
}

/**
 * Call `tools/list` on an MCP server and return the discovered tools.
 */
export async function mcpListTools(
  opts: McpClientOptions,
  sessionId?: string
): Promise<McpTool[]> {
  const { data } = await rpc(
    opts.url,
    "tools/list",
    {},
    buildHeaders(opts.headers, sessionId)
  );

  return (data.result?.tools ?? []) as McpTool[];
}

/**
 * Call a specific tool on an MCP server.
 */
export async function mcpCallTool(
  opts: McpClientOptions,
  toolName: string,
  args: Record<string, unknown>,
  sessionId?: string
): Promise<any> {
  const { data } = await rpc(
    opts.url,
    "tools/call",
    { name: toolName, arguments: args },
    buildHeaders(opts.headers, sessionId)
  );

  return data.result ?? data;
}

/**
 * Get tools for an MCP server, with in-memory caching.
 * Returns both tools and session ID for subsequent calls.
 */
export async function getToolsCached(
  opts: McpClientOptions
): Promise<{ tools: McpTool[]; sessionId?: string }> {
  const cached = toolsCache.get(opts.url);
  if (cached && cached.expiresAt > Date.now()) {
    return { tools: cached.tools, sessionId: cached.sessionId };
  }

  const { sessionId } = await mcpInitialize(opts);
  const tools = await mcpListTools(opts, sessionId);

  toolsCache.set(opts.url, {
    tools,
    sessionId,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });

  return { tools, sessionId };
}

/**
 * Clear the tools cache (useful for testing or forced refresh).
 */
export function clearToolsCache(url?: string): void {
  if (url) {
    toolsCache.delete(url);
  } else {
    toolsCache.clear();
  }
}
