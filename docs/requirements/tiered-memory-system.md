# Tiered Agent Memory System — Requirements Specification

## Goal

Replace the flat key-value memory system with a three-tier memory architecture that gives agents organized, scalable knowledge with natural promotion/demotion, semantic search, and self-improvement through usage patterns.

## Problem Statement

Current memory system limitations:
- **Context bloat**: Every memory is loaded into the system prompt every turn — degrades at scale
- **No organization**: All memories are equal — no way to distinguish critical identity facts from ephemeral preferences
- **No self-improvement**: Agents can't learn from patterns, develop new behaviors, or prioritize knowledge
- **Write-only**: Agent has a `remember` tool but no `recall` — can't search or retrieve specific memories

## Memory Tiers

### Core (Tier 1) — Always loaded
- **Limit**: 10 per agent
- **Loaded**: Every conversation turn, injected into system prompt
- **Purpose**: Identity-defining facts, critical preferences, key relationships
- **Lifecycle**: Agent can promote from Working. Human can manage via UI. Never auto-demoted.
- **Examples**: "User's name is Den", "User prefers concise responses", "I am a calendar assistant"

### Working (Tier 2) — Always loaded, subject to demotion
- **Limit**: 30 per agent
- **Loaded**: Every conversation turn, injected into system prompt (after Core)
- **Purpose**: Recently relevant facts, active context, current preferences
- **Lifecycle**: New memories land here. Auto-demoted to Reference when Working exceeds 30 (LRU by access count/recency). Agent can explicitly promote to Core or demote to Reference.
- **Examples**: "User is working on Project X", "Last meeting was about budget", "User's timezone is AEST"

### Reference (Tier 3) — Searchable archive
- **Limit**: Unlimited
- **Loaded**: Never auto-loaded. Retrieved on-demand via semantic search (`recall` tool)
- **Purpose**: Historical context, archived facts, things that were once relevant
- **Lifecycle**: Receives demoted Working memories. Agent can bump back to Working by accessing them. Can be deleted by agent or human.
- **Examples**: Old project details, past preferences that changed, historical decisions

### Skills (existing, unchanged)
- Summary always in prompt (up to 30), content lazy-loaded via `load_skill`
- Agent can create/update/delete its own skills
- Skills = procedural memory ("how to do things"), tiers = declarative memory ("what I know")

## Agent Tools

### `remember` (updated)
- **Params**: `key` (string), `value` (string), `tier` (optional: "core" | "working", default "working")
- **Behavior**: Creates or updates a memory. Default tier is Working. Agent can specify Core for critical facts.
- If creating in Working and Working is full (30), auto-demote the least-recently-accessed Working memory to Reference.
- If creating in Core and Core is full (10), reject with an error asking agent to demote something first.
- Generates embedding on create/update for future semantic search.
- Updates `last_accessed_at` and increments `access_count`.

### `recall` (new)
- **Params**: `query` (string), `limit` (optional, default 5)
- **Behavior**: Semantic search across ALL tiers (Core + Working + Reference) using vector similarity.
- Returns matching memories with their tier, key, value, access count, and last accessed date.
- **Side effect**: Bumps `last_accessed_at` and `access_count` on accessed memories. If a Reference memory is recalled, it auto-promotes to Working (demoting the LRU Working memory to Reference if full).

### `forget` (new)
- **Params**: `key` (string)
- **Behavior**: Deletes a memory from any tier. Agent can only delete memories it created (`author = 'agent'`).

### `promote_memory` (new)
- **Params**: `key` (string), `tier` ("core" | "working")
- **Behavior**: Moves a memory to the specified tier. If promoting to Core and Core is full, returns error. If promoting to Working and Working is full, LRU demotion occurs.

### `demote_memory` (new)
- **Params**: `key` (string)
- **Behavior**: Moves a memory down one tier (Core → Working, Working → Reference).

## Natural Promotion (Self-Improvement)

- Every memory tracks `access_count` (how many times it's been used/recalled) and `last_accessed_at`.
- When a Working memory's `access_count` crosses a threshold (e.g., 10 accesses), the system prompt includes a hint: "Memory '{key}' has been accessed {count} times — consider promoting to Core."
- Agent decides whether to promote. No automatic Core promotion — agent must explicitly use `promote_memory`.
- This creates a natural learning loop: things the agent keeps reaching for become permanent knowledge.

## System Prompt Injection

Format for the memory section:

```
# Core Knowledge
These are your fundamental, always-available memories:
- **user_name**: Den
- **communication_style**: Concise and technical
- **my_role**: Calendar and scheduling assistant

# Working Memory
Recently relevant context (auto-archived if unused):
- **current_project**: Migration to new API (accessed 8x)
- **meeting_schedule**: Standup at 9am AEST daily (accessed 3x)
- **preference_format**: Markdown tables for data (accessed 1x)

💡 "current_project" has been accessed 8 times — consider promoting to Core.

You have {n} archived memories searchable via the recall tool.
Use 'remember' to store new knowledge. Use 'recall' to search your archive.
```

## Embedding & Search Infrastructure

- **Model**: OpenAI `text-embedding-3-small` (1536 dimensions)
- **Storage**: pgvector extension in PostgreSQL
- **Embedding generation**: On memory create and update, generate embedding from `"{key}: {value}"` concatenation
- **Search**: Cosine similarity search via pgvector's `<=>` operator
- **API key**: Uses the user's existing OpenAI API key from their profile settings

## Data Model Changes

### `agent_memories` table (updated)

| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL PK | |
| agent_id | INTEGER FK | |
| key | VARCHAR(255) | |
| value | TEXT | |
| tier | VARCHAR(10) | 'core', 'working', 'reference'. Default 'working'. |
| author | VARCHAR(10) | 'user' or 'agent'. Default 'agent'. |
| access_count | INTEGER | Default 0. Incremented on recall or system prompt load. |
| last_accessed_at | BIGINT | Epoch ms. Updated on access. |
| embedding | vector(1536) | pgvector column. Nullable (populated async). |
| created_at | TIMESTAMP | |
| updated_at | TIMESTAMP | |

**Constraints**:
- UNIQUE(agent_id, key) — unchanged
- CHECK(tier IN ('core', 'working', 'reference'))

### Migration

- Add columns: `tier`, `author`, `access_count`, `last_accessed_at`, `embedding`
- Existing memories default to `tier = 'working'`, `author = 'agent'`, `access_count = 0`
- Enable pgvector extension: `CREATE EXTENSION IF NOT EXISTS vector`
- Backfill embeddings for existing memories (can be async/background)

## UI Changes

### Agent Memory Management (existing page, enhanced)

- Show memories grouped by tier with visual distinction
- Core memories highlighted (e.g., star icon or different background)
- Working memories show access count badge
- Reference memories in a searchable, collapsible archive section
- User can drag-and-drop or click to change tiers
- User can create memories in any tier
- Show total count per tier and limits

## Access Counting Rules

- When the system prompt is built and Core/Working memories are injected, bump `last_accessed_at` for all loaded memories. Do NOT increment `access_count` for passive loading — only for active use.
- `access_count` increments when:
  - Agent explicitly calls `recall` and the memory appears in results
  - Agent references a memory key in `remember` (update to existing key)
  - Agent calls `promote_memory` or `demote_memory` on a memory
- `last_accessed_at` updates on ALL of the above PLUS passive loading (used for LRU demotion ordering).

## Auto-Demotion Logic

When a new Working memory would exceed the limit (30):
1. Find the Working memory with the oldest `last_accessed_at`
2. Change its tier to 'reference'
3. No notification to agent — this is silent

When a recalled Reference memory auto-promotes to Working:
1. Change the Reference memory's tier to 'working'
2. If Working now exceeds 30, demote the LRU as above

## Non-Functional Requirements

- Embedding generation should not block the tool response. Generate async after the memory is saved.
- Semantic search should return within 200ms for up to 10,000 Reference memories per agent.
- Memory tier changes should be immediately reflected in the next conversation turn.
- Backward compatible — existing memories migrate cleanly with no data loss.

## Open Questions

1. Should there be a global (user-level) memory tier that spans all agents? (Like user-level skills)
2. Should the promotion threshold (10 accesses) be configurable?
3. Should agents see each other's Reference memories if they have communication links?

## Next Steps

After approval: `/sc:design` for database schema, API contracts, and tool specifications, then `/sc:implement`.
