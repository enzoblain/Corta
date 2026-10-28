# Corta – conventions

Personal idea knowledge base (single user, self-hosted on a NAS). Capture an idea, AI rewrites/classifies it, user validates, then tracks ideas per project (todo / in_progress / done).

## Stack
- Python 3.12, **standard library only** (no pip dependency). Adding a micro-lib needs a team discussion first.
- `http.server.ThreadingHTTPServer` + home-made router (`app/router.py`), server-side HTML via `string.Template` (`app/templates.py`, everything escaped unless wrapped in `Safe`), a bit of vanilla JS.
- SQLite via `sqlite3`, hand-written SQL, no ORM. Tests: `python3 -m unittest`.
- AI (T3): Claude API called server-side only through `urllib`, never from the browser.

## Layout
`app/` (server.py, router.py, auth.py, config.py, templates.py, db/, templates/, static/), `app/db/migrations/NNN_name.sql`, `tests/`, `data/` (gitignored, SQLite file).

## Conventions
- Code, comments, commits in English; UI text in French.
- Branch `task-<id>-<slug>`, one task per branch, one approval is enough to merge. Run `python3 -m unittest` before a PR and attach the output.
- Strict typing: annotate all functions.
- Routes under `/api/` return JSON and get 401 when unauthenticated; other routes redirect to `/login`. Routes are private unless registered with `public=True`.

## Database rules
- Every connection via `app.db.connect()` (sets `PRAGMA foreign_keys = ON`).
- Always parameterized queries (`?`); never format values into SQL.
- Schema changes = a new `NNN_name.sql` migration, never edit an applied one. The runner records versions in `schema_migrations` and is idempotent.
- `updated_at` is maintained by the **query layer** (no trigger): every `UPDATE ideas` must set `updated_at = datetime('now')` (see `app/db/queries.py`). Dates are UTC text.
- Deleting a project sets its ideas' `project_id` to NULL (Inbox).

## Environment variables
`APP_PASSWORD` (required), `SESSION_SECRET` (required, random), `DATA_DIR` (default `./data`), `HOST`, `PORT`, `COOKIE_SECURE` (1 behind HTTPS). Later: `ANTHROPIC_API_KEY`. No secret in the repo; see `.env.example`.
