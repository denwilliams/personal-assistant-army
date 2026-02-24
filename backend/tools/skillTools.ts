import { tool } from "@openai/agents";
import type { SkillRepository } from "../repositories/SkillRepository";
import { z } from "zod";
import type { ToolContext } from "./context";

export function createSkillTools<TContext extends ToolContext>(
  skillRepository: SkillRepository,
  userId: number,
  agentId: number
) {
  const loadSkill = tool<typeof loadSkillParams, TContext>({
    name: "load_skill",
    description:
      "Load a skill's full instructions. Use when a task matches a skill in your Available Skills catalog.",
    parameters: loadSkillParams,
    execute: async (params, context) => {
      context?.context.updateStatus(`Loading skill: ${params.skill_name}`);

      // Try agent-scoped first, then user-scoped
      const skill =
        (await skillRepository.findByName(userId, agentId, params.skill_name)) ??
        (await skillRepository.findByName(userId, null, params.skill_name));

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
  });

  const createSkill = tool<typeof createSkillParams, TContext>({
    name: "create_skill",
    description:
      "Create a new skill from a pattern you've noticed. The skill will be saved and available in future conversations. Mention the skill creation in your response for transparency.",
    parameters: createSkillParams,
    execute: async (params, context) => {
      context?.context.updateStatus(`Creating skill: ${params.name}`);

      // Check for duplicates
      const existing = await skillRepository.findByName(userId, agentId, params.name);
      if (existing) {
        return JSON.stringify({
          error: `Skill '${params.name}' already exists. Use update_skill instead.`,
        });
      }

      // Enforce 50KB limit
      if (params.content.length > 51200) {
        return JSON.stringify({
          error: "Skill content exceeds 50KB limit",
        });
      }

      const skill = await skillRepository.create({
        user_id: userId,
        agent_id: agentId,
        name: params.name,
        summary: params.summary,
        content: params.content,
        scope: "agent",
        author: "agent",
      });

      console.log(`Agent created skill: ${skill.name} (agent_id=${agentId})`);

      return JSON.stringify({
        success: true,
        message: `Skill '${skill.name}' created`,
      });
    },
  });

  const updateSkill = tool<typeof updateSkillParams, TContext>({
    name: "update_skill",
    description:
      "Update an existing skill you created with improved instructions.",
    parameters: updateSkillParams,
    execute: async (params, context) => {
      context?.context.updateStatus(`Updating skill: ${params.name}`);

      const skill = await skillRepository.findByName(userId, agentId, params.name);
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

      await skillRepository.update(skill.id, updateData);

      console.log(`Agent updated skill: ${skill.name} (agent_id=${agentId})`);

      return JSON.stringify({
        success: true,
        message: `Skill '${params.name}' updated`,
      });
    },
  });

  const deleteSkill = tool<typeof deleteSkillParams, TContext>({
    name: "delete_skill",
    description: "Delete a skill you previously created.",
    parameters: deleteSkillParams,
    execute: async (params, context) => {
      const skill = await skillRepository.findByName(userId, agentId, params.name);
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

      await skillRepository.delete(skill.id);

      console.log(`Agent deleted skill: ${skill.name} (agent_id=${agentId})`);

      return JSON.stringify({
        success: true,
        message: `Skill '${params.name}' deleted`,
      });
    },
  });

  const listSkills = tool<typeof listSkillsParams, TContext>({
    name: "list_skills",
    description:
      "List all skills available to you, including their summaries and metadata.",
    parameters: listSkillsParams,
    execute: async (_params, context) => {
      context?.context.updateStatus("Loading skills catalog...");

      const skills = await skillRepository.listForAgent(userId, agentId);

      return JSON.stringify(
        skills.map((s) => ({
          name: s.name,
          summary: s.summary,
          scope: s.scope,
          author: s.author,
        }))
      );
    },
  });

  return [loadSkill, createSkill, updateSkill, deleteSkill, listSkills];
}

const loadSkillParams = z.object({
  skill_name: z.string().describe("The name/slug of the skill to load"),
});

const createSkillParams = z.object({
  name: z
    .string()
    .describe(
      "Skill slug (lowercase, hyphens, e.g., 'email-drafting')"
    ),
  summary: z
    .string()
    .describe(
      "1-2 sentence description of WHEN to use this skill"
    ),
  content: z
    .string()
    .describe("Full Markdown instructions for the skill"),
});

const updateSkillParams = z.object({
  name: z.string().describe("The skill slug to update"),
  summary: z
    .string()
    .describe("Updated summary (when to use this skill). Pass empty string to leave unchanged."),
  content: z
    .string()
    .describe("Updated full Markdown instructions. Pass empty string to leave unchanged."),
});

const deleteSkillParams = z.object({
  name: z.string().describe("The skill slug to delete"),
});

const listSkillsParams = z.object({});
