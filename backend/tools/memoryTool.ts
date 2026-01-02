import { tool } from "@openai/agents";
import type { MemoryRepository } from "../repositories/MemoryRepository";
import { z } from "zod";

export function createMemoryTool<TContext>(memoryRepository: MemoryRepository, agentId: number) {
  return tool({
    name: "remember",
    description: "Store important information permanently for future conversations. Use this to remember facts, preferences, or context about the user. All stored memories are automatically available in your instructions.",
    parameters: z.object({
      key: z.string().describe("A short, descriptive key for this memory (e.g., 'user_name', 'favorite_color', 'project_deadline')"),
      value: z.string().describe("The information to remember"),
    }),
    execute: async (params, context) => {
      if (!params.key || !params.value) {
        return JSON.stringify({
          error: "Both 'key' and 'value' are required"
        });
      }

      const memory = await memoryRepository.set(agentId, params.key, params.value);

      console.log(`Stored memory for agent ${agentId}: ${params.key} = ${params.value} ${memory.updated_at}`);

      return JSON.stringify({
        success: true,
        message: `Remembered: ${params.key}`,
      });
    },
  });
}
