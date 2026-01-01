# TODO

## Project Setup

- [ ] Initialize Bun project with TypeScript configuration
- [ ] Set up project structure (backend, frontend directories)
- [ ] Configure Vite for React frontend
- [ ] Set up environment variables (.env.example)
- [ ] Configure PostgreSQL connection
- [ ] Set up Heroku deployment configuration (Procfile, etc.)

## Database

- [ ] Design database schema (users, agents, tools, agent_tools, agent_handoffs, etc.)
- [ ] Create database migration system
- [ ] Implement auto-migration on process start
- [ ] Create repository interfaces (UserRepository, AgentRepository, ToolRepository)
- [ ] Implement PostgreSQL repository classes using plain postgres client
- [ ] Add database connection pooling

## Authentication

- [ ] Set up Google OAuth integration
- [ ] Implement OAuth callback handling
- [ ] Create session management
- [ ] Add authentication middleware for protected routes
- [ ] Implement user profile creation on first login

## Backend API

- [ ] Set up Express/Hono server with Bun
- [ ] Configure CORS for development (frontend on different port)
- [ ] Implement `/api/auth/*` routes (login, logout, callback)
- [ ] Implement `/api/user/profile` routes (GET, PUT)
- [ ] Implement `/api/user/credentials` routes (OpenAI key, Google Search credentials)
- [ ] Implement `/api/user/mcp-servers` routes (list, add, remove)
- [ ] Implement `/api/agents` routes (list, create, get, update, delete)
- [ ] Implement `/api/agents/:slug/tools` routes (list, add, remove)
- [ ] Implement `/api/agents/:slug/handoffs` routes (list, add, remove)
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

- [ ] Set up React with TypeScript
- [ ] Configure React Router
- [ ] Set up API client with authentication
- [ ] Implement authentication context/state management
- [ ] Create protected route wrapper
- [ ] Configure Vite for development proxy to backend
- [ ] Configure Vite build for production

## Frontend - Pages & Components

- [ ] Create landing/login page with Google OAuth button
- [ ] Create user profile page
  - [ ] OpenAI API key input (secure)
  - [ ] Google Custom Search credentials input
  - [ ] MCP server URLs management
- [ ] Create agents list page
- [ ] Create agent creation/edit form
  - [ ] Name, purpose, system prompt fields
  - [ ] Agent slug input (unique validation)
  - [ ] Tool selection (built-in tools with toggles)
  - [ ] MCP tools selection (from user's MCP servers)
  - [ ] Internet search toggle
  - [ ] Agent handoff configuration (one-way selection)
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
- [ ] Add example .env file

## Security

- [ ] Implement API key encryption at rest
- [ ] Add rate limiting
- [ ] Validate user owns agent before operations
- [ ] Sanitize user inputs
- [ ] Add CSRF protection
- [ ] Implement secure session storage

## Future Enhancements (Post-MVP)

- [ ] Add Anthropic API support
- [ ] Add agent usage metrics/analytics
- [ ] Implement agent sharing between users
- [ ] Add conversation export functionality
- [ ] Implement webhook notifications
