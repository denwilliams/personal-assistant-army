import { tool, type Tool } from "@openai/agents";
import type { MemoryRepository } from "../repositories/MemoryRepository";
import { z } from "zod";
import type { ToolContext } from "./context";

const CORE_LIMIT = 10;
const WORKING_LIMIT = 30;

export function createMemoryTools<TContext extends ToolContext>(
  memoryRepository: MemoryRepository,
  agentId: number,
  generateEmbedding?: (text: string) => Promise<number[]>
): Tool<TContext>[] {
  // ---------- remember ----------
  const rememberParams = z.object({
    key: z.string().describe("Short descriptive key (e.g., 'user_name', 'project_deadline')"),
    value: z.string().describe("The information to remember"),
    tier: z.enum(["core", "working"]).describe(
      "Memory tier. 'core' = permanent identity-level facts (max 10). 'working' = active context (max 30, auto-archives when full). Default: working."
    ),
  });

  const remember = tool<typeof rememberParams, TContext>({
    name: "remember",
    description:
      "Store important information for future conversations. Core memories are permanent identity-level facts. Working memories are active context that auto-archives when unused. Use 'recall' to search archived memories.",
    parameters: rememberParams,
    execute: async (params, context) => {
      context?.context.updateStatus("Storing memory...");
      const tier = params.tier || "working";

      try {
        // Enforce Core limit
        if (tier === "core") {
          const coreCount = await memoryRepository.countByTier(agentId, "core");
          // Allow update to existing core memory
          const existing = await memoryRepository.get(agentId, params.key);
          if (!existing || existing.tier !== "core") {
            if (coreCount >= CORE_LIMIT) {
              return JSON.stringify({
                error: `Core memory is full (${coreCount}/${CORE_LIMIT}). Demote a Core memory first using demote_memory.`,
              });
            }
          }
        }

        // Auto-demote LRU Working if at limit
        if (tier === "working") {
          const existing = await memoryRepository.get(agentId, params.key);
          if (!existing || existing.tier !== "working") {
            const workingCount = await memoryRepository.countByTier(agentId, "working");
            if (workingCount >= WORKING_LIMIT) {
              await memoryRepository.demoteLRU(agentId, "working", 1);
            }
          }
        }

        const memory = await memoryRepository.set(agentId, {
          key: params.key,
          value: params.value,
          tier,
          author: "agent",
        });

        // Fire-and-forget embedding generation
        if (generateEmbedding) {
          generateEmbedding(`${params.key}: ${params.value}`)
            .then((emb) => memoryRepository.setEmbedding(agentId, params.key, emb))
            .catch((err) => console.error("Embedding generation failed:", err));
        }

        context?.context.updateStatus(`Remembered ${params.key}`);
        return JSON.stringify({
          success: true,
          message: `Remembered: ${params.key} (tier: ${memory.tier})`,
        });
      } catch (error) {
        console.error("Error storing memory:", error);
        return JSON.stringify({ error: "Failed to store memory" });
      }
    },
  });

  // ---------- recall ----------
  const recallParams = z.object({
    query: z.string().describe("What to search for in your memory archive"),
    limit: z.number().describe("Max results to return (1-10). Default 5."),
  });

  const recall = tool<typeof recallParams, TContext>({
    name: "recall",
    description:
      "Search your memory archive using semantic similarity. Returns matching memories from all tiers. Referenced archived memories are automatically promoted to Working memory.",
    parameters: recallParams,
    execute: async (params, context) => {
      context?.context.updateStatus("Searching memories...");
      const limit = Math.min(Math.max(params.limit || 5, 1), 10);

      try {
        let results: Array<{ key: string; value: string; tier: string; access_count: number; similarity?: number }>;

        if (generateEmbedding) {
          const emb = await generateEmbedding(params.query);
          results = await memoryRepository.semanticSearch(agentId, emb, limit);
        } else {
          // Fallback to text search
          results = (await memoryRepository.search(agentId, params.query)).slice(0, limit);
        }

        if (results.length === 0) {
          return JSON.stringify({ results: [], message: "No matching memories found." });
        }

        // Bump active access for all results
        const keys = results.map((r) => r.key);
        await memoryRepository.bumpActiveAccess(agentId, keys);

        // Auto-promote Reference memories to Working
        for (const r of results) {
          if (r.tier === "reference") {
            const workingCount = await memoryRepository.countByTier(agentId, "working");
            if (workingCount >= WORKING_LIMIT) {
              await memoryRepository.demoteLRU(agentId, "working", 1);
            }
            await memoryRepository.changeTier(agentId, r.key, "working");
          }
        }

        context?.context.updateStatus(`Found ${results.length} memories`);
        return JSON.stringify({
          results: results.map((r) => ({
            key: r.key,
            value: r.value,
            tier: r.tier,
            access_count: r.access_count,
            similarity: (r as any).similarity ?? null,
          })),
        });
      } catch (error) {
        console.error("Error searching memories:", error);
        return JSON.stringify({ error: "Failed to search memories" });
      }
    },
  });

  // ---------- forget ----------
  const forgetParams = z.object({
    key: z.string().describe("The memory key to delete"),
  });

  const forget = tool<typeof forgetParams, TContext>({
    name: "forget",
    description: "Delete a memory you previously created. Cannot delete user-created memories.",
    parameters: forgetParams,
    execute: async (params, context) => {
      context?.context.updateStatus("Deleting memory...");

      try {
        const mem = await memoryRepository.get(agentId, params.key);
        if (!mem) {
          return JSON.stringify({ error: `Memory not found: ${params.key}` });
        }
        if (mem.author !== "agent") {
          return JSON.stringify({ error: "Cannot delete user-created memories." });
        }

        await memoryRepository.delete(agentId, params.key);
        return JSON.stringify({ success: true, message: `Forgot: ${params.key}` });
      } catch (error) {
        console.error("Error deleting memory:", error);
        return JSON.stringify({ error: "Failed to delete memory" });
      }
    },
  });

  // ---------- promote_memory ----------
  const promoteParams = z.object({
    key: z.string().describe("The memory key to promote"),
    tier: z.enum(["core", "working"]).describe("Target tier to promote to"),
  });

  const promoteMemory = tool<typeof promoteParams, TContext>({
    name: "promote_memory",
    description:
      "Move a memory to a higher tier. Promote from Reference to Working, or from Working to Core. Core memories are permanent and always available.",
    parameters: promoteParams,
    execute: async (params, context) => {
      context?.context.updateStatus("Promoting memory...");

      try {
        const mem = await memoryRepository.get(agentId, params.key);
        if (!mem) {
          return JSON.stringify({ error: `Memory not found: ${params.key}` });
        }

        // Validate promotion direction
        const tierRank = { reference: 0, working: 1, core: 2 };
        if (tierRank[params.tier] <= tierRank[mem.tier]) {
          return JSON.stringify({
            error: `'${params.key}' is already in ${mem.tier} tier (same or higher than ${params.tier}).`,
          });
        }

        // Enforce limits
        if (params.tier === "core") {
          const coreCount = await memoryRepository.countByTier(agentId, "core");
          if (coreCount >= CORE_LIMIT) {
            return JSON.stringify({
              error: `Core is full (${coreCount}/${CORE_LIMIT}). Demote a Core memory first.`,
            });
          }
        }

        if (params.tier === "working") {
          const workingCount = await memoryRepository.countByTier(agentId, "working");
          if (workingCount >= WORKING_LIMIT) {
            await memoryRepository.demoteLRU(agentId, "working", 1);
          }
        }

        await memoryRepository.changeTier(agentId, params.key, params.tier);
        await memoryRepository.bumpActiveAccess(agentId, [params.key]);

        return JSON.stringify({
          success: true,
          message: `Promoted '${params.key}' to ${params.tier}`,
        });
      } catch (error) {
        console.error("Error promoting memory:", error);
        return JSON.stringify({ error: "Failed to promote memory" });
      }
    },
  });

  // ---------- demote_memory ----------
  const demoteParams = z.object({
    key: z.string().describe("The memory key to demote one tier down"),
  });

  const demoteMemory = tool<typeof demoteParams, TContext>({
    name: "demote_memory",
    description:
      "Move a memory down one tier: Core → Working, Working → Reference. Use this to free up space in Core or Working.",
    parameters: demoteParams,
    execute: async (params, context) => {
      context?.context.updateStatus("Demoting memory...");

      try {
        const mem = await memoryRepository.get(agentId, params.key);
        if (!mem) {
          return JSON.stringify({ error: `Memory not found: ${params.key}` });
        }

        let newTier: 'core' | 'working' | 'reference';
        if (mem.tier === "core") {
          newTier = "working";
        } else if (mem.tier === "working") {
          newTier = "reference";
        } else {
          return JSON.stringify({
            error: "Already in Reference tier. Use 'forget' to delete.",
          });
        }

        await memoryRepository.changeTier(agentId, params.key, newTier);
        return JSON.stringify({
          success: true,
          message: `Demoted '${params.key}' from ${mem.tier} to ${newTier}`,
        });
      } catch (error) {
        console.error("Error demoting memory:", error);
        return JSON.stringify({ error: "Failed to demote memory" });
      }
    },
  });

  return [remember, recall, forget, promoteMemory, demoteMemory];
}
