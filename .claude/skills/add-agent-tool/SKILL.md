---
name: add-agent-tool
description: Use when adding a new built-in tool that AI agents can call (like `remember`, `notify_user`, `web_search`). Covers the tool factory shape, the AgentFactory wiring, and the tests expected for it.
---

# Adding a new AI agent tool

Tools live in `backend/tools/` and are bundled into agents by `backend/services/AgentFactory.ts`. Each tool uses the `ai` package's `tool()` helper and Zod for the input schema.

## 1. Decide scope

- **Built-in tool** (this skill): code lives in `backend/tools/`, opt-in per agent via the "built-in tools" mechanism.
- **MCP tool**: user plugs in an MCP server URL — no code changes needed.
- **URL tool**: user configures an HTTP endpoint from the UI — no code changes.

Only follow this skill if you are adding a new *built-in* tool.

## 2. Create the tool factory

File: `backend/tools/<name>Tool.ts` (or `<name>Tools.ts` if returning multiple tools from one factory).

Shape to follow — see `backend/tools/memoryTools.ts` and `backend/tools/notifyTool.ts` as canonical examples:

```ts
import { tool } from "ai";
import type { Tool as AiTool } from "ai";
import { z } from "zod";
import { getContext } from "./context";

const myToolParams = z.object({
  target: z.string().describe("Human-readable description shown to the model"),
});

export function createMyTools(
  // inject ONLY what this tool needs — not the whole dep bag
  someRepository: SomeRepository,
  userId: number,
  agentId: number,
  updateStatus: (msg: string) => void
): Record<string, AiTool> {
  const myTool = tool({
    description: "What this tool does, when the agent should reach for it.",
    inputSchema: myToolParams,
    execute: async (params, options) => {
      const ctx = getContext(options);        // access shared runtime context
      updateStatus("Doing the thing…");
      // …do work, return a string (usually JSON.stringify) back to the model
      return JSON.stringify({ ok: true });
    },
  });

  return { my_tool: myTool };
}
```

Guidelines:
- Every Zod field needs a `.describe(...)` — the model reads it.
- Return `JSON.stringify(...)` strings from `execute`. Errors should be returned as `{ error: "…" }` rather than thrown, so the model can react.
- Call `updateStatus()` at the start of each call so the UI shows a friendly progress message.
- Never accept secrets as tool params; pull them from closure / context.

## 3. Wire into `AgentFactory`

Open `backend/services/AgentFactory.ts`:

1. Import the factory (`import { createMyTools } from "../tools/myTool";`).
2. If the tool needs a new repository/service, add it to `AgentFactoryDependencies`.
3. In the agent-building code (where `memoryTools`, `skillTools`, etc. are merged), call `createMyTools(...)` and spread the result into the `ToolSet` when the agent has this tool enabled.
4. If the tool should be gated behind a flag on the agent row (like `internet_search_enabled`), add that column to `agents` (see `modify-database-schema`) and check it here.

Also update `index.ts` if the constructor call needs a new repo passed in.

## 4. Register as a selectable built-in tool

If users should be able to toggle this tool per agent via the Agents UI, add it to the list of built-in tool IDs surfaced by `backend/handlers/agent-tools.ts` and the `agent_built_in_tools` table semantics. Grep the codebase for an existing tool ID (e.g. `"memory"`, `"mqtt"`) to find all the places that list them.

## 5. Test

Add a case to `tests/tools.test.ts`:

```ts
test("createMyTools returns expected tool names", () => {
  const tools = createMyTools({} as any, 1, 1, noopStatus);
  const names = Object.keys(tools);
  expect(names).toContain("my_tool");
  expect(names.length).toBe(1);
});
```

And a `description` / `inputSchema` check alongside the other tools in the "Tools have descriptions and inputSchemas" block.

## 6. Document

- Add a bullet under "Built-in Tools" in `README.md`.
- If it needs user credentials (like a new API key), add them to the user credentials flow in `backend/handlers/user.ts` and the Profile page.

## 7. Verify

```bash
bun test tests/tools.test.ts
bun run typecheck
```
