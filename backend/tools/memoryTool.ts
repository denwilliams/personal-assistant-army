import { tool } from "@openai/agents";
import type { MemoryRepository } from "../repositories/MemoryRepository";
import { z } from "zod";
const parameters = z.object({
  key: z
    .string()
    .describe(
      "A short, descriptive key for this memory (e.g., 'user_name', 'favorite_color', 'project_deadline')"
    ),
  value: z.string().describe("The information to remember"),
});

import type { ToolContext } from "./context";

export function createMemoryTool<TContext extends ToolContext>(
  memoryRepository: MemoryRepository,
  agentId: number
) {
  return tool<typeof parameters, TContext>({
    name: "remember",
    description:
      "Store important information permanently for future conversations. Use this to remember facts, preferences, or context about the user. All stored memories are automatically available in your instructions.",
    parameters,
    execute: async (params, context) => {
      context?.context.updateStatus("Storing memory...");

      if (!params.key || !params.value) {
        return JSON.stringify({
          error: "Both 'key' and 'value' are required",
        });
      }

      try {
        const memory = await memoryRepository.set(
          agentId,
          params.key,
          params.value
        );

        console.log(
          `Stored memory for agent ${agentId}: ${params.key} = ${params.value} ${memory.updated_at}`
        );

        context?.context.updateStatus(`Remembered ${params.key}`);

        return JSON.stringify({
          success: true,
          message: `Remembered: ${params.key}`,
        });
      } catch (error) {
        console.error("Error storing memory:", error);
        return JSON.stringify({
          error: "Failed to store memory",
        });
      }
    },
  });
}
