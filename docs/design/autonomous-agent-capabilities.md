# Design: Autonomous Agent Capabilities

**Status**: Draft
**Date**: 2026-02-24
**Requirements**: [autonomous-agent-capabilities.md](../requirements/autonomous-agent-capabilities.md)
**Next Step**: `/sc:implement` after approval

---

## Table of Contents

1. [Database Schema](#1-database-schema)
2. [Models](#2-models)
3. [Repository Interfaces](#3-repository-interfaces)
4. [Agent Tools](#4-agent-tools)
5. [AgentFactory Changes](#5-agentfactory-changes)
6. [Scheduler Service](#6-scheduler-service)
7. [Notification Service](#7-notification-service)
8. [API Routes](#8-api-routes)
9. [Entry Point Changes](#9-entry-point-changes)
10. [Sequence Diagrams](#10-sequence-diagrams)
11. [Implementation Order](#11-implementation-order)

---

## 1. Database Schema

### New Tables

```sql
-- Skills (agent knowledge that can be loaded on-demand)
CREATE TABLE IF NOT EXISTS skills (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    agent_id INTEGER REFERENCES agents(id) ON DELETE CASCADE, -- NULL = user-level
    name VARCHAR(100) NOT NULL, -- slug format
    summary TEXT NOT NULL, -- 1-2 sentences, injected into system prompt
    content TEXT NOT NULL, -- full Markdown instructions
    scope VARCHAR(10) NOT NULL DEFAULT 'agent', -- 'agent' | 'user'
    author VARCHAR(10) NOT NULL DEFAULT 'user', -- 'user' | 'agent'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, agent_id, name), -- unique per scope
    CHECK (content_length(content) <= 51200), -- 50KB limit
    CHECK (scope IN ('agent', 'user')),
    CHECK (author IN ('user', 'agent')),
    CHECK (
        (scope = 'agent' AND agent_id IS NOT NULL) OR
        (scope = 'user' AND agent_id IS NULL)
    )
);

-- Per-agent skill enablement (for user-level skills)
CREATE TABLE IF NOT EXISTS agent_skills (
    id SERIAL PRIMARY KEY,
    agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    skill_id INTEGER NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(agent_id, skill_id)
);

-- Scheduled prompts
CREATE TABLE IF NOT EXISTS schedules (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    prompt TEXT NOT NULL,
    description TEXT, -- human-readable description
    schedule_type VARCHAR(10) NOT NULL, -- 'once' | 'interval' | 'cron'
    schedule_value TEXT NOT NULL, -- ISO 8601 | milliseconds | cron expression
    timezone VARCHAR(100) NOT NULL DEFAULT 'UTC',
    conversation_mode VARCHAR(10) NOT NULL DEFAULT 'new', -- 'new' | 'continue'
    conversation_id INTEGER REFERENCES conversations(id) ON DELETE SET NULL,
    author VARCHAR(10) NOT NULL DEFAULT 'user', -- 'user' | 'agent'
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    next_run_at TIMESTAMP, -- precomputed next execution time (UTC)
    last_run_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CHECK (schedule_type IN ('once', 'interval', 'cron')),
    CHECK (conversation_mode IN ('new', 'continue')),
    CHECK (author IN ('user', 'agent'))
);

-- Schedule execution log
CREATE TABLE IF NOT EXISTS schedule_executions (
    id SERIAL PRIMARY KEY,
    schedule_id INTEGER NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
    conversation_id INTEGER REFERENCES conversations(id) ON DELETE SET NULL,
    status VARCHAR(20) NOT NULL, -- 'running' | 'success' | 'error' | 'retry'
    error_message TEXT,
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP,
    retry_count INTEGER DEFAULT 0
);

-- Notifications
CREATE TABLE IF NOT EXISTS notifications (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    conversation_id INTEGER REFERENCES conversations(id) ON DELETE SET NULL,
    message TEXT NOT NULL,
    urgency VARCHAR(10) NOT NULL DEFAULT 'normal', -- 'low' | 'normal' | 'high'
    read BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CHECK (urgency IN ('low', 'normal', 'high'))
);

-- Notification delivery log (email/webhook tracking)
CREATE TABLE IF NOT EXISTS notification_deliveries (
    id SERIAL PRIMARY KEY,
    notification_id INTEGER NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
    channel VARCHAR(10) NOT NULL, -- 'email' | 'webhook'
    status VARCHAR(10) NOT NULL, -- 'pending' | 'sent' | 'failed'
    error_message TEXT,
    attempts INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    delivered_at TIMESTAMP,
    CHECK (channel IN ('email', 'webhook')),
    CHECK (status IN ('pending', 'sent', 'failed'))
);

-- User notification preferences
CREATE TABLE IF NOT EXISTS user_notification_settings (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    notification_email VARCHAR(255), -- email address for notifications
    webhook_urls JSONB DEFAULT '[]', -- array of webhook URL configs
    email_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id)
);

-- Per-agent notification muting
CREATE TABLE IF NOT EXISTS agent_notification_mutes (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    muted_channels JSONB DEFAULT '["email", "webhook"]', -- which channels are muted
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, agent_id)
);
```

### New Indexes

```sql
CREATE INDEX IF NOT EXISTS idx_skills_user_id ON skills(user_id);
CREATE INDEX IF NOT EXISTS idx_skills_agent_id ON skills(agent_id);
CREATE INDEX IF NOT EXISTS idx_skills_scope ON skills(user_id, scope);
CREATE INDEX IF NOT EXISTS idx_agent_skills_agent_id ON agent_skills(agent_id);
CREATE INDEX IF NOT EXISTS idx_schedules_user_id ON schedules(user_id);
CREATE INDEX IF NOT EXISTS idx_schedules_agent_id ON schedules(agent_id);
CREATE INDEX IF NOT EXISTS idx_schedules_next_run ON schedules(next_run_at) WHERE enabled = TRUE;
CREATE INDEX IF NOT EXISTS idx_schedule_executions_schedule_id ON schedule_executions(schedule_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(user_id, read) WHERE read = FALSE;
CREATE INDEX IF NOT EXISTS idx_notification_deliveries_pending ON notification_deliveries(status) WHERE status = 'pending';
```

### Design Rationale

**`skills` table**: The `UNIQUE(user_id, agent_id, name)` constraint allows the same skill name at user-level (agent_id=NULL) and agent-level (agent_id=N). The CHECK constraint enforces that agent-scoped skills must have an agent_id and user-scoped skills must not.

**`schedules.next_run_at`**: Precomputed to avoid cron parsing on every tick. The scheduler queries `WHERE enabled = TRUE AND next_run_at <= NOW()`, executes, then recomputes `next_run_at`. This is the standard pattern for database-backed schedulers — index-friendly and simple.

**`content_length` check**: PostgreSQL doesn't have a native `content_length` function. We'll enforce the 50KB limit at the application layer instead via the repository. Remove this CHECK from the SQL.

---

## 2. Models

### New Types in `backend/types/models.ts`

```typescript
export interface Skill {
  id: number;
  user_id: number;
  agent_id: number | null;
  name: string;
  summary: string;
  content: string;
  scope: 'agent' | 'user';
  author: 'user' | 'agent';
  created_at: Date;
  updated_at: Date;
}

export interface AgentSkill {
  id: number;
  agent_id: number;
  skill_id: number;
  enabled: boolean;
  created_at: Date;
}

export interface Schedule {
  id: number;
  user_id: number;
  agent_id: number;
  prompt: string;
  description: string | null;
  schedule_type: 'once' | 'interval' | 'cron';
  schedule_value: string;
  timezone: string;
  conversation_mode: 'new' | 'continue';
  conversation_id: number | null;
  author: 'user' | 'agent';
  enabled: boolean;
  next_run_at: Date | null;
  last_run_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface ScheduleExecution {
  id: number;
  schedule_id: number;
  conversation_id: number | null;
  status: 'running' | 'success' | 'error' | 'retry';
  error_message: string | null;
  started_at: Date;
  completed_at: Date | null;
  retry_count: number;
}

export interface Notification {
  id: number;
  user_id: number;
  agent_id: number;
  conversation_id: number | null;
  message: string;
  urgency: 'low' | 'normal' | 'high';
  read: boolean;
  created_at: Date;
}

export interface NotificationDelivery {
  id: number;
  notification_id: number;
  channel: 'email' | 'webhook';
  status: 'pending' | 'sent' | 'failed';
  error_message: string | null;
  attempts: number;
  created_at: Date;
  delivered_at: Date | null;
}

export interface UserNotificationSettings {
  id: number;
  user_id: number;
  notification_email: string | null;
  webhook_urls: WebhookConfig[];
  email_enabled: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface WebhookConfig {
  url: string;
  name: string; // e.g., "Slack", "Discord"
}
```

---

## 3. Repository Interfaces

### `backend/repositories/SkillRepository.ts`

```typescript
import type { Skill } from "../types/models";

export interface CreateSkillData {
  user_id: number;
  agent_id: number | null;
  name: string;
  summary: string;
  content: string;
  scope: 'agent' | 'user';
  author: 'user' | 'agent';
}

export interface UpdateSkillData {
  summary?: string;
  content?: string;
}

export interface SkillRepository {
  create(data: CreateSkillData): Promise<Skill>;
  update(id: number, data: UpdateSkillData): Promise<Skill>;
  delete(id: number): Promise<void>;
  findById(id: number): Promise<Skill | null>;
  findByName(userId: number, agentId: number | null, name: string): Promise<Skill | null>;

  /** All skills available to an agent (its own + enabled user-level) */
  listForAgent(userId: number, agentId: number): Promise<Skill[]>;

  /** All user-level skills */
  listByUser(userId: number): Promise<Skill[]>;

  /** All agent-scoped skills for a specific agent */
  listByAgent(agentId: number): Promise<Skill[]>;

  /** Toggle a user-level skill for a specific agent */
  setAgentSkillEnabled(agentId: number, skillId: number, enabled: boolean): Promise<void>;

  /** Check if a user-level skill is enabled for an agent (default: true) */
  isEnabledForAgent(agentId: number, skillId: number): Promise<boolean>;
}
```

### `backend/repositories/ScheduleRepository.ts`

```typescript
import type { Schedule, ScheduleExecution } from "../types/models";

export interface CreateScheduleData {
  user_id: number;
  agent_id: number;
  prompt: string;
  description?: string;
  schedule_type: 'once' | 'interval' | 'cron';
  schedule_value: string;
  timezone: string;
  conversation_mode: 'new' | 'continue';
  conversation_id?: number;
  author: 'user' | 'agent';
}

export interface ScheduleRepository {
  create(data: CreateScheduleData): Promise<Schedule>;
  update(id: number, data: Partial<Pick<Schedule, 'prompt' | 'description' | 'enabled' | 'schedule_value' | 'schedule_type'>>): Promise<Schedule>;
  delete(id: number): Promise<void>;
  findById(id: number): Promise<Schedule | null>;
  listByUser(userId: number): Promise<Schedule[]>;
  listByAgent(agentId: number): Promise<Schedule[]>;
  countByUser(userId: number): Promise<number>;

  /** Get all schedules due for execution */
  listDue(): Promise<Schedule[]>;

  /** Update next_run_at after execution */
  updateNextRun(id: number, nextRunAt: Date | null, lastRunAt: Date): Promise<void>;

  /** Log an execution */
  logExecution(data: {
    schedule_id: number;
    conversation_id?: number;
    status: 'running' | 'success' | 'error' | 'retry';
    error_message?: string;
  }): Promise<ScheduleExecution>;

  /** Update execution status */
  updateExecution(id: number, data: {
    status: 'success' | 'error' | 'retry';
    error_message?: string;
    completed_at?: Date;
  }): Promise<void>;

  /** Get execution history for a schedule */
  listExecutions(scheduleId: number, limit?: number): Promise<ScheduleExecution[]>;
}
```

### `backend/repositories/NotificationRepository.ts`

```typescript
import type { Notification, NotificationDelivery, UserNotificationSettings } from "../types/models";

export interface NotificationRepository {
  create(data: {
    user_id: number;
    agent_id: number;
    conversation_id?: number;
    message: string;
    urgency: 'low' | 'normal' | 'high';
  }): Promise<Notification>;

  listByUser(userId: number, options?: {
    unreadOnly?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<Notification[]>;

  countUnread(userId: number): Promise<number>;
  markRead(id: number): Promise<void>;
  markAllRead(userId: number): Promise<void>;

  /** Delivery tracking */
  createDelivery(notificationId: number, channel: 'email' | 'webhook'): Promise<NotificationDelivery>;
  updateDelivery(id: number, data: {
    status: 'sent' | 'failed';
    error_message?: string;
  }): Promise<void>;
  listPendingDeliveries(): Promise<(NotificationDelivery & { notification: Notification })[]>;

  /** User notification settings */
  getSettings(userId: number): Promise<UserNotificationSettings | null>;
  upsertSettings(userId: number, data: Partial<UserNotificationSettings>): Promise<UserNotificationSettings>;

  /** Per-agent muting */
  isAgentMuted(userId: number, agentId: number, channel: string): Promise<boolean>;
  muteAgent(userId: number, agentId: number, channels: string[]): Promise<void>;
  unmuteAgent(userId: number, agentId: number): Promise<void>;

  /** Rate limiting check */
  countRecentByAgentAndChannel(agentId: number, channel: string, sinceMinutes: number): Promise<number>;
}
```

---

## 4. Agent Tools

### File: `backend/tools/skillTools.ts`

Five tools, all following the `createMemoryTool` pattern:

```typescript
import { tool } from "@openai/agents";
import type { SkillRepository } from "../repositories/SkillRepository";
import { z } from "zod";
import type { ToolContext } from "./context";

export function createSkillTools<TContext extends ToolContext>(
  skillRepository: SkillRepository,
  userId: number,
  agentId: number
) {
  const loadSkill = tool<z.ZodObject<{ skill_name: z.ZodString }>, TContext>({
    name: "load_skill",
    description: "Load a skill's full instructions. Use when a task matches a skill in your catalog.",
    parameters: z.object({
      skill_name: z.string().describe("The name/slug of the skill to load"),
    }),
    execute: async (params, context) => {
      context?.context.updateStatus(`Loading skill: ${params.skill_name}`);
      const skill = await skillRepository.findByName(userId, agentId, params.skill_name)
        ?? await skillRepository.findByName(userId, null, params.skill_name);
      if (!skill) return JSON.stringify({ error: `Skill '${params.skill_name}' not found` });
      return JSON.stringify({ name: skill.name, content: skill.content });
    },
  });

  const createSkill = tool<z.ZodObject<any>, TContext>({
    name: "create_skill",
    description: "Create a new skill from a pattern you've noticed. The skill will be saved and available in future conversations.",
    parameters: z.object({
      name: z.string().describe("Skill slug (lowercase, hyphens, e.g., 'email-drafting')"),
      summary: z.string().describe("1-2 sentence description of WHEN to use this skill"),
      content: z.string().describe("Full Markdown instructions for the skill"),
    }),
    execute: async (params, context) => {
      context?.context.updateStatus(`Creating skill: ${params.name}`);
      // Check for duplicates
      const existing = await skillRepository.findByName(userId, agentId, params.name);
      if (existing) return JSON.stringify({ error: `Skill '${params.name}' already exists. Use update_skill instead.` });
      // Enforce 50KB limit
      if (params.content.length > 51200) return JSON.stringify({ error: "Skill content exceeds 50KB limit" });
      const skill = await skillRepository.create({
        user_id: userId, agent_id: agentId, name: params.name,
        summary: params.summary, content: params.content,
        scope: 'agent', author: 'agent',
      });
      return JSON.stringify({ success: true, message: `Skill '${skill.name}' created` });
    },
  });

  const updateSkill = tool<z.ZodObject<any>, TContext>({
    name: "update_skill",
    description: "Update an existing skill you created with improved instructions.",
    parameters: z.object({
      name: z.string().describe("The skill slug to update"),
      summary: z.string().optional().describe("Updated summary"),
      content: z.string().optional().describe("Updated full instructions"),
    }),
    execute: async (params, context) => {
      context?.context.updateStatus(`Updating skill: ${params.name}`);
      const skill = await skillRepository.findByName(userId, agentId, params.name);
      if (!skill) return JSON.stringify({ error: `Skill '${params.name}' not found` });
      if (skill.author !== 'agent') return JSON.stringify({ error: "Cannot update user-created skills" });
      if (params.content && params.content.length > 51200) return JSON.stringify({ error: "Content exceeds 50KB limit" });
      await skillRepository.update(skill.id, {
        summary: params.summary, content: params.content,
      });
      return JSON.stringify({ success: true, message: `Skill '${params.name}' updated` });
    },
  });

  const deleteSkill = tool<z.ZodObject<any>, TContext>({
    name: "delete_skill",
    description: "Delete a skill you previously created.",
    parameters: z.object({
      name: z.string().describe("The skill slug to delete"),
    }),
    execute: async (params, context) => {
      const skill = await skillRepository.findByName(userId, agentId, params.name);
      if (!skill) return JSON.stringify({ error: `Skill '${params.name}' not found` });
      if (skill.author !== 'agent') return JSON.stringify({ error: "Cannot delete user-created skills" });
      await skillRepository.delete(skill.id);
      return JSON.stringify({ success: true, message: `Skill '${params.name}' deleted` });
    },
  });

  const listSkills = tool<z.ZodObject<any>, TContext>({
    name: "list_skills",
    description: "List all skills available to you, including their summaries.",
    parameters: z.object({}),
    execute: async (_params, context) => {
      context?.context.updateStatus("Loading skills catalog...");
      const skills = await skillRepository.listForAgent(userId, agentId);
      return JSON.stringify(skills.map(s => ({
        name: s.name, summary: s.summary, scope: s.scope, author: s.author,
      })));
    },
  });

  return [loadSkill, createSkill, updateSkill, deleteSkill, listSkills];
}
```

### File: `backend/tools/scheduleTool.ts`

```typescript
import { tool } from "@openai/agents";
import type { ScheduleRepository } from "../repositories/ScheduleRepository";
import { z } from "zod";
import type { ToolContext } from "./context";

export function createScheduleTools<TContext extends ToolContext>(
  scheduleRepository: ScheduleRepository,
  userId: number,
  agentId: number,
  currentConversationId: number | null
) {
  const schedulePrompt = tool<z.ZodObject<any>, TContext>({
    name: "schedule_prompt",
    description:
      "Schedule a message to be sent to yourself in the future. Use for follow-ups, recurring checks, or delayed tasks.",
    parameters: z.object({
      prompt: z.string().describe("The message to send to yourself later"),
      schedule_type: z.enum(["once", "interval", "cron"]).describe(
        "once = single future run (provide ISO 8601 timestamp), interval = recurring (provide milliseconds), cron = cron expression"
      ),
      schedule_value: z.string().describe(
        "ISO 8601 timestamp, milliseconds as string, or cron expression (e.g., '0 9 * * 1-5')"
      ),
      conversation_mode: z.enum(["new", "continue"]).default("new")
        .describe("'continue' to resume this conversation, 'new' to start fresh"),
      description: z.string().optional().describe("Human-readable description of this schedule"),
    }),
    execute: async (params, context) => {
      context?.context.updateStatus("Creating schedule...");
      // Enforce minimum interval
      if (params.schedule_type === "interval") {
        const ms = parseInt(params.schedule_value);
        if (isNaN(ms) || ms < 300000) {
          return JSON.stringify({ error: "Minimum interval is 5 minutes (300000ms)" });
        }
      }
      // Check user limit
      const count = await scheduleRepository.countByUser(userId);
      if (count >= 50) {
        return JSON.stringify({ error: "Schedule limit reached (50). Delete unused schedules first." });
      }
      const schedule = await scheduleRepository.create({
        user_id: userId,
        agent_id: agentId,
        prompt: params.prompt,
        description: params.description,
        schedule_type: params.schedule_type,
        schedule_value: params.schedule_value,
        timezone: "UTC", // Will be set from user profile at execution
        conversation_mode: params.conversation_mode,
        conversation_id: params.conversation_mode === "continue" ? currentConversationId ?? undefined : undefined,
        author: "agent",
      });
      return JSON.stringify({
        success: true,
        schedule_id: schedule.id,
        message: `Scheduled: ${params.description || params.prompt.substring(0, 50)}`,
      });
    },
  });

  const listSchedules = tool<z.ZodObject<any>, TContext>({
    name: "list_schedules",
    description: "List your active scheduled prompts.",
    parameters: z.object({}),
    execute: async (_params, context) => {
      const schedules = await scheduleRepository.listByAgent(agentId);
      return JSON.stringify(schedules.map(s => ({
        id: s.id, description: s.description, prompt: s.prompt.substring(0, 100),
        type: s.schedule_type, value: s.schedule_value, enabled: s.enabled,
        next_run: s.next_run_at, last_run: s.last_run_at,
      })));
    },
  });

  const cancelSchedule = tool<z.ZodObject<any>, TContext>({
    name: "cancel_schedule",
    description: "Cancel (disable) a scheduled prompt.",
    parameters: z.object({
      schedule_id: z.number().describe("The ID of the schedule to cancel"),
    }),
    execute: async (params, context) => {
      const schedule = await scheduleRepository.findById(params.schedule_id);
      if (!schedule || schedule.agent_id !== agentId) {
        return JSON.stringify({ error: "Schedule not found" });
      }
      await scheduleRepository.update(params.schedule_id, { enabled: false });
      return JSON.stringify({ success: true, message: "Schedule cancelled" });
    },
  });

  return [schedulePrompt, listSchedules, cancelSchedule];
}
```

### File: `backend/tools/notifyTool.ts`

```typescript
import { tool } from "@openai/agents";
import type { NotificationRepository } from "../repositories/NotificationRepository";
import { z } from "zod";
import type { ToolContext } from "./context";

export function createNotifyTool<TContext extends ToolContext>(
  notificationRepository: NotificationRepository,
  userId: number,
  agentId: number,
  conversationId: number | null
) {
  return tool<z.ZodObject<any>, TContext>({
    name: "notify_user",
    description:
      "Send a notification to the user. Use when you have important findings, completed scheduled tasks, or urgent information. The notification will appear in their notification feed and optionally via email/webhook.",
    parameters: z.object({
      message: z.string().describe("The notification message"),
      urgency: z.enum(["low", "normal", "high"]).default("normal")
        .describe("low = FYI, normal = should see soon, high = needs attention now"),
      channels: z.array(z.enum(["web", "email", "webhook"])).default(["web"])
        .describe("Where to deliver the notification"),
    }),
    execute: async (params, context) => {
      context?.context.updateStatus("Sending notification...");

      // Create the notification (always stored in web/DB)
      const notification = await notificationRepository.create({
        user_id: userId,
        agent_id: agentId,
        conversation_id: conversationId ?? undefined,
        message: params.message,
        urgency: params.urgency,
      });

      // Queue external deliveries (email, webhook) - processed async by NotificationService
      for (const channel of params.channels) {
        if (channel === "web") continue; // Already stored in DB
        // Check if agent is muted for this channel
        const muted = await notificationRepository.isAgentMuted(userId, agentId, channel);
        if (muted) continue;
        await notificationRepository.createDelivery(notification.id, channel);
      }

      return JSON.stringify({
        success: true,
        message: `Notification sent via: ${params.channels.join(", ")}`,
      });
    },
  });
}
```

---

## 5. AgentFactory Changes

### Modified: `backend/services/AgentFactory.ts`

Add `SkillRepository`, `ScheduleRepository`, and `NotificationRepository` to dependencies. Modify `createAgentRecursive` to:

1. **Load and inject skill catalog into system prompt**
2. **Add skill tools, schedule tools, and notify tool**

```typescript
interface AgentFactoryDependencies {
  mcpServerRepository: McpServerRepository;
  urlToolRepository: UrlToolRepository;
  agentRepository: AgentRepository;
  userRepository: UserRepository;
  memoryRepository: MemoryRepository;
  skillRepository: SkillRepository;          // NEW
  scheduleRepository: ScheduleRepository;    // NEW
  notificationRepository: NotificationRepository; // NEW
}
```

In `createAgentRecursive`, after memory injection (~line 218):

```typescript
// Load skills catalog and inject summaries into system prompt
const skills = await this.deps.skillRepository.listForAgent(context.id, agentData.id);
if (skills.length > 0) {
  instructionsWithContext += "\n\n# Available Skills\n";
  instructionsWithContext += "You have specialized skills you can load when needed. ";
  instructionsWithContext += "Only load a skill when a task matches its description.\n\n";
  for (const skill of skills.slice(0, 30)) { // Cap at 30
    instructionsWithContext += `- **${skill.name}**: ${skill.summary}\n`;
  }
  instructionsWithContext += "\nUse the load_skill tool to load a skill's full instructions when needed.\n";

  // Add guidance on memory vs skills
  instructionsWithContext += "\n**Memory vs Skills**: Use 'remember' for facts and preferences. ";
  instructionsWithContext += "Use 'create_skill' for reusable procedures, workflows, or multi-step patterns.\n";
}

// Add skill tools (always available - agent can create skills even if none exist yet)
const skillTools = createSkillTools<TAgentContext>(
  this.deps.skillRepository, context.id, agentData.id
);
tools.push(...skillTools);

// Add schedule tools
const scheduleTools = createScheduleTools<TAgentContext>(
  this.deps.scheduleRepository, context.id, agentData.id, null // conversationId set later
);
tools.push(...scheduleTools);

// Add notify tool
const notifyTool = createNotifyTool<TAgentContext>(
  this.deps.notificationRepository, context.id, agentData.id, null
);
tools.push(notifyTool);
```

**Note on `conversationId`**: The schedule and notify tools need the current conversation ID to support `conversation_mode: "continue"` and to link notifications. Currently `AgentFactory.createAgent()` doesn't receive `conversationId`. We have two options:

**Option A (Preferred)**: Add `conversationId` as an optional parameter to `createAgent`:
```typescript
async createAgent<TAgentContext>(
  context: TAgentContext,
  agentSlug: string,
  options?: { conversationId?: number }
): Promise<Agent<TAgentContext>>
```

**Option B**: Tools read conversation ID from the agent execution context. This would require modifying the `UserContext` type to include it.

---

## 6. Scheduler Service

### File: `backend/services/SchedulerService.ts`

The scheduler runs as an in-process `setTimeout` loop inside the main Bun server. It polls the database every 30 seconds for due schedules.

```
┌─────────────────────────────────────────────────┐
│                 Bun.serve()                      │
│  ┌───────────┐  ┌────────────────────────────┐  │
│  │ HTTP/SSE  │  │ SchedulerService            │  │
│  │ Routes    │  │                             │  │
│  │           │  │  poll() every 30s           │  │
│  │           │  │    ↓                        │  │
│  │           │  │  SELECT * FROM schedules    │  │
│  │           │  │  WHERE next_run_at <= NOW() │  │
│  │           │  │  AND enabled = TRUE         │  │
│  │           │  │    ↓                        │  │
│  │           │  │  For each: executeSchedule()│  │
│  │           │  │    → AgentFactory.create()  │  │
│  │           │  │    → run(agent, prompt, {}) │  │
│  │           │  │    → log execution result   │  │
│  │           │  │    → compute next_run_at    │  │
│  └───────────┘  └────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

```typescript
interface SchedulerServiceDeps {
  scheduleRepository: ScheduleRepository;
  agentFactory: AgentFactory;
  conversationRepository: ConversationRepository;
  userRepository: UserRepository;
  encryptionSecret: string;
}

export class SchedulerService {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;

  constructor(private deps: SchedulerServiceDeps) {}

  start(intervalMs = 30_000) {
    this.tick(intervalMs);
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private tick(intervalMs: number) {
    this.timer = setTimeout(async () => {
      if (!this.running) {
        this.running = true;
        try { await this.poll(); }
        catch (err) { console.error("Scheduler poll error:", err); }
        finally { this.running = false; }
      }
      this.tick(intervalMs);
    }, intervalMs);
  }

  private async poll() {
    const dueSchedules = await this.deps.scheduleRepository.listDue();
    // Execute each schedule (serially to avoid API key conflicts)
    for (const schedule of dueSchedules) {
      await this.executeSchedule(schedule);
    }
  }

  private async executeSchedule(schedule: Schedule) {
    const execution = await this.deps.scheduleRepository.logExecution({
      schedule_id: schedule.id,
      status: 'running',
    });

    try {
      // Load user for API key
      const user = await this.deps.userRepository.findById(schedule.user_id);
      if (!user?.openai_api_key) throw new Error("No API key configured");

      const openaiApiKey = await decrypt(user.openai_api_key, this.deps.encryptionSecret);

      // Get or create conversation
      let conversationId = schedule.conversation_id;
      if (schedule.conversation_mode === 'new' || !conversationId) {
        const conversation = await this.deps.conversationRepository.create({
          user_id: schedule.user_id,
          agent_id: schedule.agent_id,
          title: `[Scheduled] ${schedule.description || schedule.prompt.substring(0, 50)}`,
        });
        conversationId = conversation.id;
      }

      // Create agent and run
      const agent = await this.deps.agentFactory.createAgent(user, agentSlug, {
        conversationId,
      });

      setDefaultOpenAIKey(openaiApiKey);
      const session = new DatabaseSession(conversationId, this.deps.conversationRepository);
      const result = await run(agent, schedule.prompt, {
        context: user,
        session,
      });

      // Update execution status
      await this.deps.scheduleRepository.updateExecution(execution.id, {
        status: 'success',
        completed_at: new Date(),
      });

      // Update schedule (next_run_at, last_run_at)
      const nextRun = computeNextRun(schedule);
      await this.deps.scheduleRepository.updateNextRun(
        schedule.id,
        nextRun,
        new Date()
      );

      // Disable one-shot schedules
      if (schedule.schedule_type === 'once') {
        await this.deps.scheduleRepository.update(schedule.id, { enabled: false });
      }
    } catch (err) {
      console.error(`Schedule ${schedule.id} execution failed:`, err);
      await this.deps.scheduleRepository.updateExecution(execution.id, {
        status: 'error',
        error_message: err instanceof Error ? err.message : String(err),
        completed_at: new Date(),
      });
    }
  }
}
```

### `computeNextRun` Utility

```typescript
// backend/utils/schedule.ts
import { parseExpression } from 'cron-parser'; // npm: cron-parser

export function computeNextRun(schedule: Schedule): Date | null {
  const now = new Date();
  switch (schedule.schedule_type) {
    case 'once':
      return null; // No next run
    case 'interval': {
      const ms = parseInt(schedule.schedule_value);
      return new Date(now.getTime() + ms);
    }
    case 'cron': {
      const interval = parseExpression(schedule.schedule_value, {
        currentDate: now,
        tz: schedule.timezone,
      });
      return interval.next().toDate();
    }
  }
}

export function computeFirstRun(schedule: CreateScheduleData): Date | null {
  switch (schedule.schedule_type) {
    case 'once':
      return new Date(schedule.schedule_value);
    case 'interval':
      return new Date(Date.now() + parseInt(schedule.schedule_value));
    case 'cron': {
      const interval = parseExpression(schedule.schedule_value, {
        currentDate: new Date(),
        tz: schedule.timezone,
      });
      return interval.next().toDate();
    }
  }
}
```

**New dependency**: `cron-parser` (lightweight, zero-dependency cron expression parser).

---

## 7. Notification Service

### File: `backend/services/NotificationService.ts`

Processes pending email/webhook deliveries on a polling loop (every 10 seconds).

```typescript
interface NotificationServiceDeps {
  notificationRepository: NotificationRepository;
  userRepository: UserRepository;
}

export class NotificationService {
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private deps: NotificationServiceDeps) {}

  start(intervalMs = 10_000) { /* same setTimeout pattern as SchedulerService */ }
  stop() { /* clear timer */ }

  private async poll() {
    const pending = await this.deps.notificationRepository.listPendingDeliveries();
    for (const delivery of pending) {
      await this.processDelivery(delivery);
    }
  }

  private async processDelivery(delivery: NotificationDelivery & { notification: Notification }) {
    try {
      if (delivery.channel === 'email') {
        await this.sendEmail(delivery);
      } else if (delivery.channel === 'webhook') {
        await this.sendWebhook(delivery);
      }
      await this.deps.notificationRepository.updateDelivery(delivery.id, { status: 'sent' });
    } catch (err) {
      const attempts = delivery.attempts + 1;
      if (attempts >= 3) {
        await this.deps.notificationRepository.updateDelivery(delivery.id, {
          status: 'failed',
          error_message: err instanceof Error ? err.message : String(err),
        });
      }
      // Otherwise, stays pending for retry on next poll
    }
  }

  private async sendEmail(delivery: NotificationDelivery & { notification: Notification }) {
    // Rate limit: 5 per agent per hour
    const recentCount = await this.deps.notificationRepository
      .countRecentByAgentAndChannel(delivery.notification.agent_id, 'email', 60);
    if (recentCount >= 5) throw new Error("Email rate limit exceeded");

    const settings = await this.deps.notificationRepository.getSettings(delivery.notification.user_id);
    if (!settings?.notification_email || !settings.email_enabled) {
      throw new Error("Email not configured");
    }

    // Send via simple SMTP or transactional email service
    // For V1: use a lightweight approach (e.g., Resend, Mailgun, or Bun's fetch to an SMTP relay)
    await sendTransactionalEmail({
      to: settings.notification_email,
      subject: `[${delivery.notification.urgency.toUpperCase()}] Agent notification`,
      body: delivery.notification.message,
    });
  }

  private async sendWebhook(delivery: NotificationDelivery & { notification: Notification }) {
    const settings = await this.deps.notificationRepository.getSettings(delivery.notification.user_id);
    if (!settings?.webhook_urls?.length) throw new Error("No webhooks configured");

    const payload = {
      agent_id: delivery.notification.agent_id,
      message: delivery.notification.message,
      urgency: delivery.notification.urgency,
      conversation_id: delivery.notification.conversation_id,
      timestamp: delivery.notification.created_at,
    };

    // Fire to all configured webhooks
    for (const webhook of settings.webhook_urls) {
      await fetch(webhook.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    }
  }
}
```

---

## 8. API Routes

### Skills API

| Method | Path | Handler | Description |
|--------|------|---------|-------------|
| GET | `/api/skills` | `listSkills` | List all user-level skills |
| POST | `/api/skills` | `createSkill` | Create a user-level skill |
| PUT | `/api/skills/:id` | `updateSkill` | Update a skill |
| DELETE | `/api/skills/:id` | `deleteSkill` | Delete a skill |
| GET | `/api/agents/:slug/skills` | `listAgentSkills` | List skills for an agent (own + user-level with enabled status) |
| POST | `/api/agents/:slug/skills` | `createAgentSkill` | Create an agent-scoped skill |
| PATCH | `/api/agents/:slug/skills/:skillId/toggle` | `toggleAgentSkill` | Enable/disable a skill for an agent |
| PATCH | `/api/skills/:id/promote` | `promoteSkill` | Promote agent-scoped skill to user-level |

### Schedules API

| Method | Path | Handler | Description |
|--------|------|---------|-------------|
| GET | `/api/schedules` | `listSchedules` | List all user's schedules |
| GET | `/api/agents/:slug/schedules` | `listAgentSchedules` | Schedules for a specific agent |
| POST | `/api/agents/:slug/schedules` | `createSchedule` | Create a schedule |
| PUT | `/api/schedules/:id` | `updateSchedule` | Update a schedule |
| DELETE | `/api/schedules/:id` | `deleteSchedule` | Delete a schedule |
| PATCH | `/api/schedules/:id/toggle` | `toggleSchedule` | Enable/disable |
| GET | `/api/schedules/:id/executions` | `listExecutions` | Execution history |

### Notifications API

| Method | Path | Handler | Description |
|--------|------|---------|-------------|
| GET | `/api/notifications` | `listNotifications` | List user's notifications |
| GET | `/api/notifications/unread-count` | `getUnreadCount` | Get unread count (for badge) |
| PATCH | `/api/notifications/:id/read` | `markRead` | Mark notification as read |
| POST | `/api/notifications/read-all` | `markAllRead` | Mark all as read |
| GET | `/api/user/notification-settings` | `getSettings` | Get notification settings |
| PUT | `/api/user/notification-settings` | `updateSettings` | Update notification settings |
| POST | `/api/agents/:slug/notifications/mute` | `muteAgent` | Mute an agent's notifications |
| DELETE | `/api/agents/:slug/notifications/mute` | `unmuteAgent` | Unmute |

---

## 9. Entry Point Changes

### Modified: `index.ts`

```typescript
// New imports
import { PostgresSkillRepository } from "./backend/repositories/postgres/PostgresSkillRepository";
import { PostgresScheduleRepository } from "./backend/repositories/postgres/PostgresScheduleRepository";
import { PostgresNotificationRepository } from "./backend/repositories/postgres/PostgresNotificationRepository";
import { SchedulerService } from "./backend/services/SchedulerService";
import { NotificationService } from "./backend/services/NotificationService";

// In Dependencies interface:
interface Dependencies {
  // ... existing ...
  skillRepository: SkillRepository | null;
  scheduleRepository: ScheduleRepository | null;
  notificationRepository: NotificationRepository | null;
  schedulerService: SchedulerService | null;
  notificationService: NotificationService | null;
}

// In main(), after creating repositories:
deps.skillRepository = new PostgresSkillRepository();
deps.scheduleRepository = new PostgresScheduleRepository();
deps.notificationRepository = new PostgresNotificationRepository();

// Update AgentFactory creation:
deps.agentFactory = new AgentFactory({
  // ... existing ...
  skillRepository: deps.skillRepository,
  scheduleRepository: deps.scheduleRepository,
  notificationRepository: deps.notificationRepository,
});

// After server starts, start background services:
if (deps.scheduleRepository && deps.agentFactory && deps.conversationRepository && deps.userRepository && config.encryptionSecret) {
  deps.schedulerService = new SchedulerService({
    scheduleRepository: deps.scheduleRepository,
    agentFactory: deps.agentFactory,
    conversationRepository: deps.conversationRepository,
    userRepository: deps.userRepository,
    encryptionSecret: config.encryptionSecret,
  });
  deps.schedulerService.start();
}

if (deps.notificationRepository && deps.userRepository) {
  deps.notificationService = new NotificationService({
    notificationRepository: deps.notificationRepository,
    userRepository: deps.userRepository,
  });
  deps.notificationService.start();
}

// In shutdown:
deps.schedulerService?.stop();
deps.notificationService?.stop();
```

---

## 10. Sequence Diagrams

### Skill Load Flow

```
User Message → Chat Handler → AgentFactory.createAgent()
                                ↓
                           Load skills for agent
                           Inject summaries into system prompt
                           Add skill tools to agent
                                ↓
                           Agent runs with message
                           Agent reads skill catalog in prompt
                           Agent calls load_skill("email-drafting")
                                ↓
                           load_skill tool queries DB
                           Returns full Markdown content
                                ↓
                           Agent follows skill instructions
                           Agent responds to user
```

### Autonomous Skill Creation Flow

```
User Message → Agent processes → Agent detects pattern
                                     ↓
                               Agent calls create_skill(
                                 name: "code-review-style",
                                 summary: "Use when reviewing code...",
                                 content: "## Steps\n1. Check for..."
                               )
                                     ↓
                               Tool writes to skills table
                               scope='agent', author='agent'
                                     ↓
                               Agent mentions skill creation in response
                               Next conversation: skill appears in catalog
```

### Scheduled Execution Flow

```
SchedulerService.poll()
    ↓
Query: SELECT * FROM schedules WHERE next_run_at <= NOW() AND enabled
    ↓
For each due schedule:
    ↓
Log execution (status='running')
    ↓
Load user → decrypt API key
    ↓
Get/create conversation
    ↓
AgentFactory.createAgent(user, agentSlug) — full agent with tools
    ↓
run(agent, schedule.prompt, { session }) — non-streaming
    ↓
Agent executes (may use tools, skills, notify_user)
    ↓
Log execution (status='success')
    ↓
Compute next_run_at → update schedule
```

### Notification Flow

```
Agent calls notify_user(message, urgency, channels)
    ↓
INSERT INTO notifications (always — web channel)
    ↓
For each external channel (email, webhook):
    Check mute status
    INSERT INTO notification_deliveries (status='pending')
    ↓
NotificationService.poll() (every 10s)
    SELECT * FROM notification_deliveries WHERE status='pending'
    ↓
    Email: check rate limit → send via email service
    Webhook: POST to configured URLs
    ↓
    Update delivery status (sent/failed)
```

---

## 11. Implementation Order

### Phase 1: Skills System (foundation)
1. Schema migration (skills, agent_skills tables)
2. Models + SkillRepository interface + Postgres implementation
3. Skill tools (load_skill, create_skill, update_skill, delete_skill, list_skills)
4. AgentFactory changes (inject catalog + tools)
5. Skills API handlers + routes
6. Frontend: Skills management in Agent settings

### Phase 2: Scheduling
1. Schema migration (schedules, schedule_executions tables)
2. Models + ScheduleRepository interface + Postgres implementation
3. Schedule tools (schedule_prompt, list_schedules, cancel_schedule)
4. `computeNextRun` utility + `cron-parser` dependency
5. SchedulerService (polling + execution)
6. Schedules API handlers + routes
7. Frontend: Schedule management UI

### Phase 3: Notifications
1. Schema migration (notifications, notification_deliveries, user_notification_settings, agent_notification_mutes)
2. Models + NotificationRepository interface + Postgres implementation
3. notify_user tool
4. NotificationService (email + webhook delivery)
5. Notifications API handlers + routes
6. Frontend: Notification bell, notification panel, notification settings

### New Dependencies
- `cron-parser` — cron expression parsing for schedule computation
- Email service SDK (Resend, Mailgun, or similar) — for email notifications

---

## Design Decisions & Rationale

**In-process scheduler vs separate worker**: In-process is simpler (no extra dyno/process) and sufficient for V1. The `setTimeout` pattern with `running` flag prevents overlap. If scale demands it later, the `SchedulerService` can be extracted to a separate process with zero code changes — it only depends on repositories and `AgentFactory`.

**Polling vs event-driven**: Polling (every 30s for schedules, 10s for notifications) is simpler and more resilient than event-driven (no message broker needed). The indexed `WHERE next_run_at <= NOW()` query is fast even with thousands of schedules.

**Skills in DB vs filesystem**: DB storage aligns with the existing architecture (multi-user, PostgreSQL-backed). OpenClaw uses filesystem because it's single-user. Our multi-user, multi-agent model needs proper isolation.

**Tool execution is non-streaming for schedules**: Scheduled runs don't need SSE streaming (no client to stream to). Using `run()` without `stream: true` simplifies the scheduler. The agent still has full tool access — it just runs to completion.

**Agent self-scheduling via tool vs API**: Giving the agent a `schedule_prompt` tool is more natural than having it call an API. The tool has access to the current agent context and conversation ID.
