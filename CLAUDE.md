# Corta – conventions

Personal idea knowledge base (single user, self-hosted on a NAS). Capture an idea, AI rewrites/classifies it, user validates, then tracks ideas per project (todo / in_progress / done).

## Migration in progress (Python → Next.js)
The product owner chose Next.js (msg #82). The new app lives in `web/`. The Python app (`app/`, `tests/`, root `Dockerfile`) stays deployable as plan B and is **frozen (bug fixes only)** until N4 removes it. Both use the same SQLite file and schema.

## Stack (`web/`)
- Next.js 16 (App Router), React 19, TypeScript **strict**, no component library. Node 20.
- Dependencies at the strict minimum: `better-sqlite3` (pinned to `^11`: v12+ has no Node 20 prebuilt binary and needs make/g++). Adding another dependency needs a team discussion first.
- SQLite via `better-sqlite3`, hand-written SQL in `web/lib/db/`, no ORM.
- Tests: `node:test` through `tsx` (`npm test` in `web/`). Also run `npm run typecheck` and `npm run build` before a PR and attach the test output.
- AI (N3): Claude API called server-side only, never from the browser. `ANTHROPIC_API_KEY` must never reach client code.
- Next 16 calls the middleware file `proxy.ts` (Node runtime): `web/proxy.ts` handles auth.

## Layout (`web/`)
`app/` (pages, route handlers under `app/api/`), `lib/config.ts`, `lib/auth/` (password, session, limiter), `lib/db/` (`index.ts` connect + migrate, `queries.ts`, `migrations/NNN_name.sql`), `lib/types.ts`, `proxy.ts`, `instrumentation.ts` (startup checks), `tests/`. `data/` at the repo root is gitignored (SQLite file `data/app.db`).

## Conventions
- Code, comments, commits in English; UI text in French.
- Branches are named `task/<id>-<slug>` by the tooling, one per task. One approval is enough to merge (squash). After a rebase, force-push your own task branch; no `-s ours` merges.
- Strict typing: no `any`, annotate exported functions.
- Routes under `/api/` return JSON and get 401 when unauthenticated; other routes redirect (303) to `/login`. Public paths are listed in `proxy.ts` (`/login`, `/api/login`, `/healthz`): keep that list minimal.
- Login failures: 5 per 15 min, then 429 (even with the right password). The limiter is in memory. Without `TRUST_PROXY=1` there is one global bucket (X-Forwarded-For is spoofable).

## Database rules
- Every connection via `connect()` in `lib/db` (sets `PRAGMA foreign_keys = ON`).
- Always parameterized queries (`?`); never format values into SQL.
- Schema changes = a new `NNN_name.sql` migration, never edit an applied one. The runner records versions in `schema_migrations` (same table as the Python runner), is idempotent, and runs each migration in a transaction. The `schema_migrations` table is created by the runner, not by the migration files.
- `updated_at` is maintained by the **query layer** (no trigger): every `UPDATE ideas` must set `updated_at = datetime('now')` (see `lib/db/queries.ts`). Dates are UTC text.
- Deleting a project sets its ideas' `project_id` to NULL (Inbox).

## Environment variables
`APP_PASSWORD` (required, not `change-me`), `SESSION_SECRET` (required, ≥ 32 chars), `DATA_DIR` (default `./data`), `COOKIE_SECURE` (1 behind HTTPS), `TRUST_PROXY` (1 behind a trusted reverse proxy), `ANTHROPIC_API_KEY` (optional; without it ideas go to the Inbox). The app exits at startup on an invalid configuration. No secret in the repo; see `.env.example`.

## Legacy Python app (`app/`)
Python 3.12 stdlib only, `python3 -m app.server`, tests with `python3 -m unittest`. Same rules for the database. To be deleted in N4.
