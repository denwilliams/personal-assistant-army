# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Personal Assistant Army is a multi-agent AI platform that allows users to create and manage multiple AI agents with custom configurations, tools, and inter-agent communication capabilities.

## Tech Stack

- **Backend**: TypeScript with Bun runtime (native TypeScript support, no compilation needed)
- **Frontend**: React with Vite
- **Database**: PostgreSQL with custom repository pattern (NO ORM)
- **AI Provider**: OpenAI Agents SDK (TypeScript version)
- **Authentication**: Google OAuth only
- **Deployment Target**: Heroku

## Architecture Principles

### Backend/Frontend Split
- All backend routes MUST be prefixed with `/api`
- In development: Frontend runs on separate port, connects to backend via localhost
- In production: Frontend pre-built and served as static HTML by backend

### Database Access Pattern
**CRITICAL**: Do NOT use an ORM. Instead:
- Define repository interfaces with methods like `listAgents()`, `addAgentTool()`, `removeAgentTool()`
- Implement concrete PostgreSQL repository classes using plain postgres client
- This allows for query optimization and direct control

### Database Migrations
- Migration tools must automatically run on process start
- Ensure migrations are idempotent and version-tracked

### Agent System
- Uses OpenAI Agents SDK: https://openai.github.io/openai-agents-js/ (npm package: `@openai/agents`)
- Agent handoffs via built-in tools: https://openai.github.io/openai-agents-js/guides/handoffs/
- Each user has isolated set of agents
- Each agent has a unique slug per user (e.g., `/chat/calendar-assistant`)
- Agents have one-way communication links to prevent circular dependencies

### Tools & Integrations
- Built-in tools: Permanent memory, Internet search (opt-in per agent)
- External tools: MCP server URLs configured at user level, enabled per agent
- Internet search requires Google Custom Search JSON API credentials (user-configured)

### User Profile Configuration
- OpenAI API key (required, user-provided)
- Google Custom Search credentials (optional, for internet search)
- MCP server URLs with per-agent toggle controls

## Key Constraints

- Authentication restricted to Google OAuth only
- Currently OpenAI-only (Anthropic support planned)
- Agent slugs must be unique per user, not globally
- Agent communication is one-way to prevent loops
- Internet search is OFF by default for each agent
