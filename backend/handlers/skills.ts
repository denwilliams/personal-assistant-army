import type { BunRequest } from "bun";
import type { AgentRepository } from "../repositories/AgentRepository";
import type { SkillRepository } from "../repositories/SkillRepository";
import type { User } from "../types/models";

interface SkillsHandlerDependencies {
  agentRepository: AgentRepository;
  skillRepository: SkillRepository;
  authenticate: (
    req: BunRequest
  ) => Promise<{ user: User; session: { id: string; userId: number } } | null>;
}

export function createSkillsHandlers(deps: SkillsHandlerDependencies) {
  const getAgentWithOwnership = async (userId: number, slug: string) => {
    const agent = await deps.agentRepository.findBySlug(userId, slug);
    if (!agent) return { error: "Agent not found", status: 404 };
    if (agent.user_id !== userId) return { error: "Forbidden", status: 403 };
    return { agent };
  };

  /**
   * GET /api/skills
   * List all user-level skills
   */
  const listUserSkills = async (req: BunRequest): Promise<Response> => {
    const auth = await deps.authenticate(req);
    if (!auth) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
      const skills = await deps.skillRepository.listByUser(auth.user.id);
      return Response.json({ skills });
    } catch (err) {
      console.error("Error listing user skills:", err);
      return Response.json({ error: "Failed to list skills" }, { status: 500 });
    }
  };

  /**
   * POST /api/skills
   * Create a user-level skill
   */
  const createUserSkill = async (req: BunRequest): Promise<Response> => {
    const auth = await deps.authenticate(req);
    if (!auth) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
      const body = await req.json();
      const { name, summary, content } = body;

      if (!name || !summary || !content) {
        return Response.json(
          { error: "name, summary, and content are required" },
          { status: 400 }
        );
      }

      if (content.length > 51200) {
        return Response.json(
          { error: "Skill content exceeds 50KB limit" },
          { status: 400 }
        );
      }

      const existing = await deps.skillRepository.findByName(
        auth.user.id,
        null,
        name
      );
      if (existing) {
        return Response.json(
          { error: `Skill '${name}' already exists` },
          { status: 409 }
        );
      }

      const skill = await deps.skillRepository.create({
        user_id: auth.user.id,
        agent_id: null,
        name,
        summary,
        content,
        scope: "user",
        author: "user",
      });

      return Response.json({ skill }, { status: 201 });
    } catch (err) {
      console.error("Error creating user skill:", err);
      return Response.json(
        { error: "Failed to create skill" },
        { status: 500 }
      );
    }
  };

  /**
   * PUT /api/skills/:id
   * Update a skill
   */
  const updateSkill = async (req: BunRequest): Promise<Response> => {
    const auth = await deps.authenticate(req);
    if (!auth) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
      const url = new URL(req.url);
      const pathParts = url.pathname.split("/");
      const skillId = parseInt(pathParts[pathParts.length - 1] ?? "");
      if (isNaN(skillId)) {
        return Response.json({ error: "Invalid skill ID" }, { status: 400 });
      }

      const skill = await deps.skillRepository.findById(skillId);
      if (!skill || skill.user_id !== auth.user.id) {
        return Response.json({ error: "Skill not found" }, { status: 404 });
      }

      const body = await req.json();
      const { summary, content } = body;

      if (content && content.length > 51200) {
        return Response.json(
          { error: "Skill content exceeds 50KB limit" },
          { status: 400 }
        );
      }

      const updated = await deps.skillRepository.update(skillId, {
        summary,
        content,
      });

      return Response.json({ skill: updated });
    } catch (err) {
      console.error("Error updating skill:", err);
      return Response.json(
        { error: "Failed to update skill" },
        { status: 500 }
      );
    }
  };

  /**
   * DELETE /api/skills/:id
   * Delete a skill
   */
  const deleteSkill = async (req: BunRequest): Promise<Response> => {
    const auth = await deps.authenticate(req);
    if (!auth) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
      const url = new URL(req.url);
      const pathParts = url.pathname.split("/");
      const skillId = parseInt(pathParts[pathParts.length - 1] ?? "");
      if (isNaN(skillId)) {
        return Response.json({ error: "Invalid skill ID" }, { status: 400 });
      }

      const skill = await deps.skillRepository.findById(skillId);
      if (!skill || skill.user_id !== auth.user.id) {
        return Response.json({ error: "Skill not found" }, { status: 404 });
      }

      await deps.skillRepository.delete(skillId);
      return Response.json({ success: true });
    } catch (err) {
      console.error("Error deleting skill:", err);
      return Response.json(
        { error: "Failed to delete skill" },
        { status: 500 }
      );
    }
  };

  /**
   * GET /api/agents/:slug/skills
   * List all skills for an agent (agent-scoped + user-level with enabled status)
   */
  const listAgentSkills = async (req: BunRequest): Promise<Response> => {
    const auth = await deps.authenticate(req);
    if (!auth) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
      const url = new URL(req.url);
      const pathParts = url.pathname.split("/");
      const slug = pathParts[pathParts.length - 2] ?? "";

      const result = await getAgentWithOwnership(auth.user.id, slug);
      if (result.error) {
        return Response.json(
          { error: result.error },
          { status: result.status }
        );
      }

      const skills = await deps.skillRepository.listForAgent(
        auth.user.id,
        result.agent!.id
      );
      return Response.json({ skills });
    } catch (err) {
      console.error("Error listing agent skills:", err);
      return Response.json(
        { error: "Failed to list skills" },
        { status: 500 }
      );
    }
  };

  /**
   * POST /api/agents/:slug/skills
   * Create an agent-scoped skill
   */
  const createAgentSkill = async (req: BunRequest): Promise<Response> => {
    const auth = await deps.authenticate(req);
    if (!auth) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
      const url = new URL(req.url);
      const pathParts = url.pathname.split("/");
      const slug = pathParts[pathParts.length - 2] ?? "";

      const result = await getAgentWithOwnership(auth.user.id, slug);
      if (result.error) {
        return Response.json(
          { error: result.error },
          { status: result.status }
        );
      }

      const body = await req.json();
      const { name, summary, content } = body;

      if (!name || !summary || !content) {
        return Response.json(
          { error: "name, summary, and content are required" },
          { status: 400 }
        );
      }

      if (content.length > 51200) {
        return Response.json(
          { error: "Skill content exceeds 50KB limit" },
          { status: 400 }
        );
      }

      const skill = await deps.skillRepository.create({
        user_id: auth.user.id,
        agent_id: result.agent!.id,
        name,
        summary,
        content,
        scope: "agent",
        author: "user",
      });

      return Response.json({ skill }, { status: 201 });
    } catch (err) {
      console.error("Error creating agent skill:", err);
      return Response.json(
        { error: "Failed to create skill" },
        { status: 500 }
      );
    }
  };

  /**
   * PATCH /api/agents/:slug/skills/:skillId/toggle
   * Enable/disable a user-level skill for this agent
   */
  const toggleAgentSkill = async (req: BunRequest): Promise<Response> => {
    const auth = await deps.authenticate(req);
    if (!auth) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
      const url = new URL(req.url);
      const pathParts = url.pathname.split("/");
      // /api/agents/:slug/skills/:skillId/toggle
      const slug = pathParts[pathParts.length - 4] ?? "";
      const skillId = parseInt(pathParts[pathParts.length - 2] ?? "");

      if (isNaN(skillId)) {
        return Response.json({ error: "Invalid skill ID" }, { status: 400 });
      }

      const result = await getAgentWithOwnership(auth.user.id, slug);
      if (result.error) {
        return Response.json(
          { error: result.error },
          { status: result.status }
        );
      }

      const skill = await deps.skillRepository.findById(skillId);
      if (!skill || skill.user_id !== auth.user.id) {
        return Response.json({ error: "Skill not found" }, { status: 404 });
      }

      const body = await req.json();
      const { enabled } = body;

      await deps.skillRepository.setAgentSkillEnabled(
        result.agent!.id,
        skillId,
        enabled
      );

      return Response.json({ success: true, enabled });
    } catch (err) {
      console.error("Error toggling agent skill:", err);
      return Response.json(
        { error: "Failed to toggle skill" },
        { status: 500 }
      );
    }
  };

  /**
   * PATCH /api/skills/:id/promote
   * Promote an agent-scoped skill to user-level
   */
  const promoteSkill = async (req: BunRequest): Promise<Response> => {
    const auth = await deps.authenticate(req);
    if (!auth) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
      const url = new URL(req.url);
      const pathParts = url.pathname.split("/");
      const skillId = parseInt(pathParts[pathParts.length - 2] ?? "");
      if (isNaN(skillId)) {
        return Response.json({ error: "Invalid skill ID" }, { status: 400 });
      }

      const skill = await deps.skillRepository.findById(skillId);
      if (!skill || skill.user_id !== auth.user.id) {
        return Response.json({ error: "Skill not found" }, { status: 404 });
      }

      if (skill.scope === "user") {
        return Response.json(
          { error: "Skill is already user-level" },
          { status: 400 }
        );
      }

      // Check for name collision at user level
      const existing = await deps.skillRepository.findByName(
        auth.user.id,
        null,
        skill.name
      );
      if (existing) {
        return Response.json(
          { error: `A user-level skill named '${skill.name}' already exists` },
          { status: 409 }
        );
      }

      // Create new user-level skill and delete the agent-scoped one
      const promoted = await deps.skillRepository.create({
        user_id: auth.user.id,
        agent_id: null,
        name: skill.name,
        summary: skill.summary,
        content: skill.content,
        scope: "user",
        author: skill.author,
      });

      await deps.skillRepository.delete(skillId);

      return Response.json({ skill: promoted });
    } catch (err) {
      console.error("Error promoting skill:", err);
      return Response.json(
        { error: "Failed to promote skill" },
        { status: 500 }
      );
    }
  };

  return {
    listUserSkills,
    createUserSkill,
    updateSkill,
    deleteSkill,
    listAgentSkills,
    createAgentSkill,
    toggleAgentSkill,
    promoteSkill,
  };
}
