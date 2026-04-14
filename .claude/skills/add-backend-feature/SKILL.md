---
name: add-backend-feature
description: Use when adding a new backend feature that needs its own table, API, and frontend hookup. Walks through the full repository → handler → route → API client path so nothing is forgotten.
---

# Adding a new backend feature

Assumes a new entity like `Widget`. Follow these steps in order — each step's output is the next step's input. Skip frontend steps if the feature is purely server-side.

## 1. Type definition

Add the row shape to `backend/types/models.ts`:

```ts
export interface Widget {
  id: number;
  user_id: number;
  name: string;
  // … other columns
  created_at: Date;
  updated_at: Date;
}
```

## 2. Schema

Add the table to `schema.sql` (see the `modify-database-schema` skill for the rules — everything must be idempotent). Don't forget indexes on foreign keys and any column the handler filters on.

## 3. Repository interface

Create `backend/repositories/WidgetRepository.ts`:

```ts
import type { Widget } from "../types/models";

export interface CreateWidgetData { user_id: number; name: string; /* … */ }
export interface UpdateWidgetData { name?: string; /* … */ }

export interface WidgetRepository {
  create(data: CreateWidgetData): Promise<Widget>;
  update(id: number, data: UpdateWidgetData): Promise<Widget>;
  delete(id: number): Promise<void>;
  findById(id: number): Promise<Widget | null>;
  listByUser(userId: number): Promise<Widget[]>;
}
```

Keep interfaces lean — only methods the handlers actually call.

## 4. Postgres implementation

Create `backend/repositories/postgres/PostgresWidgetRepository.ts`. Use `Bun.sql` tagged templates (they auto-parametrize):

```ts
import { sql } from "bun";
import type { Widget } from "../../types/models";
import type { WidgetRepository, CreateWidgetData, UpdateWidgetData } from "../WidgetRepository";

export class PostgresWidgetRepository implements WidgetRepository {
  async create(data: CreateWidgetData): Promise<Widget> {
    const result = await sql`
      INSERT INTO widgets (user_id, name)
      VALUES (${data.user_id}, ${data.name})
      RETURNING *
    `;
    return result[0];
  }
  // …
}
```

Reference `PostgresSkillRepository.ts` for the canonical shape.

## 5. Handler

Create `backend/handlers/widgets.ts`. **Always** export a `createWidgetHandlers(deps)` factory. Authenticate first, validate second, then call the repository:

```ts
import type { BunRequest } from "bun";
import type { WidgetRepository } from "../repositories/WidgetRepository";
import type { User } from "../types/models";

interface WidgetHandlerDependencies {
  widgetRepository: WidgetRepository;
  authenticate: (req: BunRequest) => Promise<{ user: User; session: { id: string; userId: number } } | null>;
}

export function createWidgetHandlers(deps: WidgetHandlerDependencies) {
  const list = async (req: BunRequest): Promise<Response> => {
    const auth = await deps.authenticate(req);
    if (!auth) return Response.json({ error: "Unauthorized" }, { status: 401 });
    try {
      const widgets = await deps.widgetRepository.listByUser(auth.user.id);
      return Response.json({ widgets });
    } catch (err) {
      console.error("Error listing widgets:", err);
      return Response.json({ error: "Failed to list widgets" }, { status: 500 });
    }
  };
  // … create, update, delete
  return { list, create, update, remove };
}
```

Use `req.params` for path params when defined via Bun's `/api/widgets/:id` route key. Parse JSON with `await req.json()`. Return `Response.json(...)` — do not hand-build `new Response(JSON.stringify(...))` unless you need special headers.

## 6. Wire into `index.ts`

Three edits in `index.ts`:

1. Import the handler + repository + interface type at the top.
2. In `Dependencies`, add `widgetRepository: WidgetRepository | null;`.
3. After `deps.sql` is initialized in `main()`, add `deps.widgetRepository = new PostgresWidgetRepository();`.
4. In `startServer()`, inside the authenticated section (after `authenticate` is created), add the route registration guarded by `if (deps.widgetRepository) { … }`:

```ts
const widgetHandlers = createWidgetHandlers({
  widgetRepository: deps.widgetRepository,
  authenticate,
});
routes["/api/widgets"] = { GET: widgetHandlers.list, POST: widgetHandlers.create };
routes["/api/widgets/:id"] = { PUT: widgetHandlers.update, DELETE: widgetHandlers.remove };
```

All backend routes **must** start with `/api`.

## 7. Frontend API client

Add typed helpers under `frontend/src/lib/api.ts` inside the `api` object. Mirror the existing `skills` / `urlTools` sections — one `list`/`create`/`update`/`delete` block. Also add the `Widget` TS interface at the top of the file (matching backend shape but with ISO-string dates if that's how the JSON comes across).

## 8. Frontend page (optional)

See the `add-frontend-page` skill.

## 9. Update README

Add the new routes to the "API Routes" section of `README.md` so the documentation stays current.

## 10. Verify

Run `bun run typecheck` and `bun test` before declaring done. See `run-and-verify`.
