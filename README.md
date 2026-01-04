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

### 🧠 Permanent Memory
- Agents can remember information across conversations using the `remember` tool
- Memories are automatically loaded and displayed in agent instructions
- **Memory Viewer**: View and delete agent memories from the management UI
- Timestamped memory entries with timezone-aware formatting
- Each agent maintains its own isolated memory storage

### 🔧 Flexible Tool System
**Built-in Tools:**
- **Permanent Memory**: Store and recall information across conversations
- **Internet Search**: Powered by Google Custom Search API (opt-in per agent)

**MCP Integration:**
- Connect to any MCP (Model Context Protocol) server
- Configure MCP servers at the user level
- Enable/disable MCP tools per agent
- Support for custom headers and authentication

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
- **Database**: PostgreSQL with Bun's native SQL
- **AI**: [OpenAI Agents SDK](https://openai.github.io/openai-agents-js/)
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
- PostgreSQL database
- Google OAuth credentials
- OpenAI API key

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

## Architecture

### Backend Structure
```
backend/
├── auth/              # OAuth implementation
├── db/                # Database connection
├── handlers/          # HTTP route handlers
├── middleware/        # Auth, validation middleware
├── migrations/        # Database migrations
├── repositories/      # Data access layer
│   └── postgres/      # PostgreSQL implementations
├── services/          # Business logic (AgentFactory)
├── tools/             # AI agent tools (memory, etc.)
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
- **users**: User profiles, encrypted API keys, preferences
- **agents**: Agent configurations, system prompts, favorites
- **agent_memories**: Persistent key-value storage per agent
- **conversations**: Chat history
- **messages**: Individual messages with metadata
- **mcp_servers**: User-configured MCP server URLs
- **agent_built_in_tools**: Agent-to-tool relationships
- **agent_mcp_tools**: Agent-to-MCP relationships
- **agent_agent_tools**: Agent-to-agent tool relationships (call as tool)
- **agent_handoffs**: Agent-to-agent handoff relationships (transfer control)

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
- `GET /api/agents/:slug/memories` - List agent's permanent memories
- `DELETE /api/agents/:slug/memories/:key` - Delete specific memory

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
Migrations run automatically on server start. To create a new migration, add SQL to `backend/schema.sql`.

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
- Memory management UI
- Conversation branching

## License

MIT
