---
name: navigate-project
description: Use when orienting in this repo, deciding where to put new code, or answering "where does X live?" Explains the directory layout, the dependency-injection entry point, and the hard rules from CLAUDE.md that apply across every change.
---

# Navigating Personal Assistant Army

## Tech stack at a glance

- **Runtime**: Bun (native TS, no compile step). **Never** use `node`, `npm`, `pnpm`, `yarn`, `ts-node`, or `vite` — always the `bun` equivalents (`bun install`, `bun run <script>`, `bunx <pkg>`, `bun test`).
- **HTTP**: `Bun.serve({ routes })` in `index.ts`. Always use the `routes` config — do not replace it with a `fetch` handler.
- **DB**: PostgreSQL via `Bun.sql` (`import { sql } from "bun"`). No ORM. Custom repository pattern.
- **Frontend**: React 19 + TypeScript, bundled by Bun via HTML imports (`import indexHtml from "./frontend/index.html"`). No Vite.
- **Styling**: Tailwind v4.1 CSS-first (no `tailwind.config.js`). Configured in `bunfig.toml` via `bun-plugin-tailwind`. Tailwind is imported from `frontend/src/index.css` with `@import "tailwindcss";`.
- **UI**: ShadCN components under `frontend/src/components/ui/`. Add more via `bunx --bun shadcn@latest add <name>`.
- **AI**: `ai` + `@ai-sdk/openai` / `@ai-sdk/anthropic` / `@ai-sdk/google`, plus `ToolLoopAgent` from `ai`.

## The entry point

`index.ts` (project root) is the **only** top-level execution site. Everything starts from `main()`:

1. Reads env vars into a `Config` (env is ONLY read here — never in handlers/repos/services).
2. Constructs a `Dependencies` bag: repositories, `AgentFactory`, background services (`SchedulerService`, `NotificationService`, `MqttService`).
3. Calls `runMigrations(sql)` which executes the idempotent `schema.sql`.
4. Passes `config` and `deps` into `startServer()`, which wires every HTTP route.

**Rule**: Importing a file must never have side effects. No top-level `new X()`, no top-level env reads, no listening sockets — everything is a factory (`createXHandlers(deps)`) or a class constructor.

## Directory map

```
/
├── index.ts                    # main() entry, DI composition root, routes
├── schema.sql                  # single idempotent migration (runs on start)
├── build.ts                    # Bun production build for frontend
├── bunfig.toml                 # Bun plugins (tailwind)
├── package.json                # scripts: dev, start, build, test, typecheck
├── CLAUDE.md                   # project rules — read before big changes
├── README.md                   # user-facing docs + API route table
├── frontend/
│   ├── index.html              # entry (Bun bundles scripts + CSS)
│   └── src/
│       ├── App.tsx             # BrowserRouter + route table
│       ├── main.tsx            # React root
│       ├── index.css           # @import "tailwindcss" + CSS variables
│       ├── components/
│       │   ├── AppLayout.tsx   # Shell with sidebar
│       │   ├── AppSidebar.tsx  # NAV_ITEMS lives here
│       │   └── ui/             # ShadCN components
│       ├── contexts/           # AuthContext
│       ├── hooks/              # use-mobile, useUnreadNotificationCount
│       ├── lib/
│       │   ├── api.ts          # single API client — extend `api` object here
│       │   └── utils.ts
│       └── pages/              # one page per route
├── backend/
│   ├── auth/                   # google-oauth.ts + types
│   ├── db/connection.ts        # initializeDatabase, executeRawSql
│   ├── handlers/               # HTTP handlers. Each exports createXHandlers(deps)
│   ├── middleware/auth.ts      # createAuthMiddleware → authenticate(req)
│   ├── migrations/migrate.ts   # runs schema.sql
│   ├── repositories/           # INTERFACES only (AgentRepository.ts, …)
│   │   └── postgres/           # Concrete Bun.sql implementations
│   ├── services/               # Business logic (AgentFactory, Scheduler, Mqtt, …)
│   ├── tools/                  # AI agent tool factories (memoryTools, mqttTools, …)
│   ├── types/
│   │   ├── models.ts           # DB row types (User, Agent, Skill, …)
│   │   └── sql.ts              # SqlClient alias
│   ├── utils/                  # encryption, schedule helpers
│   └── workflows/              # WorkflowEngine + parser + gate-evaluator
├── tests/                      # bun:test suites
├── lib/utils.ts                # `cn()` helper for frontend (path alias @/)
├── docs/                       # design + requirements
└── .claude/skills/             # these skills
```

## Cross-cutting rules

1. **Dependency injection everywhere.** Factories take a `deps` object and return handler functions; classes take deps in their constructor. Don't reach for globals.
2. **No ORM.** Repositories are hand-written Bun.sql. Interface lives in `backend/repositories/X.ts`, implementation in `backend/repositories/postgres/PostgresX.ts`.
3. **All backend routes start with `/api`.** Non-API paths (`/`, `/chat/:slug`, …) return `indexHtml` so React Router can handle them.
4. **Migrations = `schema.sql`.** It is executed on every start and must be idempotent (`CREATE TABLE IF NOT EXISTS`, `ALTER TABLE … IF NOT EXISTS`, etc.). See skill `modify-database-schema`.
5. **Encryption**: user credentials (OpenAI key, Google keys, MQTT creds) are AES-256-GCM-encrypted at rest. `config.encryptionSecret` is decrypted inside handlers/services — never persist decrypted values.
6. **Path alias**: `@/` resolves to the frontend src (see `tsconfig.json` / `components.json`). Use `@/components/ui/button` style imports in frontend code.
7. **Auth**: Google OAuth only. Protected handlers receive `authenticate: (req) => Promise<{ user, session } | null>` via their deps, call it first, return 401 if null. See `backend/middleware/auth.ts`.
8. **Agent slugs are unique per user**, not globally. Handoffs are one-way (no cycles).
9. **Internet search is opt-in per agent** (requires user-provided Google Custom Search creds).

## When in doubt

- Specific API route? See the "API Routes" section of `README.md`.
- How things are wired? Read `index.ts` top-to-bottom — it's the spec.
- Project rules the user cares about? `CLAUDE.md` is the source of truth; it overrides default behavior.
