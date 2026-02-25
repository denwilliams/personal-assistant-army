# Personal Assistant Army

A multi-agent AI platform that lets you create, configure, and orchestrate specialized AI assistants with custom tools, memory, and inter-agent communication.

## Features

### 🤖 Multi-Agent System
- Create unlimited AI agents, each with their own purpose and personality
- **Agent Tools**: Call other agents as tools (agent maintains control and receives response)
- **Agent Handoffs**: Transfer control to another agent for specialized tasks
- **Favorites**: Mark favorite agents with star icon and keyboard shortcuts (1-9)
- Unique URL slug per agent (e.g., `/chat/personal-assistant`)
- Prevent circular dependencies with smart handoff validation

### 🧠 Tiered Memory System
- **Three tiers**: Core (permanent, max 10), Working (active context, max 30), Reference (archived, unlimited)
- **Semantic search**: pgvector-powered recall across all tiers using `text-embedding-3-small`
- Auto-demotion of least-recently-used Working memories to Reference
- Promotion hints when Working memories are accessed frequently
- 5 memory tools: `remember`, `recall`, `forget`, `promote_memory`, `demote_memory`
- **Memory Viewer**: View, create, delete, and change tiers from the management UI

### 🔧 Flexible Tool System
**Built-in Tools:**
- **Tiered Memory**: Store and recall information with semantic search across conversations
- **Internet Search**: Powered by Google Custom Search API (opt-in per agent)
- **MQTT**: Publish/subscribe to MQTT topics for IoT and messaging (opt-in per agent)

**MCP Integration:**
- Connect to any MCP (Model Context Protocol) server
- Configure MCP servers at the user level
- Enable/disable MCP tools per agent
- Support for custom headers and authentication

**URL Tools:**
- Configure simple HTTP-based tools (GET, POST, PUT, DELETE, PATCH)
- Custom headers and per-agent enablement

### 📡 MQTT Integration
- Native MQTT pub/sub for IoT and messaging ecosystems
- Configure broker connection (host, port, TLS, credentials) in Profile settings
- Agents can publish commands, subscribe to topics, and react to incoming messages
- **Event triggering**: Incoming MQTT messages trigger agent execution with configurable prompt templates
- MQTT wildcard support (`+` single-level, `#` multi-level)
- Per-subscription rate limiting and conversation modes (new or continue)
- Message buffer with 1-hour retention for recent message lookup
- 5 agent tools: `mqtt_publish`, `mqtt_subscribe`, `mqtt_unsubscribe`, `mqtt_list_subscriptions`, `mqtt_get_recent`

### ⏰ Scheduled Prompts
- Schedule agents to run automatically (one-time, interval, or cron)
- Agents can self-schedule follow-ups using the `schedule_prompt` tool
- Timezone-aware scheduling with user preference
- Execution history and manual trigger support
- Conversation continuation or fresh conversation per execution

### 🔔 Notifications
- Agents can send notifications using the `notify` tool
- Multi-channel delivery: Email, Pushover, Webhooks
- Per-agent muting controls
- Urgency levels (low, normal, high)
- Unread count badge in sidebar

### 📚 Skills
- Reusable procedures and workflows stored as Markdown
- **Agent-scoped**: Skills specific to one agent
- **User-scoped**: Skills shared across all agents
- Agents can create skills via the `create_skill` tool
- On-demand loading to keep context windows lean

### 👥 User Management
- Google OAuth authentication (secure, no passwords)
- Personal agent library per user
- Encrypted API key storage (AES-256-GCM)
- Timezone preferences for personalized agent responses

### 💬 Rich Chat Experience
- Real-time streaming responses with Server-Sent Events
- Markdown rendering with syntax highlighting
- Visual indicators for tool usage and agent handoffs
- Conversation history persistence
- **Keyboard Shortcuts**: Press 1-9 on dashboard to instantly launch favorite agents
- Responsive, modern UI built with React and Tailwind CSS

## Tech Stack

### Backend
- **Runtime**: [Bun](https://bun.sh) - Fast, native TypeScript support
- **Database**: PostgreSQL with Bun's native SQL + pgvector
- **AI**: [OpenAI Agents SDK](https://openai.github.io/openai-agents-js/)
- **MQTT**: [mqtt.js](https://github.com/mqttjs/MQTT.js) for broker connectivity
- **Architecture**: Dependency injection, repository pattern
- **Security**: OAuth 2.0, encrypted secrets, session-based auth

### Frontend
- **Framework**: React 19 with TypeScript
- **Routing**: React Router v7
- **Styling**: Tailwind CSS v4.1 (CSS-first configuration)
- **UI Components**: ShadCN UI
- **Bundling**: Bun's native bundler (no Vite)

### Development
- Hot module reloading with Bun
- Auto-running database migrations
- Native TypeScript - no compilation step
- Environment-based configuration

## Getting Started

### Prerequisites
- [Bun](https://bun.sh) v1.0+
- PostgreSQL database with [pgvector](https://github.com/pgvector/pgvector) extension
- Google OAuth credentials
- OpenAI API key (configured per-user in Profile settings)

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd personal-assistant-army
   ```

2. **Install dependencies**
   ```bash
   bun install
   ```

3. **Set up environment variables**
   ```bash
   cp .env.example .env
   ```

   Edit `.env` and configure:
   - `DATABASE_URL` - PostgreSQL connection string
   - `GOOGLE_CLIENT_ID` - From Google Cloud Console
   - `GOOGLE_CLIENT_SECRET` - From Google Cloud Console
   - `GOOGLE_REDIRECT_URI` - OAuth callback URL
   - `FRONTEND_URL` - Your frontend URL (http://localhost:3000 for dev)
   - `ENCRYPTION_SECRET` - Random 32-byte hex string for encrypting API keys
   - `SESSION_SECRET` - Random string for session signing

   See [GOOGLE_OAUTH.md](./GOOGLE_OAUTH.md) for detailed OAuth setup instructions.

4. **Create the database**
   ```bash
   createdb personal_assistant_army
   ```

   **Install pgvector** (required for semantic memory search):
   ```bash
   # macOS with Homebrew
   brew install pgvector

   # Or use Docker with pgvector pre-installed
   # docker run -d pgvector/pgvector:pg16
   ```

   Migrations run automatically on server start!

5. **Start the development server**
   ```bash
   bun run dev
   ```

   Server starts at http://localhost:3000

## Usage

### Creating Your First Agent

1. **Log in** with Google OAuth
2. **Set up your profile**:
   - Add your OpenAI API key (required)
   - Optionally add Google Search credentials
   - Set your timezone preference
3. **Create an agent**:
   - Navigate to "Agents" page
   - Click "Create New Agent"
   - Configure:
     - Name and purpose
     - System prompt (agent's personality/instructions)
     - Unique slug for the chat URL
     - Enable tools (memory, internet search, MCP servers)
4. **Start chatting** at `/chat/your-agent-slug`

### Example Agent Configurations

**Personal Assistant** (Memory + Search)
```
Name: Personal Assistant
Slug: personal-assistant
Purpose: Help with daily tasks and remember preferences
System Prompt: You are a helpful personal assistant. Remember user
preferences and help them stay organized.

Tools:
✅ Permanent Memory
✅ Internet Search
```

**Research Assistant** (Search only)
```
Name: Research Assistant
Slug: research-assistant
Purpose: Find and summarize information
System Prompt: You are a research assistant. Find accurate, up-to-date
information and cite your sources.

Tools:
✅ Internet Search
```

**Project Manager** (Memory + Handoffs)
```
Name: Project Manager
Slug: project-manager
Purpose: Track project details and coordinate with other agents
System Prompt: Track project milestones, deadlines, and requirements.
Hand off to Research Assistant for technical questions.

Tools:
✅ Permanent Memory

Handoffs:
→ Research Assistant
```

**Home Automation** (MQTT + Memory)
```
Name: Home Controller
Slug: home-controller
Purpose: Monitor and control IoT devices via MQTT
System Prompt: You manage a smart home. Subscribe to sensor topics,
respond to events, and publish commands to control devices.

Tools:
✅ Permanent Memory
✅ MQTT
```

## Architecture

### Backend Structure
```
backend/
├── auth/              # OAuth implementation
├── db/                # Database connection
├── handlers/          # HTTP route handlers
├── middleware/         # Auth, validation middleware
├── migrations/        # Database migrations
├── repositories/      # Data access layer (interfaces)
│   └── postgres/      # PostgreSQL implementations
├── services/          # Business logic
│   ├── AgentFactory   # Creates OpenAI Agent instances from DB config
│   ├── SchedulerService  # Polls and executes scheduled prompts
│   ├── MqttService    # MQTT client management and event triggering
│   ├── NotificationService  # Multi-channel notification delivery
│   ├── EmbeddingService     # OpenAI text embeddings for memory
│   └── DatabaseSession      # Persists conversation turns
├── tools/             # AI agent tools
│   ├── memoryTools    # remember, recall, forget, promote, demote
│   ├── mqttTools      # publish, subscribe, unsubscribe, list, get_recent
│   ├── scheduleTool   # schedule_prompt, list_schedules, cancel_schedule
│   ├── skillTools     # create_skill, load_skill, list_skills
│   ├── notifyTool     # send notification
│   └── urlTool        # HTTP request tool
├── types/             # TypeScript type definitions
└── utils/             # Encryption, helpers
```

### Frontend Structure
```
frontend/
├── src/
│   ├── components/    # Reusable UI components
│   │   └── ui/        # ShadCN components
│   ├── contexts/      # React context (auth)
│   ├── lib/           # API client
│   └── pages/         # Route pages
└── index.html         # Entry point (bundled by Bun)
```

### Database Schema
- **users**: User profiles, encrypted API keys, timezone preferences
- **agents**: Agent configurations, system prompts, favorites
- **agent_memories**: Tiered key-value storage with pgvector embeddings
- **conversations** / **messages**: Chat history with raw SDK data
- **mcp_servers**: User-configured MCP server URLs with custom headers
- **url_tools**: User-configured HTTP tools
- **skills** / **agent_skills**: Reusable agent procedures (agent or user scope)
- **schedules** / **schedule_executions**: Scheduled prompts and execution log
- **notifications** / **notification_deliveries**: Multi-channel notifications
- **user_notification_settings**: Email, Pushover, and webhook configuration
- **mqtt_broker_configs**: MQTT broker connection settings (one per user)
- **mqtt_subscriptions**: Per-agent MQTT topic subscriptions with rate limits
- **mqtt_messages**: Ring buffer of recent MQTT messages (1hr retention)
- **mqtt_event_executions**: MQTT-triggered agent execution log
- **agent_built_in_tools** / **agent_mcp_tools** / **agent_url_tools**: Tool enablement
- **agent_agent_tools** / **agent_handoffs**: Agent-to-agent relationships

**Schema Isolation**: Configure `POSTGRES_SCHEMA` environment variable to use a custom PostgreSQL schema instead of `public`

## API Routes

### Authentication
- `GET /api/auth/login` - Redirect to Google OAuth
- `GET /api/auth/callback` - OAuth callback handler
- `POST /api/auth/logout` - End session

### User Profile
- `GET /api/user/profile` - Get user profile
- `PUT /api/user/profile` - Update profile (name, timezone)
- `PUT /api/user/credentials` - Update API keys

### MCP Servers
- `GET /api/user/mcp-servers` - List MCP servers
- `POST /api/user/mcp-servers` - Add MCP server
- `PUT /api/user/mcp-servers/:id` - Update MCP server
- `DELETE /api/user/mcp-servers/:id` - Remove MCP server

### Agents
- `GET /api/agents` - List user's agents (sorted by favorites first)
- `POST /api/agents` - Create agent
- `GET /api/agents/:slug` - Get agent details
- `PUT /api/agents/:slug` - Update agent
- `DELETE /api/agents/:slug` - Delete agent
- `PATCH /api/agents/:slug/favorite` - Toggle favorite status

### Agent Tools
- `GET /api/agents/:slug/tools` - Get agent's built-in and MCP tools
- `POST /api/agents/:slug/tools/built-in` - Add built-in tool
- `DELETE /api/agents/:slug/tools/built-in/:toolId` - Remove built-in tool
- `POST /api/agents/:slug/tools/mcp` - Add MCP tool
- `DELETE /api/agents/:slug/tools/mcp/:mcpServerId` - Remove MCP tool

### Agent-to-Agent Tools
- `GET /api/agents/:slug/agent-tools` - Get agents configured as tools
- `POST /api/agents/:slug/agent-tools` - Add agent as tool
- `DELETE /api/agents/:slug/agent-tools/:toolAgentSlug` - Remove agent tool

### Agent Handoffs
- `GET /api/agents/:slug/handoffs` - Get handoff configuration
- `POST /api/agents/:slug/handoffs` - Add handoff
- `DELETE /api/agents/:slug/handoffs/:toAgentSlug` - Remove handoff

### Agent Memories
- `GET /api/agents/:slug/memories` - List agent's memories (all tiers + counts)
- `POST /api/agents/:slug/memories` - Create a memory
- `PUT /api/agents/:slug/memories/:key` - Update memory value/tier
- `DELETE /api/agents/:slug/memories/:key` - Delete specific memory
- `PATCH /api/agents/:slug/memories/:key/tier` - Change memory tier

### Skills
- `GET /api/skills` - List user-level skills
- `POST /api/skills` - Create user-level skill
- `PUT /api/skills/:id` - Update skill
- `DELETE /api/skills/:id` - Delete skill
- `GET /api/agents/:slug/skills` - List agent skills
- `POST /api/agents/:slug/skills` - Create agent skill
- `PATCH /api/agents/:slug/skills/:skillId/toggle` - Toggle skill for agent

### Schedules
- `GET /api/schedules` - List all user schedules
- `GET /api/agents/:slug/schedules` - List agent schedules
- `POST /api/agents/:slug/schedules` - Create schedule
- `PUT /api/schedules/:id` - Update schedule
- `DELETE /api/schedules/:id` - Delete schedule
- `PATCH /api/schedules/:id/toggle` - Enable/disable schedule
- `GET /api/schedules/:id/executions` - Get execution history
- `POST /api/schedules/:id/trigger` - Manually trigger schedule

### Notifications
- `GET /api/notifications` - List notifications
- `GET /api/notifications/unread-count` - Get unread count
- `PATCH /api/notifications/:id/read` - Mark as read
- `POST /api/notifications/read-all` - Mark all as read
- `GET /api/user/notification-settings` - Get notification settings
- `PUT /api/user/notification-settings` - Update notification settings
- `POST /api/agents/:slug/notifications/mute` - Mute agent notifications
- `DELETE /api/agents/:slug/notifications/mute` - Unmute agent

### MQTT
- `GET /api/user/mqtt/broker` - Get broker config (credentials masked)
- `PUT /api/user/mqtt/broker` - Upsert broker config
- `DELETE /api/user/mqtt/broker` - Delete broker config and disconnect
- `GET /api/user/mqtt/status` - Get connection status
- `POST /api/user/mqtt/reconnect` - Force reconnect

### Chat
- `POST /api/chat/:slug/stream` - Send message with streaming response (SSE)
- `GET /api/chat/:slug/history` - Get conversation history
- `GET /api/chat/:slug/conversation/:id` - Get specific conversation

## Security

- **OAuth 2.0**: Google-only authentication
- **Encrypted Storage**: API keys encrypted with AES-256-GCM
- **Session Management**: Database-backed sessions with expiration
- **Resource Ownership**: Validated on all operations
- **No Circular Handoffs**: Prevents infinite agent loops

## Development

### Running Tests
```bash
bun test
```

### Database Migrations
Migrations run automatically on server start. To create a new migration, add SQL to `schema.sql`.

### Type Checking
```bash
bun run typecheck
```

## Deployment

### Heroku Deployment

1. **Set up Bun buildpack**:
   ```bash
   heroku buildpacks:set https://github.com/jakeg/heroku-buildpack-bun.git
   ```

2. **Add PostgreSQL addon**:
   ```bash
   heroku addons:create heroku-postgresql:mini
   ```

3. **Configure environment variables**:
   ```bash
   heroku config:set GOOGLE_CLIENT_ID=...
   heroku config:set GOOGLE_CLIENT_SECRET=...
   heroku config:set GOOGLE_REDIRECT_URI=https://yourapp.herokuapp.com/api/auth/callback
   heroku config:set FRONTEND_URL=https://yourapp.herokuapp.com
   heroku config:set ENCRYPTION_SECRET=$(openssl rand -hex 32)
   heroku config:set SESSION_SECRET=$(openssl rand -hex 32)
   heroku config:set POSTGRES_SCHEMA=agentarmy  # Optional: use custom schema
   ```

4. **Deploy**:
   ```bash
   git push heroku main
   ```

The `.buildpacks` file is already configured with the Bun buildpack URL.

See [TODO.md](./TODO.md) for deployment checklist.

## Contributing

See [CLAUDE.md](./CLAUDE.md) for project context and development guidelines.

## Future Enhancements

- Anthropic Claude API support
- Conversation search and filtering
- Agent usage analytics
- Agent sharing between users
- Conversation export
- Conversation branching

## License

MIT
