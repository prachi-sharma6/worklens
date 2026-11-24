# WorkLens — notes for Claude Code sessions

Internal work-measurement app (viaSocket challenge). Build spec is phased; status lives in `PROGRESS.md`.

## Run
- `npm install` — installs all workspaces
- `npm run dev` — server (http://localhost:4000, `node --watch`) + Vite client (http://localhost:5173, proxies `/api`) via `concurrently`
- `npm run seed` — wipe + reload demo data into `server/data/worklens.db` (an empty DB also auto-seeds on server start)
- `npm test` — server tests (node:test + supertest, in-memory DB, no viaSocket keys): `scoring`, `api`, `integrations`, `m91`, `security` (walks the route table: new routes must be behind auth or added to PUBLIC deliberately)
- `node scripts/verify-dashboard.mjs [email]` — with server running: manager-dashboard numbers vs hand-written SQL
- `npm run typecheck` — `tsc --noEmit` for the client
- `npm run screenshots` — with dev server running: visits every route as employee + manager in both themes, writes `screenshots/*.png` and `screenshots/console-errors.txt` (uses playwright-core + local Edge/Chrome, no browser download)
- `npm run smoke:isolated` — the click-through on a copy of the DB (port 4100, viaSocket off). Prefer this: `npm run smoke` resets the LIVE demo data
- `node scripts/responsive.mjs` — every page × roles × 375/768/1280 × themes: console errors, failed API calls, horizontal overflow
- `npm run demo:video` — rebuilds the landing-page demo video (voice via `edge-tts`, recording on a DB copy at :4200, ffmpeg); see README “Demo video”. Run it from PowerShell: the Bash sandbox blocks the voice service.
- `npm run build && npm start` — serve built app + API on :4000. Env: `DB_PATH`, `DATA_DIR`, `VIASOCKET_DISABLED=1` (never call viaSocket), `APP_NAME` (= hosted mode: binds 0.0.0.0, secure cookies, no in-process timers)
- Deployed on Embarko: https://worklens.embarko.app (locked). Redeploy + how it runs: README “Deploying to Embarko”. Embarko key: `~/.embarko/credentials` (never print or commit it)
- Demo logins: `manager@worklens.dev`, `aarav@worklens.dev` (also priya/rohan/zoya/kabir) — password `demo1234`

## Folder map
- `shared/seed.js` — deterministic demo data generator (pure JS), used by `server/src/db/seed.js`.
- `shared/scoring.js` — scoring engine (spec §3) as pure functions; `.d.ts` beside it for TS. Server access goes through `server/src/scoring/index.js` (persistence + debounced recompute).
- `server/src/` — `index.js` (boot, loads `.env`), `app.js` (middleware + routers), `auth.js` (JWT cookie), `access.js` (**the** authorization helper), `db/` (node:sqlite wrapper, migrations, seed), `routes/` (account, tasks, people), `services/` (`data.js` row mapping + snapshot, `views.js` dashboards/reports/insights), `lib/` (`http.js` errors/validation/logging, `events.js` timeline + outbox)
- `client/src/api/index.ts` — the `Api` interface + the single `api` export every component uses. `types.ts` mirrors the DB model.
- `client/src/api/http.ts` — fetch-based implementation of `Api` (multipart when evidence has a file).
- `client/src/components/ui/index.tsx` — UI kit (Button, Card, Badge, StatusPill, VerifyPill, PriorityIcon, Modal, SlideOver, Popover, ScoreRing, ScoreInfo, MiniBar…)
- `client/src/components/` — `TaskForm`, `WorkImpactTimeline`, `ScorePanel` (ScoreOverview/ScoreTrend/override modal), `tasks.tsx` (wrap-up, blocker, evidence forms), `layout/` (AppShell, CommandPalette, nav)
- `client/src/context/` — Auth, Theme, Toast, UI (composer slide-over, command palette)
- `client/src/lib/` — `format.ts` (labels, dates, markdown), `hooks.ts` (`useAsync`, `emitDataChanged`/`useDataChanged`)
- `client/src/pages/` — one file per page (14 pages; Daily/Weekly reports share `Reports.tsx`)

## Gotchas
- Embarko forbids in-process timers/background workers: periodic work goes through `GET /api/cron/tick` (embarko.json schedule); paths/ports/cookies come from `server/src/config.js`. Persistent files only under `DATA_DIR`.
- viaSocket `listConnections()` returns the auth_id in `id` (docs say `identifier`; reported as `row1kk3cbws4`).
- Windows Smart App Control blocks native `.node` addons here: rollup is aliased to `@rollup/wasm-node`; use `node:sqlite` + `bcryptjs` on the server, not `better-sqlite3`/`bcrypt`.

## Conventions
- Server: every route gets data access via `access.js`; validate input with zod `parse()`; mutations in `db.tx()` + `logEvent()` (+ `enqueue()` for automation events). Booleans are 0/1 in SQLite — map rows with `services/data.js` helpers.
- Colors only via CSS variable tokens (`bg-surface`, `text-muted`, `border-border`, `text-accent`, `bg-success-soft`…) defined in `client/src/index.css`; dark mode = `.dark` on `<html>`.
- Charts: Recharts, colors `rgb(var(--accent))` etc., tooltip `contentStyle` with surface/border vars.
- After any mutation call `emitDataChanged()`; pages call `useDataChanged(reload)`.
- Anything that can change a score must call `markChanged(db, userId)` (logEvent does it for you) so `performance_records` stays fresh.
- Reports: GET = live preview; POST `/reports/:kind/generate` = store. Team digest (`user_id NULL`) is manager-only.
- Review loop: evidence on a sent-back task does NOT change its status; only `POST /tasks/:id/resubmit` returns it to `pending`.
- M91 phone alerts (via viaSocket, `integrations/m91.js`): only named conditions, each with a stable customId and a code path that closes it. Never wire M91 into a generic error handler; never send CRITICAL; test alerts are LOW.
- Never fake integrations or AI output: show "Not connected" / "Nothing yet" instead. Every automation is an `integration_events` row first; the worker runs it once (no auto-retry).
- No rankings / leaderboards; team lists sort alphabetically.
- Secrets stay in `.env` (git-ignored). Only `server/src/integrations/viasocket.js` imports `viasocket-apps` (client: `viasocket-apps/browser` for the Connect popup only). auth_id/script_id never leave the server.
- viaSocket work: re-fetch the skill (`.claude/skills/viasocket-integrations/SKILL.md` says how) before changing integrations; run `npx -y viasocket-apps check server` after. Test writes only on the test Slack workspace/channel and the manager's own Gmail.
- AI calls cost credits: tests run with no viaSocket keys; `npm run smoke` turns all automations off after resetting.
