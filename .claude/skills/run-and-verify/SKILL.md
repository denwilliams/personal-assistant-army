---
name: run-and-verify
description: Use before declaring a task done. Lists the exact commands for running the dev server, tests, and type checks — and the common pitfalls specific to Bun + this repo.
---

# Running and verifying changes

## Commands (always use Bun — never npm/yarn/pnpm/node)

```bash
bun install                # install deps
bun run dev                # hot-reload dev server on :3000 (alias for: bun --hot index.ts with NODE_ENV=development)
bun run start              # prod-style start (bun --smol index.ts)
bun run build              # produce frontend bundle via build.ts
bun test                   # run all tests in tests/
bun test tests/tools.test.ts      # one file
bun run typecheck          # tsc --noEmit
```

There is no `package-lock.json`; use `bun.lock`. There is no Vite — Bun bundles the frontend via HTML imports.

## Dev server workflow

1. Ensure `DATABASE_URL` is set (PostgreSQL with pgvector). `.env.example` has the full list.
2. `bun run dev` — starts server, runs migrations automatically, serves the React shell + API on the same port.
3. The server boots through `index.ts` → `main()`. Missing env vars degrade gracefully (OAuth/encryption features get disabled with a warning) rather than crashing. If a feature is unexpectedly disabled, look for `console.warn` lines at startup.
4. Demo login is mounted at `/api/auth/demo-login` only when `NODE_ENV=development` — use it to bypass Google OAuth locally.

## Minimum verification before claiming done

For any change that touches TS or TSX:

```bash
bun run typecheck
bun test
```

For changes that touch UI:

- Start `bun run dev`, open the page in a browser, click through the happy path plus one edge case.
- Verify a hard reload on the page's URL still renders (catches missing catch-all routes in `index.ts`).
- Check the terminal running `bun run dev` for errors during interaction.

For changes that touch `schema.sql`:

- Restart the dev server and confirm "Database migrations completed successfully" appears in the logs.
- Running against an existing (live) database must not error — the file is re-executed on every start. See `modify-database-schema`.

For changes that touch agent tools:

- Add/extend a case in `tests/tools.test.ts` that asserts tool names, descriptions, and input schemas (see `add-agent-tool`).

## Common gotchas

- **Don't use `fetch` handler + `routes` together** in `Bun.serve`. The project uses `routes` — keep adding entries there.
- **Env vars must only be read in `main()`** (per CLAUDE.md). If you need a new one, add it to `loadConfig()` in `index.ts` and pass it through `deps`/`config`.
- **Never `import` a file for its side effects.** Factories + classes only. If you need initialization, call it from `main()`.
- **No ORM.** Write SQL in `backend/repositories/postgres/*` using `Bun.sql` template literals (auto-parametrized).
- **Tailwind v4.1** — there is no `tailwind.config.js`. Theme extensions go in `frontend/src/index.css` under `@theme { … }`.
- **ShadCN**: always add via `bunx --bun shadcn@latest add <name>`; never edit `components/ui/*` just to wrap a new prop — extend via composition.
- **API routes must be prefixed `/api`** — anything else is treated as a frontend route and served `indexHtml`.
- **Agent slugs are unique per user**, not globally. Tests/queries must filter by user.

## If something seems broken

- Check `console.warn` lines printed at startup — they list which features couldn't initialize and why.
- Check that `POSTGRES_SCHEMA` (if set) matches where your tables live.
- Check that pgvector is installed in your DB — memory features will fail without it.
