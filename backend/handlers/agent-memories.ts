import type { BunRequest } from "bun";
import type { AgentRepository } from "../repositories/AgentRepository";
import type { MemoryRepository } from "../repositories/MemoryRepository";
import type { UserRepository } from "../repositories/UserRepository";
import type { User } from "../types/models";
import { EmbeddingService } from "../services/EmbeddingService";
import { decrypt } from "../utils/encryption";

interface AgentMemoriesHandlerDependencies {
  agentRepository: AgentRepository;
  memoryRepository: MemoryRepository;
  userRepository: UserRepository;
  authenticate: (req: BunRequest) => Promise<{ user: User; session: { id: string; userId: number } } | null>;
  encryptionSecret: string;
}

/**
 * Factory function to create agent memories management handlers
 */
export function createAgentMemoriesHandlers(deps: AgentMemoriesHandlerDependencies) {
  const getAgentWithOwnership = async (userId: number, slug: string) => {
    const agent = await deps.agentRepository.findBySlug(userId, slug);
    if (!agent) return { error: "Agent not found", status: 404 };
    if (agent.user_id !== userId) return { error: "Forbidden", status: 403 };
    return { agent };
  };

  const getEmbeddingService = async (user: User): Promise<EmbeddingService | null> => {
    if (!user.openai_api_key) return null;
    try {
      const apiKey = await decrypt(user.openai_api_key, deps.encryptionSecret);
      return new EmbeddingService(apiKey);
    } catch {
      return null;
    }
  };

  /**
   * GET /api/agents/:slug/memories
   */
  const getMemories = async (req: BunRequest): Promise<Response> => {
    const auth = await deps.authenticate(req);
    if (!auth) return Response.json({ error: "Unauthorized" }, { status: 401 });

    try {
      const url = new URL(req.url);
      const pathParts = url.pathname.split("/");
      const slug = pathParts[pathParts.length - 2] ?? "";

      const result = await getAgentWithOwnership(auth.user.id, slug);
      if (result.error) return Response.json({ error: result.error }, { status: result.status });

      const memories = await deps.memoryRepository.listByAgent(result.agent!.id);
      const coreCount = await deps.memoryRepository.countByTier(result.agent!.id, "core");
      const workingCount = await deps.memoryRepository.countByTier(result.agent!.id, "working");
      const referenceCount = await deps.memoryRepository.countByTier(result.agent!.id, "reference");

      return Response.json({
        memories,
        counts: { core: coreCount, working: workingCount, reference: referenceCount },
      });
    } catch (err) {
      console.error("Error getting agent memories:", err);
      return Response.json({ error: "Failed to get memories" }, { status: 500 });
    }
  };

  /**
   * POST /api/agents/:slug/memories
   */
  const createMemory = async (req: BunRequest): Promise<Response> => {
    const auth = await deps.authenticate(req);
    if (!auth) return Response.json({ error: "Unauthorized" }, { status: 401 });

    try {
      const url = new URL(req.url);
      const pathParts = url.pathname.split("/");
      const slug = pathParts[pathParts.length - 2] ?? "";

      const result = await getAgentWithOwnership(auth.user.id, slug);
      if (result.error) return Response.json({ error: result.error }, { status: result.status });

      const body = await req.json();
      const { key, value, tier } = body;
      if (!key || !value) return Response.json({ error: "key and value are required" }, { status: 400 });

      const targetTier = tier || "working";

      // Enforce limits
      if (targetTier === "core") {
        const count = await deps.memoryRepository.countByTier(result.agent!.id, "core");
        if (count >= 10) return Response.json({ error: "Core memory limit reached (10)" }, { status: 400 });
      }
      if (targetTier === "working") {
        const count = await deps.memoryRepository.countByTier(result.agent!.id, "working");
        if (count >= 30) {
          await deps.memoryRepository.demoteLRU(result.agent!.id, "working", 1);
        }
      }

      const memory = await deps.memoryRepository.set(result.agent!.id, {
        key,
        value,
        tier: targetTier,
        author: "user",
      });

      // Generate embedding in background
      const embeddingService = await getEmbeddingService(auth.user);
      if (embeddingService) {
        embeddingService.generate(`${key}: ${value}`)
          .then((emb) => deps.memoryRepository.setEmbedding(result.agent!.id, key, emb))
          .catch((err) => console.error("Embedding generation failed:", err));
      }

      return Response.json({ memory }, { status: 201 });
    } catch (err) {
      console.error("Error creating memory:", err);
      return Response.json({ error: "Failed to create memory" }, { status: 500 });
    }
  };

  /**
   * PUT /api/agents/:slug/memories/:key
   */
  const updateMemory = async (req: BunRequest): Promise<Response> => {
    const auth = await deps.authenticate(req);
    if (!auth) return Response.json({ error: "Unauthorized" }, { status: 401 });

    try {
      const url = new URL(req.url);
      const pathParts = url.pathname.split("/");
      const slug = pathParts[pathParts.length - 3] ?? "";
      const memoryKey = decodeURIComponent(pathParts[pathParts.length - 1] ?? "");

      const result = await getAgentWithOwnership(auth.user.id, slug);
      if (result.error) return Response.json({ error: result.error }, { status: result.status });

      const existing = await deps.memoryRepository.get(result.agent!.id, memoryKey);
      if (!existing) return Response.json({ error: "Memory not found" }, { status: 404 });

      const body = await req.json();
      const { value, tier } = body;

      const memory = await deps.memoryRepository.set(result.agent!.id, {
        key: memoryKey,
        value: value ?? existing.value,
        tier: tier ?? existing.tier,
        author: existing.author,
      });

      // Re-generate embedding if value changed
      if (value && value !== existing.value) {
        const embeddingService = await getEmbeddingService(auth.user);
        if (embeddingService) {
          embeddingService.generate(`${memoryKey}: ${value}`)
            .then((emb) => deps.memoryRepository.setEmbedding(result.agent!.id, memoryKey, emb))
            .catch((err) => console.error("Embedding generation failed:", err));
        }
      }

      return Response.json({ memory });
    } catch (err) {
      console.error("Error updating memory:", err);
      return Response.json({ error: "Failed to update memory" }, { status: 500 });
    }
  };

  /**
   * PATCH /api/agents/:slug/memories/:key/tier
   */
  const changeTier = async (req: BunRequest): Promise<Response> => {
    const auth = await deps.authenticate(req);
    if (!auth) return Response.json({ error: "Unauthorized" }, { status: 401 });

    try {
      const url = new URL(req.url);
      const pathParts = url.pathname.split("/");
      // /api/agents/:slug/memories/:key/tier
      const slug = pathParts[pathParts.length - 4] ?? "";
      const memoryKey = decodeURIComponent(pathParts[pathParts.length - 2] ?? "");

      const result = await getAgentWithOwnership(auth.user.id, slug);
      if (result.error) return Response.json({ error: result.error }, { status: result.status });

      const body = await req.json();
      const { tier } = body;
      if (!["core", "working", "reference"].includes(tier)) {
        return Response.json({ error: "Invalid tier" }, { status: 400 });
      }

      // Enforce Core limit
      if (tier === "core") {
        const count = await deps.memoryRepository.countByTier(result.agent!.id, "core");
        if (count >= 10) return Response.json({ error: "Core memory limit reached (10)" }, { status: 400 });
      }
      if (tier === "working") {
        const count = await deps.memoryRepository.countByTier(result.agent!.id, "working");
        if (count >= 30) {
          await deps.memoryRepository.demoteLRU(result.agent!.id, "working", 1);
        }
      }

      const memory = await deps.memoryRepository.changeTier(result.agent!.id, memoryKey, tier);
      return Response.json({ memory });
    } catch (err) {
      console.error("Error changing tier:", err);
      return Response.json({ error: "Failed to change tier" }, { status: 500 });
    }
  };

  /**
   * DELETE /api/agents/:slug/memories/:key
   */
  const deleteMemory = async (req: BunRequest): Promise<Response> => {
    const auth = await deps.authenticate(req);
    if (!auth) return Response.json({ error: "Unauthorized" }, { status: 401 });

    try {
      const url = new URL(req.url);
      const pathParts = url.pathname.split("/");
      const slug = pathParts[pathParts.length - 3] ?? "";
      const memoryKey = decodeURIComponent(pathParts[pathParts.length - 1] ?? "");

      if (!memoryKey) return Response.json({ error: "Invalid memory key" }, { status: 400 });

      const result = await getAgentWithOwnership(auth.user.id, slug);
      if (result.error) return Response.json({ error: result.error }, { status: result.status });

      const memory = await deps.memoryRepository.get(result.agent!.id, memoryKey);
      if (!memory) return Response.json({ error: "Memory not found" }, { status: 404 });

      await deps.memoryRepository.delete(result.agent!.id, memoryKey);
      return Response.json({ success: true });
    } catch (err) {
      console.error("Error deleting memory:", err);
      return Response.json({ error: "Failed to delete memory" }, { status: 500 });
    }
  };

  return {
    getMemories,
    createMemory,
    updateMemory,
    changeTier,
    deleteMemory,
  };
}
