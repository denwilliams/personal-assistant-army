# Personal Assistant Army

## Purpose

Easily create multiple AI agents with their own name, purpose, system prompt and tool access.

The user will be able to log in and add agents just for them.

On their profile they can add their own OpenAI API key (in the future Anthropic).

On their profile the user can set up credentials for internet search using Google Custom Search JSON API. This enables the ability to turn on internet search for each AI agent. Internet search should be off by default for each agent.

Each agent will have a list of other agents they are allowed to talk to. This is a one way link and used to prevent any circular issues that may arise. To configure this on each agent there will be a list of all other agents with toggles beside them.

Tools include a limited number of built in general purpose tools like permanent memory tool, internet search tool. All other tools need to be added as MCP URLs.

MCP server URLs can be connected in the user's profile then on each agent a list of toggles to choose the tools enabled for each agent.

## Design Considerations and Constraints

- For now only OpenAI is used, in the future Anthropic and maybe others will be added
- For OpenAI it should use the official Agents SDK - https://platform.openai.com/docs/guides/agents-sdk
- We will use the Typescript version of the Agents SDK - https://openai.github.io/openai-agents-js/
- For now since we only use OpenAI we can use the built in agent handover tools - https://openai.github.io/openai-agents-js/guides/handoffs/
- Each user has their own set of agents, each agent has a slug that is unique for the user. The slug is used so each agent has their own path, eg `/chat/calendar-assistant`
- Restrict authentication to Google OAuth only - no passwords or any other auth type

## Architecture

- Typescript backend using Bun which has native typescript support so no compilation required
- React frontend built with Vite. For development it should run and connect to the backend using localhost on a different port. For production it should be pre-built and served as static HTML by the backend. This means backend routes should all be prefixed with /api
- It is intended this will be deployable to Heroku
- Do NOT use an ORM for database access. Instead define repository interfaces with methods like `listAgents` and `addAgentTool` `removeAgentTool` which are implemented in a concrete postgres repo class using a plain postgres client. This will allow queries to be better optimised.
- Need tools to create database migrations. These tools should automatically be run on process start.
