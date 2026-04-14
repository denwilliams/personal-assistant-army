---
name: modify-database-schema
description: Use when adding tables, columns, indexes, or constraints. This repo has no per-migration files — there is one idempotent `schema.sql` that runs on every server start, so every change must be re-runnable without error.
---

# Modifying the database schema

## The model

- There is exactly one schema file: `schema.sql` at the repo root.
- It is executed verbatim by `backend/migrations/migrate.ts` on every server start, against the schema given by `POSTGRES_SCHEMA` (defaults to `public`).
- Therefore **every statement must be idempotent** — a fresh DB and a live DB must both survive running the full file.
- There is no tracking table and no rollback mechanism. You are editing the live schema.

## Idempotent patterns to use

```sql
-- Tables
CREATE TABLE IF NOT EXISTS widgets (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Columns
ALTER TABLE widgets ADD COLUMN IF NOT EXISTS description TEXT;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_widgets_user_id ON widgets(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_widgets_user_name ON widgets(user_id, name);

-- Constraints (wrap in a DO block since there's no IF NOT EXISTS for constraints)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'widgets_name_not_empty'
  ) THEN
    ALTER TABLE widgets ADD CONSTRAINT widgets_name_not_empty CHECK (length(name) > 0);
  END IF;
END $$;

-- Extensions
CREATE EXTENSION IF NOT EXISTS vector;
```

Things to avoid:
- Bare `CREATE TABLE …` or `CREATE INDEX …` without `IF NOT EXISTS`.
- Any statement whose second run would error (e.g. `INSERT` without `ON CONFLICT`).
- `DROP … CASCADE` on a live table. If you truly need destructive changes, flag it and coordinate with the user.

## Conventions already used by this repo

- Primary keys: `SERIAL` (integer) named `id`. Read `schema.sql` and match surrounding tables.
- Timestamps: `TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP` for both `created_at` and `updated_at`.
- User scoping: `user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE`.
- Per-user uniqueness: unique index on `(user_id, <slug|name>)` — slugs are **not** globally unique.
- pgvector: memory embeddings use `vector(1536)` (OpenAI `text-embedding-3-small`). The `vector` extension is created in `schema.sql`.
- Enum-like columns are usually `TEXT` with a `CHECK` constraint listing valid values.

## After editing `schema.sql`

1. Add/update the TypeScript row type in `backend/types/models.ts`.
2. Add/update the repository interface and Postgres implementation.
3. Restart the dev server — migrations run automatically. Watch the logs for the "Database migrations completed successfully" line.
4. If you changed an existing column in an incompatible way (type change, NOT NULL tightening), write the change as a two-step `ALTER` sequence that tolerates old data, and call it out to the user because users in the wild have existing rows.

## Custom schemas

`POSTGRES_SCHEMA` env var lets deployments use a non-`public` schema. `migrate.ts` already `CREATE SCHEMA IF NOT EXISTS` + `SET search_path`. Just make sure all object references in `schema.sql` are unqualified (they are).
