import { tool } from "ai";
import type { Tool as AiTool } from "ai";
import { z } from "zod";
import { getContext } from "./context";

const loadSkillParams = z.object({
  skill_name: z.string().describe("The name/slug of the skill to load"),
});

const createSkillParams = z.object({
  name: z.string().describe("Skill slug (lowercase, hyphens, e.g., 'email-drafting')"),
  summary: z.string().describe("1-2 sentence description of WHEN to use this skill"),
  content: z.string().describe("Full Markdown instructions for the skill"),
});

const updateSkillParams = z.object({
  name: z.string().describe("The skill slug to update"),
  summary: z.string().describe("Updated summary (when to use this skill). Pass empty string to leave unchanged."),
  content: z.string().describe("Updated full Markdown instructions. Pass empty string to leave unchanged."),
});

const deleteSkillParams = z.object({
  name: z.string().describe("The skill slug to delete"),
});

const listSkillsParams = z.object({});

const load_skill = tool({
  description:
    "Load a skill's full instructions. Use when a task matches a skill in your Available Skills catalog.",
  inputSchema: loadSkillParams,
  execute: async (params, options) => {
    const { updateStatus, userId, agentId, skillRepository } = getContext(options);
    updateStatus(`Loading skill: ${params.skill_name}`);

    const skill =
      (await skillRepository.findByName(userId, agentId, params.skill_name)) ??
      (await skillRepository.findByName(userId, null, params.skill_name));

    if (!skill) {
      return JSON.stringify({ error: `Skill '${params.skill_name}' not found` });
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
    "Create a new skill from a pattern you've noticed. The skill will be saved and available in future conversations. Mention the skill creation in your response for transparency.",
  inputSchema: createSkillParams,
  execute: async (params, options) => {
    const { updateStatus, userId, agentId, skillRepository } = getContext(options);
    updateStatus(`Creating skill: ${params.name}`);

    const existing = await skillRepository.findByName(userId, agentId, params.name);
    if (existing) {
      return JSON.stringify({ error: `Skill '${params.name}' already exists. Use update_skill instead.` });
    }

    if (params.content.length > 51200) {
      return JSON.stringify({ error: "Skill content exceeds 50KB limit" });
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

    return JSON.stringify({ success: true, message: `Skill '${skill.name}' created` });
  },
});

const update_skill = tool({
  description: "Update an existing skill you created with improved instructions.",
  inputSchema: updateSkillParams,
  execute: async (params, options) => {
    const { updateStatus, userId, agentId, skillRepository } = getContext(options);
    updateStatus(`Updating skill: ${params.name}`);

    const skill = await skillRepository.findByName(userId, agentId, params.name);
    if (!skill) {
      return JSON.stringify({ error: `Skill '${params.name}' not found` });
    }

    if (skill.author !== "agent") {
      return JSON.stringify({ error: "Cannot update user-created skills" });
    }

    if (params.content && params.content.length > 51200) {
      return JSON.stringify({ error: "Skill content exceeds 50KB limit" });
    }

    const updateData: { summary?: string; content?: string } = {};
    if (params.summary.length > 0) updateData.summary = params.summary;
    if (params.content.length > 0) updateData.content = params.content;

    await skillRepository.update(skill.id, updateData);

    console.log(`Agent updated skill: ${skill.name} (agent_id=${agentId})`);

    return JSON.stringify({ success: true, message: `Skill '${params.name}' updated` });
  },
});

const delete_skill = tool({
  description: "Delete a skill you previously created.",
  inputSchema: deleteSkillParams,
  execute: async (params, options) => {
    const { userId, agentId, skillRepository } = getContext(options);

    const skill = await skillRepository.findByName(userId, agentId, params.name);
    if (!skill) {
      return JSON.stringify({ error: `Skill '${params.name}' not found` });
    }

    if (skill.author !== "agent") {
      return JSON.stringify({ error: "Cannot delete user-created skills" });
    }

    await skillRepository.delete(skill.id);

    console.log(`Agent deleted skill: ${skill.name} (agent_id=${agentId})`);

    return JSON.stringify({ success: true, message: `Skill '${params.name}' deleted` });
  },
});

const list_skills = tool({
  description:
    "List all skills available to you, including their summaries and metadata.",
  inputSchema: listSkillsParams,
  execute: async (_params, options) => {
    const { updateStatus, userId, agentId, skillRepository } = getContext(options);
    updateStatus("Loading skills catalog...");

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

/** Skill tools - always included for all agents */
export const skillTools: Record<string, AiTool> = {
  load_skill,
  create_skill,
  update_skill,
  delete_skill,
  list_skills,
};
