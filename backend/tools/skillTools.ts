import { tool } from "ai";
import type { Tool as AiTool } from "ai";
import { z } from "zod";
import type { SkillRepository } from "../repositories/SkillRepository";
import type { ToolStatusUpdate } from "./context";

/**
 * Lightweight skill descriptor used for the in-prompt catalog.
 *
 * Matches the Vercel AI SDK "Agent Skills" pattern: only names and summaries
 * go into the agent's context window — the full SKILL.md body is loaded on
 * demand via the `load_skill` tool (progressive disclosure).
 *
 * @see https://ai-sdk.dev/cookbook/guides/agent-skills
 */
export interface SkillMetadata {
  id: number;
  name: string;
  summary: string;
  scope: "agent" | "user";
  author: "user" | "agent";
}

/**
 * Runtime context passed to skill tool invocations via the Vercel AI SDK's
 * `experimental_context` option on `streamText` / `generateText` / agents.
 *
 * The skills array is the pre-discovered catalog so `load_skill` can resolve
 * by name without re-querying the DB; the repository is still available for
 * fetching the full body and for mutation tools (create/update/delete).
 */
export interface SkillExecutionContext {
  skills: SkillMetadata[];
  skillRepository: SkillRepository;
  userId: number;
  agentId: number;
  updateStatus: ToolStatusUpdate;
}

function getSkillContext(experimental_context: unknown): SkillExecutionContext {
  if (!experimental_context || typeof experimental_context !== "object") {
    throw new Error(
      "Skill tools require experimental_context to be provided to the agent run"
    );
  }
  const ctx = experimental_context as Partial<SkillExecutionContext>;
  if (!ctx.skillRepository || ctx.userId == null || ctx.agentId == null) {
    throw new Error(
      "Skill tools require skillRepository, userId and agentId on experimental_context"
    );
  }
  return {
    skills: ctx.skills ?? [],
    skillRepository: ctx.skillRepository,
    userId: ctx.userId,
    agentId: ctx.agentId,
    updateStatus: ctx.updateStatus ?? (() => {}),
  };
}

const loadSkillParams = z.object({
  skill_name: z.string().describe("The name/slug of the skill to load"),
});

const createSkillParams = z.object({
  name: z
    .string()
    .describe("Skill slug (lowercase, hyphens, e.g., 'email-drafting')"),
  summary: z
    .string()
    .describe("1-2 sentence description of WHEN to use this skill"),
  content: z.string().describe("Full Markdown instructions for the skill"),
});

const updateSkillParams = z.object({
  name: z.string().describe("The skill slug to update"),
  summary: z
    .string()
    .describe(
      "Updated summary (when to use this skill). Pass empty string to leave unchanged."
    ),
  content: z
    .string()
    .describe(
      "Updated full Markdown instructions. Pass empty string to leave unchanged."
    ),
});

const deleteSkillParams = z.object({
  name: z.string().describe("The skill slug to delete"),
});

const listSkillsParams = z.object({});

/**
 * Stateless skill tools. All runtime state (repository, ids, status callback,
 * and the pre-discovered skills catalog) is delivered at call time via
 * `experimental_context`, matching Vercel's recommended Agent Skills pattern.
 */
export const skillTools: Record<string, AiTool> = {
  load_skill: tool({
    description:
      "Load a skill's full instructions. Use when a task matches a skill in your Available Skills catalog.",
    inputSchema: loadSkillParams,
    execute: async (params, { experimental_context }) => {
      const ctx = getSkillContext(experimental_context);
      ctx.updateStatus(`Loading skill: ${params.skill_name}`);

      // Resolve against the in-memory catalog first (progressive disclosure:
      // the agent only knows about skills it was told about in the prompt).
      const catalogEntry = ctx.skills.find(
        (s) => s.name.toLowerCase() === params.skill_name.toLowerCase()
      );

      // If the agent asked for a skill that is not in its catalog, fall back
      // to a repository lookup (e.g. freshly created during this run) but
      // scoped strictly to skills this agent is allowed to see.
      const skill =
        (catalogEntry
          ? await ctx.skillRepository.findById(catalogEntry.id)
          : null) ??
        (await ctx.skillRepository.findByName(
          ctx.userId,
          ctx.agentId,
          params.skill_name
        )) ??
        (await ctx.skillRepository.findByName(
          ctx.userId,
          null,
          params.skill_name
        ));

      if (!skill) {
        return JSON.stringify({
          error: `Skill '${params.skill_name}' not found`,
        });
      }

      return JSON.stringify({
        name: skill.name,
        summary: skill.summary,
        content: skill.content,
      });
    },
  }),

  create_skill: tool({
    description:
      "Create a new skill from a pattern you've noticed. The skill will be saved and available in future conversations. Mention the skill creation in your response for transparency.",
    inputSchema: createSkillParams,
    execute: async (params, { experimental_context }) => {
      const ctx = getSkillContext(experimental_context);
      ctx.updateStatus(`Creating skill: ${params.name}`);

      const existing = await ctx.skillRepository.findByName(
        ctx.userId,
        ctx.agentId,
        params.name
      );
      if (existing) {
        return JSON.stringify({
          error: `Skill '${params.name}' already exists. Use update_skill instead.`,
        });
      }

      if (params.content.length > 51200) {
        return JSON.stringify({
          error: "Skill content exceeds 50KB limit",
        });
      }

      const skill = await ctx.skillRepository.create({
        user_id: ctx.userId,
        agent_id: ctx.agentId,
        name: params.name,
        summary: params.summary,
        content: params.content,
        scope: "agent",
        author: "agent",
      });

      console.log(
        `Agent created skill: ${skill.name} (agent_id=${ctx.agentId})`
      );

      return JSON.stringify({
        success: true,
        message: `Skill '${skill.name}' created`,
      });
    },
  }),

  update_skill: tool({
    description:
      "Update an existing skill you created with improved instructions.",
    inputSchema: updateSkillParams,
    execute: async (params, { experimental_context }) => {
      const ctx = getSkillContext(experimental_context);
      ctx.updateStatus(`Updating skill: ${params.name}`);

      const skill = await ctx.skillRepository.findByName(
        ctx.userId,
        ctx.agentId,
        params.name
      );
      if (!skill) {
        return JSON.stringify({
          error: `Skill '${params.name}' not found`,
        });
      }

      if (skill.author !== "agent") {
        return JSON.stringify({
          error: "Cannot update user-created skills",
        });
      }

      if (params.content && params.content.length > 51200) {
        return JSON.stringify({
          error: "Skill content exceeds 50KB limit",
        });
      }

      const updateData: { summary?: string; content?: string } = {};
      if (params.summary.length > 0) updateData.summary = params.summary;
      if (params.content.length > 0) updateData.content = params.content;

      await ctx.skillRepository.update(skill.id, updateData);

      console.log(
        `Agent updated skill: ${skill.name} (agent_id=${ctx.agentId})`
      );

      return JSON.stringify({
        success: true,
        message: `Skill '${params.name}' updated`,
      });
    },
  }),

  delete_skill: tool({
    description: "Delete a skill you previously created.",
    inputSchema: deleteSkillParams,
    execute: async (params, { experimental_context }) => {
      const ctx = getSkillContext(experimental_context);

      const skill = await ctx.skillRepository.findByName(
        ctx.userId,
        ctx.agentId,
        params.name
      );
      if (!skill) {
        return JSON.stringify({
          error: `Skill '${params.name}' not found`,
        });
      }

      if (skill.author !== "agent") {
        return JSON.stringify({
          error: "Cannot delete user-created skills",
        });
      }

      await ctx.skillRepository.delete(skill.id);

      console.log(
        `Agent deleted skill: ${skill.name} (agent_id=${ctx.agentId})`
      );

      return JSON.stringify({
        success: true,
        message: `Skill '${params.name}' deleted`,
      });
    },
  }),

  list_skills: tool({
    description:
      "List all skills available to you, including their summaries and metadata.",
    inputSchema: listSkillsParams,
    execute: async (_params, { experimental_context }) => {
      const ctx = getSkillContext(experimental_context);
      ctx.updateStatus("Loading skills catalog...");

      // Prefer the pre-discovered catalog so the agent sees the same view
      // that was injected into its system prompt.
      const skills =
        ctx.skills.length > 0
          ? ctx.skills
          : await ctx.skillRepository.listForAgent(ctx.userId, ctx.agentId);

      return JSON.stringify(
        skills.map((s) => ({
          name: s.name,
          summary: s.summary,
          scope: s.scope,
          author: s.author,
        }))
      );
    },
  }),
};

/**
 * Build the "Available Skills" section that gets injected into the agent's
 * system prompt. Only names + summaries appear here — the full body is loaded
 * on demand via the `load_skill` tool.
 */
export function buildSkillsPrompt(skills: SkillMetadata[]): string {
  if (skills.length === 0) return "";

  let prompt = "\n\n# Available Skills\n";
  prompt +=
    "You have specialized skills you can load when needed. Only load a skill when a task matches its description.\n\n";
  for (const skill of skills.slice(0, 30)) {
    prompt += `- **${skill.name}**: ${skill.summary}\n`;
  }
  prompt +=
    "\nUse the load_skill tool to load a skill's full instructions when needed.\n";
  prompt +=
    "\n**Memory vs Skills**: Use 'remember' for facts and preferences. Use 'create_skill' for reusable procedures, workflows, or multi-step patterns.\n";
  return prompt;
}
