# TODO

## Project Setup

- [x] Initialize Bun project with TypeScript configuration
- [x] Set up project structure (backend, frontend directories)
- [x] Set up Bun.serve() with HTML imports (using Bun's native bundler instead of Vite)
- [x] Set up environment variables (.env.example)
- [x] Create basic React app structure
- [x] Add npm scripts for dev/start/test
- [x] Configure PostgreSQL connection (Bun's native sql support)
- [x] Set up Tailwind CSS v4.1 with bun-plugin-tailwind
- [x] Set up ShadCN UI components
- [ ] Set up Heroku deployment configuration (Procfile, etc.)

## Database

- [x] Design database schema (users, agents, tools, agent_tools, agent_handoffs, etc.)
- [x] Create database migration system
- [x] Create repository interfaces (UserRepository, AgentRepository, ToolRepository)
- [x] Implement PostgreSQL repository classes using Bun's native sql
- [x] Implement auto-migration on process start (integrate into index.ts)
- [x] Add database connection pooling (Bun native)
- [x] Add API key encryption/decryption utilities (AES-256-GCM)

## Authentication

- [x] Set up Google OAuth integration
- [x] Implement OAuth callback handling
- [x] Create session management (SessionRepository)
- [x] Add authentication middleware for protected routes
- [x] Implement user profile creation on first login (auto-created in callback)
- [x] Add GOOGLE_OAUTH.md setup guide

## Backend API

- [x] Set up Bun.serve() with routes
- [x] Add request/response helpers and middleware (auth middleware)
- [x] Implement `/api/auth/*` routes (login, logout, callback)
- [x] Implement `/api/user/profile` routes (GET, PUT)
- [x] Implement `/api/user/credentials` routes (OpenAI key, Google Search credentials)
- [x] Implement `/api/user/mcp-servers` routes (list, add, remove)
- [x] Implement `/api/agents` routes (list, create, get, update, delete)
- [x] Implement `/api/agents/:slug/tools` routes (get, add/remove built-in & MCP tools)
- [x] Implement `/api/agents/:slug/handoffs` routes (get, add, remove)
- [ ] Implement `/api/chat/:slug` WebSocket/SSE endpoint for agent conversations
- [ ] Add static file serving for production frontend build

## Agent System

- [ ] Integrate OpenAI Agents SDK
- [ ] Implement agent factory (creates agents from database config)
- [ ] Implement permanent memory tool
- [ ] Implement internet search tool (Google Custom Search API)
- [ ] Implement MCP server integration
- [ ] Implement agent handoff system
- [ ] Add circular dependency prevention for agent handoffs
- [ ] Implement streaming responses from agents
- [ ] Add conversation history persistence

## Frontend - Core

- [x] Set up React with TypeScript
- [x] Configure React Router
- [x] Set up API client with authentication
- [x] Implement authentication context/state management
- [x] Create protected route wrapper

## Frontend - Pages & Components

- [x] Create landing/login page with Google OAuth button
- [x] Create dashboard page with navigation
- [x] Create user profile page
  - [x] OpenAI API key input (secure)
  - [x] Google Custom Search credentials input
  - [x] MCP server URLs management
- [x] Create agents list page
- [x] Create agent creation/edit form
  - [x] Name, purpose, system prompt fields
  - [x] Agent slug input (unique validation)
  - [x] Internet search toggle
  - [x] Tool selection (built-in tools with toggles)
  - [x] MCP tools selection (from user's MCP servers)
  - [x] Agent handoff configuration (one-way selection)
- [ ] Create chat interface for each agent (`/chat/:slug`)
  - [ ] Message input/output
  - [ ] Streaming response display
  - [ ] Conversation history
  - [ ] Visual indication of agent handoffs

## Testing

- [ ] Set up testing framework
- [ ] Write repository tests
- [ ] Write API endpoint tests
- [ ] Write authentication tests
- [ ] Write agent creation/handoff tests
- [ ] Write frontend component tests

## Documentation

- [ ] Document API endpoints
- [ ] Document repository interfaces
- [ ] Add setup instructions to README
- [ ] Document deployment process
- [x] Add example .env file

## Security

- [x] Implement API key encryption at rest (AES-256-GCM)
- [x] Validate user owns resources before operations (MCP servers, agents, tools)
- [x] Implement secure session storage (database-backed)
- [x] Prevent self-handoff loops
- [ ] Add rate limiting
- [ ] Sanitize user inputs
- [ ] Add CSRF protection for state-changing operations

## Future Enhancements (Post-MVP)

- [ ] Add Anthropic API support
- [ ] Add agent usage metrics/analytics
- [ ] Implement agent sharing between users
- [ ] Add conversation export functionality
- [ ] Implement webhook notifications
