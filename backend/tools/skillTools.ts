import { tool } from "ai";
import type { Tool as AiTool } from "ai";
import type { SkillRepository } from "../repositories/SkillRepository";
import { z } from "zod";
import type { ToolStatusUpdate } from "./context";
import { BUILT_IN_SKILLS, findBuiltInSkill, isBuiltInSkillName } from "../services/builtInSkills";

export function createSkillTools(
  skillRepository: SkillRepository,
  userId: number,
  agentId: number,
  updateStatus: ToolStatusUpdate
): Record<string, AiTool> {
  const load_skill = tool({
    description:
      "Load a skill's full instructions. Use when a task matches a skill in your Available Skills catalog. Built-in meta-skills like 'skill-creator' and 'workflow-creator' are always loadable.",
    inputSchema: loadSkillParams,
    execute: async (params) => {
      updateStatus(`Loading skill: ${params.skill_name}`);

      const builtIn = findBuiltInSkill(params.skill_name);
      if (builtIn) {
        return JSON.stringify({
          name: builtIn.name,
          summary: builtIn.summary,
          content: builtIn.content,
          built_in: true,
        });
      }

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

  const create_skill = tool({
    description:
      "Create a new skill from a pattern you've noticed. Load the 'skill-creator' skill first if you need guidance on structure. The skill will be saved and available in future conversations. Mention the skill creation in your response for transparency.",
    inputSchema: createSkillParams,
    execute: async (params) => {
      updateStatus(`Creating skill: ${params.name}`);

      if (isBuiltInSkillName(params.name)) {
        return JSON.stringify({
          error: `'${params.name}' is a built-in skill and cannot be overridden.`,
        });
      }

      const existing = await skillRepository.findByName(userId, agentId, params.name);
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

  const update_skill = tool({
    description:
      "Update an existing skill you created with improved instructions.",
    inputSchema: updateSkillParams,
    execute: async (params) => {
      updateStatus(`Updating skill: ${params.name}`);

      if (isBuiltInSkillName(params.name)) {
        return JSON.stringify({
          error: `'${params.name}' is a built-in skill and cannot be updated.`,
        });
      }

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

  const delete_skill = tool({
    description: "Delete a skill you previously created.",
    inputSchema: deleteSkillParams,
    execute: async (params) => {
      if (isBuiltInSkillName(params.name)) {
        return JSON.stringify({
          error: `'${params.name}' is a built-in skill and cannot be deleted.`,
        });
      }

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

  const list_skills = tool({
    description:
      "List all skills available to you, including their summaries and metadata. Includes built-in meta-skills like 'skill-creator'.",
    inputSchema: listSkillsParams,
    execute: async () => {
      updateStatus("Loading skills catalog...");

      const skills = await skillRepository.listForAgent(userId, agentId);

      const builtIns = BUILT_IN_SKILLS.map((s) => ({
        name: s.name,
        summary: s.summary,
        scope: "built-in" as const,
        author: "system" as const,
      }));

      const custom = skills.map((s) => ({
        name: s.name,
        summary: s.summary,
        scope: s.scope,
        author: s.author,
      }));

      return JSON.stringify([...builtIns, ...custom]);
    },
  });

  return { load_skill, create_skill, update_skill, delete_skill, list_skills };
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
