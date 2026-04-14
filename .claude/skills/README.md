# Project skills

These skills live in `.claude/skills/` and are auto-discovered by Claude Code. Each subdirectory is one skill, with a `SKILL.md` front-matter file describing when to use it.

| Skill | When to use |
| --- | --- |
| [navigate-project](./navigate-project/SKILL.md) | Orient in the repo, find where code lives, recall the cross-cutting rules (DI, Bun-only, no ORM, `/api` prefix). |
| [add-backend-feature](./add-backend-feature/SKILL.md) | Add a new feature end-to-end: schema → repository → handler → route wiring → API client. |
| [add-agent-tool](./add-agent-tool/SKILL.md) | Add a new built-in tool that AI agents can call (like `remember`, `notify_user`). |
| [add-frontend-page](./add-frontend-page/SKILL.md) | Add a new React page — page file, routes, sidebar, API client, and the server-side catch-all. |
| [modify-database-schema](./modify-database-schema/SKILL.md) | Change `schema.sql`. Everything must be idempotent because the file is re-run on every start. |
| [run-and-verify](./run-and-verify/SKILL.md) | Run the dev server, tests, and type checks before declaring a task done. |

The project-wide rules (Bun-first, dependency injection, no ORM, Tailwind v4 CSS-first) are defined in [`CLAUDE.md`](../../CLAUDE.md) at the repo root.
