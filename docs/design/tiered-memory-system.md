# Tiered Agent Memory System — Technical Design

## Overview

This document specifies the database schema, repository interfaces, tool APIs, system prompt injection, embedding infrastructure, REST endpoints, and frontend changes for the three-tier agent memory system.

**Source requirements**: `docs/requirements/tiered-memory-system.md`

---

## 1. Database Schema

### 1a. Enable pgvector

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

### 1b. Alter `agent_memories` table

Existing columns remain. New columns added via migration:

```sql
-- New columns
ALTER TABLE agent_memories ADD COLUMN IF NOT EXISTS tier VARCHAR(10) NOT NULL DEFAULT 'working';
ALTER TABLE agent_memories ADD COLUMN IF NOT EXISTS author VARCHAR(10) NOT NULL DEFAULT 'agent';
ALTER TABLE agent_memories ADD COLUMN IF NOT EXISTS access_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE agent_memories ADD COLUMN IF NOT EXISTS last_accessed_at BIGINT NOT NULL DEFAULT 0;
ALTER TABLE agent_memories ADD COLUMN IF NOT EXISTS embedding vector(1536);

-- Constraint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_memories_tier_check') THEN
    ALTER TABLE agent_memories ADD CONSTRAINT agent_memories_tier_check
      CHECK (tier IN ('core', 'working', 'reference'));
  END IF;
END $$;

-- Indexes for tier queries and vector search
CREATE INDEX IF NOT EXISTS idx_agent_memories_tier ON agent_memories(agent_id, tier);
CREATE INDEX IF NOT EXISTS idx_agent_memories_lru ON agent_memories(agent_id, tier, last_accessed_at ASC);
```

**pgvector index** (created after initial backfill; HNSW for fast cosine search):

```sql
CREATE INDEX IF NOT EXISTS idx_agent_memories_embedding
  ON agent_memories USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
```

### 1c. Migration for existing data

```sql
-- Backfill: all existing memories become 'working' tier, 'agent' author
UPDATE agent_memories SET
  tier = 'working',
  author = 'agent',
  access_count = 0,
  last_accessed_at = EXTRACT(EPOCH FROM updated_at)::BIGINT * 1000
WHERE tier IS NULL OR tier = '';
```

### Final table shape

| Column | Type | Default | Notes |
|--------|------|---------|-------|
| id | SERIAL PK | | |
| agent_id | INTEGER FK → agents(id) ON DELETE CASCADE | | |
| key | VARCHAR(255) | | |
| value | TEXT | | |
| tier | VARCHAR(10) | 'working' | 'core', 'working', 'reference' |
| author | VARCHAR(10) | 'agent' | 'user', 'agent' |
| access_count | INTEGER | 0 | Incremented on active use |
| last_accessed_at | BIGINT | 0 | Epoch ms, updated on any access |
| embedding | vector(1536) | NULL | OpenAI text-embedding-3-small |
| created_at | TIMESTAMP | CURRENT_TIMESTAMP | |
| updated_at | TIMESTAMP | CURRENT_TIMESTAMP | |

**Constraints**: UNIQUE(agent_id, key), CHECK(tier IN ('core', 'working', 'reference'))

---

## 2. TypeScript Model

### `backend/types/models.ts` — Updated `AgentMemory`

```typescript
export interface AgentMemory {
  id: number;
  agent_id: number;
  key: string;
  value: string;
  tier: 'core' | 'working' | 'reference';
  author: 'user' | 'agent';
  access_count: number;
  last_accessed_at: number; // epoch ms
  embedding?: number[] | null; // 1536-dim vector, omitted in most queries
  created_at: Date;
  updated_at: Date;
}
```

---

## 3. Repository Interface

### `backend/repositories/MemoryRepository.ts` — Redesigned

```typescript
import type { AgentMemory } from "../types/models";

export interface SetMemoryData {
  key: string;
  value: string;
  tier?: 'core' | 'working' | 'reference';
  author?: 'user' | 'agent';
}

export interface MemoryRepository {
  // Core CRUD
  set(agentId: number, data: SetMemoryData): Promise<AgentMemory>;
  get(agentId: number, key: string): Promise<AgentMemory | null>;
  delete(agentId: number, key: string): Promise<void>;

  // Tier-aware listing
  listByTier(agentId: number, tier: 'core' | 'working' | 'reference'): Promise<AgentMemory[]>;
  listByAgent(agentId: number): Promise<AgentMemory[]>; // all tiers
  countByTier(agentId: number, tier: 'core' | 'working' | 'reference'): Promise<number>;

  // Tier management
  changeTier(agentId: number, key: string, newTier: 'core' | 'working' | 'reference'): Promise<AgentMemory>;
  demoteLRU(agentId: number, fromTier: 'working', count?: number): Promise<AgentMemory[]>;

  // Access tracking
  bumpAccess(agentId: number, keys: string[]): Promise<void>; // last_accessed_at only
  bumpActiveAccess(agentId: number, keys: string[]): Promise<void>; // access_count + last_accessed_at

  // Search
  search(agentId: number, pattern: string): Promise<AgentMemory[]>; // text LIKE (legacy)
  semanticSearch(agentId: number, embedding: number[], limit?: number): Promise<AgentMemory[]>;

  // Embedding management
  setEmbedding(agentId: number, key: string, embedding: number[]): Promise<void>;
}
```

### Key implementation details for `PostgresMemoryRepository`

**`set()`**:
```sql
INSERT INTO agent_memories (agent_id, key, value, tier, author, access_count, last_accessed_at)
VALUES ($1, $2, $3, $4, $5, 1, $6)
ON CONFLICT (agent_id, key)
DO UPDATE SET value = $3, tier = COALESCE($4, agent_memories.tier),
             access_count = agent_memories.access_count + 1,
             last_accessed_at = $6, updated_at = CURRENT_TIMESTAMP
RETURNING *
```

**`demoteLRU()`** — finds the N oldest Working memories by `last_accessed_at` and sets `tier = 'reference'`:
```sql
UPDATE agent_memories SET tier = 'reference'
WHERE id IN (
  SELECT id FROM agent_memories
  WHERE agent_id = $1 AND tier = 'working'
  ORDER BY last_accessed_at ASC
  LIMIT $2
)
RETURNING *
```

**`semanticSearch()`**:
```sql
SELECT id, agent_id, key, value, tier, author, access_count, last_accessed_at, created_at, updated_at,
       1 - (embedding <=> $2::vector) AS similarity
FROM agent_memories
WHERE agent_id = $1 AND embedding IS NOT NULL
ORDER BY embedding <=> $2::vector ASC
LIMIT $3
```

**`bumpAccess()`** — updates `last_accessed_at` only (for passive prompt loading):
```sql
UPDATE agent_memories SET last_accessed_at = $3
WHERE agent_id = $1 AND key = ANY($2)
```

**`bumpActiveAccess()`** — updates both (for explicit recall/use):
```sql
UPDATE agent_memories SET access_count = access_count + 1, last_accessed_at = $3
WHERE agent_id = $1 AND key = ANY($2)
```

---

## 4. Embedding Service

### `backend/services/EmbeddingService.ts`

A lightweight service that wraps OpenAI's embedding API. It's not a singleton — instantiated per-request with the user's decrypted API key.

```typescript
export class EmbeddingService {
  private apiKey: string;
  private model = "text-embedding-3-small";

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async generate(text: string): Promise<number[]> {
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        input: text,
      }),
    });

    if (!response.ok) {
      throw new Error(`Embedding API error: ${response.status}`);
    }

    const data = await response.json();
    return data.data[0].embedding; // number[1536]
  }
}
```

### How it flows through the system

1. **Chat handler** decrypts user's OpenAI API key (already does this)
2. Creates `new EmbeddingService(decryptedKey)`
3. Passes a `generateEmbedding` function into `AgentFactory.createAgent()` via extended options
4. `AgentFactory` passes it to the memory tool factory
5. Memory tools call it fire-and-forget after saving the memory text

```typescript
// In chat handler, after decrypting API key:
const embeddingService = new EmbeddingService(openaiApiKey);
const generateEmbedding = (text: string) => embeddingService.generate(text);

// Passed through to AgentFactory:
const agent = await deps.agentFactory.createAgent(context, slug, {
  conversationId,
  generateEmbedding,
});
```

### `CreateAgentOptions` — extended

```typescript
export interface CreateAgentOptions {
  conversationId?: number;
  generateEmbedding?: (text: string) => Promise<number[]>;
}
```

---

## 5. Agent Tools

All tools live in `backend/tools/memoryTools.ts` (renamed from `memoryTool.ts`, plural). Returns an array of tools, like `skillTools.ts`.

### Tool: `remember`

```typescript
const rememberParams = z.object({
  key: z.string().describe("Short descriptive key (e.g., 'user_name', 'project_deadline')"),
  value: z.string().describe("The information to remember"),
  tier: z.enum(["core", "working"]).describe(
    "Memory tier. 'core' = permanent identity-level facts (max 10). 'working' = active context (max 30, auto-archives when full). Default: working."
  ),
});
```

**Execute logic**:
1. If `tier === "core"`: check `countByTier(agentId, 'core')`. If >= 10, return error: "Core is full (10/10). Demote a Core memory first."
2. If `tier === "working"`: check `countByTier(agentId, 'working')`. If >= 30, call `demoteLRU(agentId, 'working', 1)` silently.
3. Call `memoryRepository.set(agentId, { key, value, tier, author: 'agent' })`.
4. Fire-and-forget: `generateEmbedding(key + ": " + value).then(emb => memoryRepository.setEmbedding(agentId, key, emb)).catch(console.error)`.
5. Return `{ success: true, message: "Remembered: {key} (tier: {tier})" }`.

### Tool: `recall`

```typescript
const recallParams = z.object({
  query: z.string().describe("What to search for in your memory archive"),
  limit: z.number().describe("Max results to return. Default 5, max 10."),
});
```

**Execute logic**:
1. Generate embedding: `const emb = await generateEmbedding(query)`.
2. `const results = await memoryRepository.semanticSearch(agentId, emb, limit)`.
3. Bump active access: `memoryRepository.bumpActiveAccess(agentId, results.map(r => r.key))`.
4. Auto-promote: for any result with `tier === 'reference'`, call `memoryRepository.changeTier(agentId, r.key, 'working')`. If Working exceeds 30, `demoteLRU` runs.
5. Return results as JSON: `[{ key, value, tier, access_count, similarity }]`.

### Tool: `forget`

```typescript
const forgetParams = z.object({
  key: z.string().describe("The memory key to delete"),
});
```

**Execute logic**:
1. Fetch memory: `const mem = await memoryRepository.get(agentId, key)`.
2. If not found, return error.
3. If `mem.author !== 'agent'`, return error: "Cannot delete user-created memories."
4. `await memoryRepository.delete(agentId, key)`.
5. Return `{ success: true }`.

### Tool: `promote_memory`

```typescript
const promoteParams = z.object({
  key: z.string().describe("The memory key to promote"),
  tier: z.enum(["core", "working"]).describe("Target tier to promote to"),
});
```

**Execute logic**:
1. Fetch memory. Validate it exists and is in a lower tier than target.
2. If target is `core`: check count. If >= 10, return error.
3. If target is `working`: check count. If >= 30, `demoteLRU` first.
4. `memoryRepository.changeTier(agentId, key, tier)`.
5. `memoryRepository.bumpActiveAccess(agentId, [key])`.
6. Return `{ success: true, message: "Promoted '{key}' to {tier}" }`.

### Tool: `demote_memory`

```typescript
const demoteParams = z.object({
  key: z.string().describe("The memory key to demote"),
});
```

**Execute logic**:
1. Fetch memory.
2. If `tier === 'core'` → change to `'working'`.
3. If `tier === 'working'` → change to `'reference'`.
4. If `tier === 'reference'` → return error: "Already in Reference tier. Use forget to delete."
5. Return `{ success: true, message: "Demoted '{key}' to {newTier}" }`.

### Tool factory signature

```typescript
export function createMemoryTools<TContext extends ToolContext>(
  memoryRepository: MemoryRepository,
  agentId: number,
  generateEmbedding?: (text: string) => Promise<number[]>
): Tool<TContext>[]
```

Returns `[remember, recall, forget, promoteMemory, demoteMemory]`.

**Note on `recall` without embeddings**: If `generateEmbedding` is not provided (e.g., scheduler context where API key threading is complex), `recall` falls back to SQL LIKE search on `key` and `value` columns. The tool still works, just less intelligently.

---

## 6. System Prompt Injection

### In `AgentFactory.createAgentRecursive()`

Replace the current memory injection block with:

```typescript
if (builtInTools.includes("memory")) {
  const coreMemories = await this.deps.memoryRepository.listByTier(agentData.id, 'core');
  const workingMemories = await this.deps.memoryRepository.listByTier(agentData.id, 'working');
  const referenceCount = await this.deps.memoryRepository.countByTier(agentData.id, 'reference');

  // Passive access bump (last_accessed_at only, no access_count increment)
  const allLoadedKeys = [...coreMemories, ...workingMemories].map(m => m.key);
  if (allLoadedKeys.length > 0) {
    this.deps.memoryRepository.bumpAccess(agentData.id, allLoadedKeys); // fire-and-forget
  }

  if (coreMemories.length > 0) {
    instructionsWithContext += "\n\n# Core Knowledge\n";
    instructionsWithContext += "Fundamental, always-available memories (permanent):\n";
    for (const m of coreMemories) {
      instructionsWithContext += `- **${m.key}**: ${m.value}\n`;
    }
  }

  if (workingMemories.length > 0) {
    instructionsWithContext += "\n\n# Working Memory\n";
    instructionsWithContext += "Recently relevant context (auto-archived when unused):\n";
    for (const m of workingMemories) {
      instructionsWithContext += `- **${m.key}**: ${m.value}`;
      if (m.access_count > 0) {
        instructionsWithContext += ` (accessed ${m.access_count}x)`;
      }
      instructionsWithContext += "\n";
    }

    // Promotion hints for heavily-accessed Working memories
    const PROMOTION_THRESHOLD = 10;
    const candidates = workingMemories.filter(m => m.access_count >= PROMOTION_THRESHOLD);
    for (const c of candidates) {
      instructionsWithContext += `\n> "${c.key}" has been accessed ${c.access_count} times — consider promoting to Core with promote_memory.\n`;
    }
  }

  if (referenceCount > 0) {
    instructionsWithContext += `\nYou have ${referenceCount} archived memories searchable via the recall tool.\n`;
  }

  instructionsWithContext += "\nUse 'remember' to store facts/preferences. Use 'recall' to search your archive. Use 'create_skill' for reusable procedures.\n";
}
```

### Token budget estimate

| Section | Typical size | Tokens (~) |
|---------|-------------|-----------|
| Core (10 items) | ~500 chars | ~125 |
| Working (30 items) | ~1800 chars | ~450 |
| Hints + footer | ~200 chars | ~50 |
| **Total** | ~2500 chars | **~625 tokens** |

This is well within budget. The old system loaded ALL memories (~unlimited) which could grow unbounded.

---

## 7. REST API Endpoints

### Existing endpoints (updated)

**`GET /api/agents/:slug/memories`** — returns memories grouped by tier

Response:
```json
{
  "memories": [
    {
      "id": 1,
      "key": "user_name",
      "value": "Den",
      "tier": "core",
      "author": "agent",
      "access_count": 15,
      "last_accessed_at": 1740441591000,
      "created_at": "...",
      "updated_at": "..."
    }
  ],
  "counts": {
    "core": 3,
    "working": 12,
    "reference": 45
  }
}
```

**`DELETE /api/agents/:slug/memories/:key`** — unchanged, deletes any tier.

### New endpoints

**`PUT /api/agents/:slug/memories/:key`** — create or update a memory (from UI)

Request body:
```json
{
  "value": "Den",
  "tier": "core"
}
```

Generates embedding in background using the user's OpenAI API key.

**`PATCH /api/agents/:slug/memories/:key/tier`** — change memory tier (from UI)

Request body:
```json
{
  "tier": "core"
}
```

Enforces limits (Core ≤ 10, Working ≤ 30). Returns error if Core full.

### Route registration in `index.ts`

```typescript
routes["/api/agents/:slug/memories"] = {
  GET: memoryHandlers.getMemories,
  POST: memoryHandlers.createMemory,  // new
};
routes["/api/agents/:slug/memories/:key"] = {
  PUT: memoryHandlers.updateMemory,   // new
  DELETE: memoryHandlers.deleteMemory,
};
routes["/api/agents/:slug/memories/:key/tier"] = {
  PATCH: memoryHandlers.changeTier,   // new
};
```

---

## 8. SchedulerService Integration

The scheduler runs agents without a live HTTP request, so it doesn't have a decrypted API key readily available at tool creation time.

**Approach**: Decrypt the user's API key in `SchedulerService.executeSchedule()` (it already does this for `setDefaultOpenAIKey`) and pass `generateEmbedding` through to `AgentFactory.createAgent()`:

```typescript
// In SchedulerService.executeSchedule(), after decrypting API key:
const embeddingService = new EmbeddingService(openaiApiKey);
const agent = await this.deps.agentFactory.createAgent(context, agentSlug, {
  conversationId: schedule.conversation_id ?? undefined,
  generateEmbedding: (text) => embeddingService.generate(text),
});
```

---

## 9. Frontend Changes

### `frontend/src/lib/api.ts` — Updated types and methods

```typescript
export interface AgentMemory {
  id: number;
  agent_id: number;
  key: string;
  value: string;
  tier: 'core' | 'working' | 'reference';
  author: 'user' | 'agent';
  access_count: number;
  last_accessed_at: number;
  created_at: string;
  updated_at: string;
}

// New API methods
agents: {
  getMemories: (slug: string) =>
    apiRequest<{ memories: AgentMemory[]; counts: { core: number; working: number; reference: number } }>(
      `/api/agents/${slug}/memories`
    ),
  createMemory: (slug: string, data: { key: string; value: string; tier: string }) =>
    apiRequest(`/api/agents/${slug}/memories`, { method: "POST", body: data }),
  updateMemory: (slug: string, key: string, data: { value: string; tier?: string }) =>
    apiRequest(`/api/agents/${slug}/memories/${encodeURIComponent(key)}`, { method: "PUT", body: data }),
  deleteMemory: (slug: string, key: string) =>
    apiRequest(`/api/agents/${slug}/memories/${encodeURIComponent(key)}`, { method: "DELETE" }),
  changeMemoryTier: (slug: string, key: string, tier: string) =>
    apiRequest(`/api/agents/${slug}/memories/${encodeURIComponent(key)}/tier`, { method: "PATCH", body: { tier } }),
}
```

### Memory Management UI (on AgentsPage or dedicated section)

Three-column or tabbed layout:

```
┌─────────────────────────────────────────────────────┐
│ ⭐ Core (3/10)  │  📋 Working (12/30)  │  📚 Ref (45) │
├─────────────────┼──────────────────────┼──────────────┤
│ user_name: Den  │ current_project: ... │ [Search...] │
│ role: Calendar  │ meeting: 9am AEST   │ old_project  │
│ style: Concise  │ timezone: AEST      │ prev_pref    │
│                 │ ...                  │ ...          │
│ [+ Add Core]    │ [+ Add Working]     │              │
└─────────────────┴──────────────────────┴──────────────┘
```

Each memory card shows:
- Key and value
- Access count badge (if > 0)
- Author badge (user/agent)
- Tier change buttons (promote ↑ / demote ↓)
- Delete button (trash icon)

Reference column has a search input (client-side filter, not semantic).

---

## 10. File Change Summary

### New files
| File | Purpose |
|------|---------|
| `backend/services/EmbeddingService.ts` | OpenAI embedding generation wrapper |
| `backend/tools/memoryTools.ts` | All 5 memory tools (replaces `memoryTool.ts`) |

### Modified files
| File | Changes |
|------|---------|
| `backend/types/models.ts` | Update `AgentMemory` interface |
| `backend/repositories/MemoryRepository.ts` | Redesign interface with tier methods |
| `backend/repositories/postgres/PostgresMemoryRepository.ts` | Implement new interface |
| `backend/services/AgentFactory.ts` | New prompt injection, pass `generateEmbedding`, import new tools |
| `backend/handlers/agent-memories.ts` | Add create, update, changeTier handlers |
| `backend/handlers/chat.ts` | Create EmbeddingService, pass to factory |
| `backend/services/SchedulerService.ts` | Create EmbeddingService, pass to factory |
| `backend/tools/memoryTool.ts` | **Deleted** (replaced by `memoryTools.ts`) |
| `schema.sql` | Add pgvector, new columns, indexes, migration |
| `index.ts` | Register new memory routes |
| `frontend/src/lib/api.ts` | Update types and add new methods |
| `frontend/src/pages/AgentsPage.tsx` | Update memory management UI |

### Deleted files
| File | Reason |
|------|--------|
| `backend/tools/memoryTool.ts` | Replaced by `memoryTools.ts` |

---

## 11. Implementation Order

1. **Schema migration** — pgvector extension, new columns, indexes, constraint
2. **Model types** — Update `AgentMemory` in `models.ts`
3. **Repository** — Redesign interface + Postgres implementation
4. **EmbeddingService** — New service class
5. **Memory tools** — New `memoryTools.ts` with all 5 tools
6. **AgentFactory** — New prompt injection + tool wiring
7. **Chat handler + SchedulerService** — Thread `generateEmbedding` through
8. **REST handlers** — New endpoints for UI
9. **Route registration** — Wire up in `index.ts`
10. **Frontend API** — Updated types and methods
11. **Frontend UI** — Tier-grouped memory management
12. **Backfill embeddings** — Background script for existing memories
13. **Delete old** — Remove `memoryTool.ts`

---

## 12. Verification Checklist

- [ ] `CREATE EXTENSION vector` succeeds on Postgres (requires pgvector installed)
- [ ] Existing memories migrate to `tier = 'working'` with no data loss
- [ ] Agent `remember` tool creates Working memories by default
- [ ] Core limit enforced (reject at 10)
- [ ] Working auto-demotion triggers at 30 (LRU by `last_accessed_at`)
- [ ] `recall` returns semantically similar results
- [ ] `recall` auto-promotes Reference hits to Working
- [ ] Promotion hints appear in system prompt for access_count >= 10
- [ ] `forget` only deletes agent-authored memories
- [ ] UI shows memories grouped by tier with counts
- [ ] UI allows tier changes and respects limits
- [ ] Embeddings generated asynchronously (don't block tool response)
- [ ] Scheduler context generates embeddings correctly
- [ ] `bun run typecheck` passes
