# Winnipeg ER Tracker

## Project shape

- `scrape_wait_times.py` — Playwright scraper that reads live wait times from the WRHA site.
- `scheduler.py` — runs the scraper on an interval and upserts results into Supabase (`requirements.txt`).
- `schema.sql` / `functions.sql` — Supabase/Postgres schema and RPC functions.
- `server.js` — Express API (root `package.json`) that reads from Supabase and serves `/api/hospitals` and `/api/wait-times/*` to the frontend.
- `frontend/` — Vite + React dashboard. Talks only to the Express API via `frontend/src/lib/api.js`, never directly to Supabase.

## Code cleanup rules

Always follow these before considering a task complete:

- Write modular code — small, single-purpose functions/components; no god-files.
- Run standard linting/formatting for the language in use (e.g. `eslint` for JS/JSX, standard Python style) before finishing.
- Remove unused imports and dead code rather than leaving them commented out.
- Delete any temporary/debugging `console.log` (or `print`) statements added while developing — don't leave them in committed code.

## Design decisions

- Theming uses shadcn/ui's `.dark`-class-based mechanism exclusively as the single source of truth. Do not use `@media (prefers-color-scheme: dark)` for theming — when merging or touching CSS theme tokens in `frontend/src/index.css`, remove conflicting `@media` dark-mode blocks and duplicate/legacy variables (e.g. old hex-based `--border`, `--accent`, etc.) rather than keeping both mechanisms side by side.

## Environment

- Backend secrets live in root `.env` (see `.env.example`): `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `FRONTEND_ORIGIN`, `PORT`, `NODE_ENV`, `SCRAPE_INTERVAL_MINUTES`.
- Frontend config lives in `frontend/.env.local`: `VITE_API_URL` (points at the Express API, default `http://localhost:4000`).
