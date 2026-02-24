# Requirements: Autonomous Agent Capabilities

**Status**: Draft - Requirements Discovery
**Date**: 2026-02-24
**Inspiration**: OpenClaw platform architecture
**Next Step**: `/sc:design` for architecture, `/sc:workflow` for implementation planning

---

## 1. Goals

Transform agents from reactive chatbots into proactive, self-improving assistants by adding:

1. **Scheduled Execution** - Agents run on schedules and can schedule their own future runs
2. **Skills System** - Agents load specialized knowledge on-demand from a skill library
3. **Self-Authoring Skills** - Agents autonomously create skills from conversation patterns
4. **Smart Notifications** - Agents decide when and how to alert users

---

## 2. Functional Requirements

### 2.1 Scheduled Execution

#### FR-2.1.1: User-Configured Schedules
- Users can create schedules for any agent via the web UI
- Schedule types:
  - **One-shot**: Run once at a specific date/time (ISO 8601)
  - **Recurring interval**: Run every N minutes/hours/days
  - **Cron expression**: Standard 5-field cron with timezone support
- Each schedule includes:
  - A prompt (the message sent to the agent when triggered)
  - Optional: which conversation to run in (or "start new")
  - Timezone (from user profile)
  - Enabled/disabled toggle

#### FR-2.1.2: Agent Self-Scheduling
- Agents have a `schedule_prompt` tool
- Tool parameters:
  - `prompt`: The message to send to self in the future
  - `schedule`: One-shot timestamp, interval, or cron expression
  - `conversation_mode`: `"continue"` (same conversation) or `"new"` (fresh conversation)
  - `conversation_id`: Required when mode is `"continue"`
  - `description`: Human-readable description of what this schedule does
- Agents can list, update, and cancel their own scheduled prompts
- Scheduled prompts appear in the UI alongside user-configured ones
- User can view, pause, or delete any schedule (including agent-created ones)

#### FR-2.1.3: Schedule Execution
- A scheduler process runs independently (not inside a request handler)
- When a schedule triggers:
  1. Load the agent with full configuration (tools, skills, handoffs)
  2. Set the user's OpenAI API key
  3. Either continue an existing conversation or start a new one
  4. Execute the prompt as if the user sent it
  5. Store the full result in conversation history
- Execution must support streaming (agent may use tools, handoffs, etc.)
- Failed executions are logged with error details and retry policy

#### FR-2.1.4: Schedule Constraints
- Per-user limit on total active schedules (configurable, default: 50)
- Minimum interval of 5 minutes for recurring schedules
- Schedules inherit the agent's full tool set (including skills, memory, etc.)
- Agent-created schedules count toward user's limit

---

### 2.2 Skills System

#### FR-2.2.1: Skill Data Model
- A skill consists of:
  - `name`: Unique identifier (slug format, e.g., `email-drafting`)
  - `summary`: 1-2 sentence description of when to use this skill (included in system prompt)
  - `content`: Full skill instructions in Markdown
  - `scope`: `"agent"` (private to one agent) or `"user"` (shared across all user's agents)
  - `author`: `"user"` or `"agent"`
  - `agent_id`: Set when scope is `"agent"`, null when scope is `"user"`
  - `user_id`: Owner
  - `enabled`: Per-agent toggle (agents can enable/disable skills from the user library)
  - `created_at`, `updated_at`: Timestamps

#### FR-2.2.2: Skill Injection into System Prompt
- At agent creation time, load all enabled skills for that agent
- Append a skills catalog to the system prompt:
  ```
  # Available Skills
  You have specialized skills you can load when needed.
  Only load a skill when a task matches its description.

  - **email-drafting**: Use when composing or editing emails. Covers tone, formatting, and professional conventions.
  - **data-analysis**: Use when analyzing datasets, creating charts, or summarizing numerical data.
  - **code-review**: Use when reviewing code for bugs, style, and best practices.
  ```
- Only summaries are injected (not full content) to keep the system prompt lean
- Maximum skills in catalog: configurable (default: 30)

#### FR-2.2.3: `load_skill` Tool
- Agents have a `load_skill` tool that retrieves full skill content
- Tool parameters:
  - `skill_name`: The slug of the skill to load
- Returns: The full Markdown content of the skill
- The agent then follows the skill's instructions for the current task
- Skills are loaded into the conversation context (not permanently into the system prompt)

#### FR-2.2.4: Skill Management by Users
- Users can create, edit, and delete skills via the web UI
- Users can set skill scope: agent-specific or shared across all agents
- Users can enable/disable skills per agent
- Users can review agent-created skills and edit/delete them

#### FR-2.2.5: Agent-Specific vs User-Level Skills
- **Agent-specific skills** (`scope: "agent"`): Only visible to and loadable by that agent
- **User-level skills** (`scope: "user"`): Appear in all agents' skill catalogs
- Per-agent enable/disable toggle for user-level skills (agent can opt out)
- Agent-created skills default to agent-specific scope
- Users can promote an agent-specific skill to user-level via UI

---

### 2.3 Autonomous Skill Creation

#### FR-2.3.1: `create_skill` Tool
- Agents have a `create_skill` tool
- Tool parameters:
  - `name`: Skill slug (auto-generated if not provided)
  - `summary`: 1-2 sentence description of when to use this skill
  - `content`: Full Markdown instructions
- Skills created by agents default to `scope: "agent"`, `author: "agent"`
- Agent can update or delete its own skills via `update_skill` and `delete_skill` tools

#### FR-2.3.2: Autonomous Creation Behavior
- Agents autonomously create skills when they detect useful patterns
- No user confirmation required before creation
- Examples of autonomous skill creation:
  - Agent notices user always wants code in a specific style → creates a coding-style skill
  - Agent develops a multi-step workflow for a recurring task → saves it as a skill
  - Agent learns user-specific terminology or preferences → codifies as a skill
- Agents should include a note in conversation when they create a skill (transparency)

#### FR-2.3.3: Skill Quality & Deduplication
- Before creating a skill, agent should check existing skills to avoid duplicates
- Agent has a `list_skills` tool to see current skill catalog
- Agent can update existing skills instead of creating duplicates

---

### 2.4 Notification System

#### FR-2.4.1: `notify_user` Tool
- Agents have a `notify_user` tool for proactive communication
- Tool parameters:
  - `message`: The notification content
  - `urgency`: `"low"` | `"normal"` | `"high"`
  - `channels`: Array of `"web"` | `"email"` | `"webhook"` (defaults to `["web"]`)
- Agent decides whether results warrant notification

#### FR-2.4.2: Web UI Notifications
- Notification bell/badge in the web UI
- Notification panel showing recent notifications
- Click-through to the conversation that generated the notification
- Read/unread state
- Notification preferences per agent (user can mute an agent)

#### FR-2.4.3: Email Notifications
- Configurable email address (from user profile)
- Email includes: agent name, message, link to conversation
- Rate limiting: max N emails per agent per hour (configurable, default: 5)
- User can disable email notifications per agent or globally

#### FR-2.4.4: Webhook Notifications
- User-configured webhook URL (from user profile)
- POST request with JSON payload:
  ```json
  {
    "agent_name": "...",
    "agent_slug": "...",
    "message": "...",
    "urgency": "...",
    "conversation_id": "...",
    "timestamp": "..."
  }
  ```
- Webhook failures are logged but don't block the agent
- User can configure multiple webhook URLs

---

## 3. Non-Functional Requirements

### NFR-1: System Prompt Size
- Skill summaries in system prompt must stay under 2000 tokens total
- If too many skills are enabled, truncate by most-recently-used or user priority

### NFR-2: Schedule Reliability
- Scheduled prompts must execute within 60 seconds of their target time
- Failed executions must be retried up to 3 times with exponential backoff
- Execution failures must be visible in UI and logged

### NFR-3: Skill Storage
- Skills stored in database (not filesystem) for multi-instance compatibility
- Skill content size limit: 50KB per skill
- Skill catalog query must be fast (< 100ms) since it runs on every agent creation

### NFR-4: Notification Delivery
- Web notifications: real-time via WebSocket or SSE
- Email: delivered within 5 minutes of trigger
- Webhook: fired within 10 seconds, 3 retries on failure

### NFR-5: Backward Compatibility
- Existing agents continue to work without skills or schedules
- Current memory system remains (skills augment, not replace)
- No migration required for existing conversations

### NFR-6: Security
- Agent-created skills cannot modify other agents' skills
- Scheduled runs use the same auth context as manual runs
- Webhook URLs validated on save (HTTPS only)
- Skill content is sanitized (no script injection via Markdown)

---

## 4. User Stories

### Scheduling
- **US-1**: As a user, I can schedule my finance agent to check my portfolio every weekday at 9am and notify me of significant changes.
- **US-2**: As an agent, I can schedule a follow-up prompt for myself in 2 hours to check if an async task completed.
- **US-3**: As a user, I can view all scheduled prompts (mine and agent-created) and pause or delete them.
- **US-4**: As a user, I can see the execution history of scheduled prompts including any errors.

### Skills
- **US-5**: As an agent, I can see a catalog of available skills in my system prompt and load the relevant one when a task matches.
- **US-6**: As a user, I can create a skill with instructions and assign it to specific agents or share it across all my agents.
- **US-7**: As an agent, I can create a new skill when I notice a pattern the user keeps requesting.
- **US-8**: As a user, I can review skills my agents have created and edit, promote (to shared), or delete them.
- **US-9**: As an agent, I can update an existing skill with improved instructions based on new conversations.

### Notifications
- **US-10**: As an agent running on a schedule, I can decide whether my findings are worth notifying the user about.
- **US-11**: As a user, I can see a notification feed in the web UI with unread badges.
- **US-12**: As a user, I can configure a webhook URL so my agent notifications go to Slack/Discord.
- **US-13**: As a user, I can mute notifications from a specific agent without disabling its schedules.

---

## 5. Acceptance Criteria

### Scheduling
- [ ] User can create one-shot, interval, and cron schedules via UI
- [ ] Agent can self-schedule via `schedule_prompt` tool
- [ ] Scheduled runs execute within 60s of target time
- [ ] Agent chooses between new conversation and continuing existing one
- [ ] Execution history visible in UI with success/failure status
- [ ] User can pause/resume/delete any schedule

### Skills
- [ ] System prompt includes skill summaries (not full content)
- [ ] Agent can load full skill content via `load_skill` tool
- [ ] Agent can create, update, delete its own skills
- [ ] Skills can be agent-scoped or user-scoped
- [ ] User can manage skills via UI (CRUD + per-agent toggle)
- [ ] Existing agents work unchanged (backward compatible)

### Notifications
- [ ] Agent can send notifications via `notify_user` tool
- [ ] Web UI shows notification feed with unread count
- [ ] Email notifications delivered with rate limiting
- [ ] Webhook notifications fire with retry logic
- [ ] User can mute notifications per agent

---

## 6. Open Questions

1. **Scheduler infrastructure**: Should the scheduler be a separate process (worker), or integrated into the main Bun server? A separate worker is more reliable but adds deployment complexity on Heroku (separate dyno).

2. **Skill versioning**: Should skills have version history? Useful if agents autonomously update skills and the user wants to revert.

3. **Skill size limits**: 50KB per skill is generous. Should there be a total storage limit per user?

4. **Notification storage**: How long to retain notifications? 30 days? Configurable?

5. **Agent spending**: Scheduled runs consume OpenAI API tokens. Should there be budget controls (e.g., max tokens per schedule per day)?

6. **Skill sharing (V2)**: When community sharing is added, what's the trust model? Curated vs. open marketplace?

7. **Memory vs. Skills**: Current memory is key-value facts. Skills are procedural knowledge. Should the agent have guidance on when to use `remember` (facts) vs. `create_skill` (procedures)?

---

## 7. V1 Scope Summary

**In scope**:
- User-configured + agent self-scheduling
- Skills system with per-agent + per-user scope
- Autonomous skill creation by agents
- `load_skill`, `create_skill`, `update_skill`, `delete_skill`, `list_skills` tools
- `schedule_prompt`, `list_schedules`, `cancel_schedule` tools
- `notify_user` tool with web + email + webhook channels
- Web UI for managing schedules, skills, and notifications

**Out of scope (V2+)**:
- Community/shared skill library
- Skill marketplace / publishing
- Heartbeat system (periodic check-in without specific prompt)
- Skill analytics (usage tracking, effectiveness scoring)
- Multi-agent skill collaboration
