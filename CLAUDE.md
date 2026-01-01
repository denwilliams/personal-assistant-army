# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Personal Assistant Army is a multi-agent AI platform that allows users to create and manage multiple AI agents with custom configurations, tools, and inter-agent communication capabilities.

## Tech Stack

- **Backend**: TypeScript with Bun runtime (native TypeScript support, no compilation needed)
- **Frontend**: React with TypeScript
- **Bundling**: Bun's native HTML imports and bundler (NO Vite - use Bun's built-in features)
- **Styling**: Tailwind CSS v4.1 (CSS-first configuration with `@theme`, no `tailwind.config.js`)
- **UI Components**: ShadCN UI (installed via `bunx --bun shadcn@latest`)
- **Database**: PostgreSQL with custom repository pattern (NO ORM)
- **AI Provider**: OpenAI Agents SDK (TypeScript version)
- **Authentication**: Google OAuth only
- **Deployment Target**: Heroku

## Architecture Principles

### Dependency Injection
**CRITICAL**: Follow dependency injection principles throughout the codebase:
- Nothing should be instantiated or started just by requiring/importing a file
- All entry point files (like `index.ts`) must have a `main()` function that is the only top-level code execution
- Environment variables should ONLY be accessed in the `main()` function to keep configuration central
- Dependencies should be created in `main()` and passed down to functions/classes that need them
- This makes code testable, maintainable, and prevents side effects from imports

### Bun Native Features
**CRITICAL**: Use Bun's built-in capabilities instead of external tools:
- **Bundling**: Use Bun's HTML imports (`import indexHtml from "./index.html"`) instead of Vite
  - Run dev server: `bun ./index.html`
  - Production build: `bun build ./index.html --minify --outdir=dist`
  - Automatic bundling of TypeScript, JSX, CSS, and assets
  - Zero configuration required
- **HTTP Server**: Use `Bun.serve()` with `routes` configuration (PREFERRED)
  - **ALWAYS use `routes` config** instead of manual `fetch` handlers
  - Example:
    ```typescript
    Bun.serve({
      routes: {
        "/": indexHtml,
        "/api/health": {
          GET: () => new Response(JSON.stringify({ status: "ok" }))
        }
      }
    })
    ```
  - DO NOT replace `routes` with a `fetch` handler - the routes config is cleaner and preferred
- **Database**: Use `Bun.sql` for PostgreSQL queries (no ORM)
- **File I/O**: Use `Bun.file()` for file operations
- **Benefits**: Faster builds, fewer dependencies, native TypeScript support

### Tailwind CSS v4.1 Setup
**CRITICAL**: Tailwind v4 uses CSS-first configuration with Bun plugin:
- **NO `tailwind.config.js` file** - all configuration is in CSS using `@theme` directive
- Install: `bun add -d bun-plugin-tailwind tailwindcss`
- Configure in `bunfig.toml`:
  ```toml
  [serve.static]
  plugins = ["bun-plugin-tailwind"]
  ```
- In your main CSS file, import Tailwind:
  ```css
  @import "tailwindcss";
  ```
- Add ShadCN CSS variables in `@layer base` for component styling
- Automatic content detection (no need to configure content paths)
- Reference: https://ui.shadcn.com/docs/installation/manual

### ShadCN UI Setup
- Initialize: `bunx --bun shadcn@latest init`
- Add components: `bunx --bun shadcn@latest add button`
- Import: `import { Button } from "@/components/ui/button"`
- Components are copied into your project (not installed as dependencies)
- Fully customizable and type-safe
- Reference: https://ui.shadcn.com/docs/installation

### Backend/Frontend Split
- All backend routes MUST be prefixed with `/api`
- In development: Use Bun's HTML import to serve frontend alongside backend
- In production: Frontend pre-built and served as static HTML by backend using `Bun.serve()`

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
