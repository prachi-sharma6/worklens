# WorkLens — progress

| Phase | Status |
|---|---|
| 1 — Frontend shell, design system, navigation (mock API) | ✅ Done |
| 2 — Backend, DB, auth, seed | ✅ Done |
| 3 — Tasks, evidence, blockers | ✅ Done |
| 4 — Scoring engine tests, analytics, reports | ✅ Done |
| 5 — viaSocket (AI + Slack + Gmail + schedules) | ✅ Done — 2 items UNTESTED (see viasocket-plan.md) |
| 6 — Tests, polish, README | ✅ Done |
| Deploy — Embarko | ✅ Live at https://worklens.embarko.app (locked) |

## Decisions
- **Client in TypeScript**, server will be plain Node ESM. Tailwind v3 with CSS-variable tokens for light/dark.
- **Seed + scoring live in `shared/`** as dependency-free JS so the Phase 1 mock and the Phase 2+ server use the *same* data generator and formulas (no throwaway mock maths).
- **Impact formula**: `min(100, 100 × period points ÷ median weekly points of the 4 weeks *before* the period)` (weeks with no completions skipped). Phase 4 changed the baseline from “4 weeks including this one” to “previous 4 weeks” so a week can’t raise its own baseline; with no baseline yet → Not enough data. A typical week still scores ~100 (no headroom) — say if you want e.g. ×75.
- **Ownership "stall" moment** = the task's `started_at` (or `created_at`); a blocker reported within 1.5 calendar days (≈1 working day) counts as prompt.
- **Consistency** counts working days from the employee's first task onward (so a new joiner isn't penalised for days before they started).
- **Tasks have `deleted_at`** (soft delete) to support the "deleted within 10 minutes" exclusion.
- **Windows Smart App Control blocks unsigned native `.node` addons** in this folder (rollup's native binary failed with "An Application Control policy has blocked this file"). Fix: root devDependency `rollup` aliased to `@rollup/wasm-node`; esbuild's signed exe runs fine. **Phase 2 impact:** `better-sqlite3` and `bcrypt` are native addons and will likely be blocked too → plan is to use Node's built-in `node:sqlite` (Node 26 here) and `bcryptjs`. Same SQL, no native code.
- **Playwright** via `playwright-core` driving the locally installed Edge — no browser download.
- Managers can open task details, reports (`?user=ID`) and profiles for their team; nav shows only pages 11–14 for managers.

## UI visibility pass (Nov 23 2026, local only — not deployed)
- Connected apps visible everywhere: top-bar pill (AI · Slack · Gmail with live dots → details popover), sidebar “Powered by viaSocket” badge, new **Integrations** page for both roles (viaSocket intro, status cards with account/channel/recipients and what each app does, the 7 automations with apps, on/off and last run; manager controls below; employee Slack-DM opt-in).
- Navigation: grouped sidebar (My work / Insights / Reports / Connected apps) with hints on every item; managers gained Reports, Integrations and “How to use”; Ctrl K searches hints too.
- Dashboards: role-aware “How to use WorkLens” checklist ticked from real data (hideable, restorable from Help) + “Powered by viaSocket” card.
- New **How to use** page (quick start per role, every page in one line, scoring summary, automations, FAQ). Settings split into tabs (`?tab=` deep links).
- Verified: 88/88 tests, typecheck, build, isolated smoke 20/20 with 0 console errors, responsive sweep 144 visits clean.
- Design ideas canvas (private): https://claude.ai/artifact/CVB1BCEkz92RqAQe8WKVQs

## Deploy (Embarko, Nov 23 2026)
- Live: https://worklens.embarko.app · app id `cmwstqibz0096m1ti403l72sw` · claimed with the Embarko key (saved in `~/.embarko/credentials`) · **locked** to the Embarko workspace (your choice; viaSocket AI/Slack/Gmail stay on behind it).
- Changes for Embarko’s rules: `server/src/config.js` (PORT/0.0.0.0, `DATA_DIR` for DB + uploads, generated JWT secret in DATA_DIR, secure cookies, APP_URL from APP_NAME); node-cron + the 3 s worker removed → events run right after the request that queued them, and `GET /api/cron/tick` (CRON_SECRET) runs due reports/interventions/outbox, called every 5 min by the `embarko.json` schedule (locally: a 1-min interval). Due jobs fire within a 2 h window, de-duplicated. Root `npm start` no longer builds (Embarko runs `npm run build` itself); `engines.node >= 22.13`.
- Verified: build succeeded and went live; `VIASOCKET_*` set as env vars and applied (live again); schedule test run → `ok 200 tick ok`; unsigned requests → 302 to the Embarko lock page. Local Embarko simulation: seeds into empty DATA_DIR, Secure cookie, tick 401 without secret. 88/88 tests.
- **Not verified by me:** signing in and using the app (needs your Embarko sign-in), and Connect Slack/Gmail from the deployed origin (if viaSocket’s embed has a domain whitelist, worklens.embarko.app must be on it).
- Notes: deployed DB is separate (fresh demo data, no Slack/Gmail connected yet); no backups on Embarko; AI features are on, so new tasks and the 18:30 weekday report use AI credits.

## Phase 6 — what changed
- **Bug fixed:** “Reset demo data” failed (FOREIGN KEY) once viaSocket connections existed; the reset now defers FK checks to commit and keeps connections.
- **Dead controls removed/wired:** notification preferences now do something — “Needs your attention” toggle hides dashboard nudges; “Slack DM when my work is reviewed” is the employee’s opt-in for decision DMs; the unbuilt email digest toggle was removed; section shown to employees only. Leftover “Phase 5” wording replaced.
- **Isolated mode:** `DB_PATH`, `VIASOCKET_DISABLED=1` (blocks every viaSocket call, including direct flow URLs), and the API serves `client/dist` (`npm start`). `npm run smoke:isolated` runs the destructive walkthrough on a VACUUM copy at :4100.
- Integrations panel no longer requests a Connect token when viaSocket isn’t configured (was a console 400).
- Security headers (nosniff, frame DENY, same-origin referrer). `README.md` written.

## Phase 6 verification
- `npm test` → **87/87** (+ security suite: every non-public route → 401 without a session (route table walked automatically, >50 routes); 17 manager-only routes → 403 for employees; uploads > 5 MB refused; headers; no stack traces; no password fields in user payloads; reset keeps connections; viaSocket-disabled never calls a connected Slack; prefs hide nudges).
- `npm run smoke:isolated` → all steps OK, **0 console errors / failed requests**; live DB verified untouched (AI reports still present).
- `node scripts/responsive.mjs` → **114 page visits** (both roles × 375/768/1280 × light/dark) — 0 console errors, 0 failed API calls, 0 horizontal overflow.
- Performance (seeded data): API 2–24 ms median; full page load on the *dev* server 640–700 ms (target < 1 s).
- `npm run typecheck` ✅ · `npm run build` ✅ · `npx -y viasocket-apps check server` 0 FAIL.
- `npm audit --omit=dev`: zod 3 (high) + react-router 6 (2 moderate) need major upgrades — recorded as known, with mitigations, in README.

## Phase 5 — what changed
- Skill `viasocket-integrations` installed at `.claude/skills/viasocket-integrations/SKILL.md` (pointer; the skill is re-fetched each time). Plan + test record: `viasocket-plan.md`.
- `server/src/integrations/viasocket.js` is the only importer of `viasocket-apps` (0.21.0). Each manager connects Slack/Gmail via viaSocket's Connect popup (Settings → Integrations); the server verifies the auth_id is theirs, then builds one webhook-triggered flow per app ("WorkLens → Slack/Gmail", one step calling `Send_Message v110` / `Send_Email v56`). auth_id + script_id live only in `integration_connections`.
- `integrations/outbox.js`: claims each queued event once (attempts=1) and runs its workflow; writes are never retried automatically (Retry button creates a new event). Events queued before integrations were enabled are skipped. (Since the Embarko deploy: runs right after the queuing request + on the `/api/cron/tick` schedule; node-cron removed.) Daily report at workday end on weekdays, weekly Friday 17:00, interventions (only when Slack is connected), each de-duplicated in `notification_log`.
- `integrations/workflows.js`: the six workflows. `integrations/ai.js`: guardrail prompt (records only, no web, no invented facts, no scores, no pronouns), json_schema answers re-validated with zod, template fallback on any failure.
- UI: Settings → Integrations (Connect/Reconnect/Disconnect, channel picker, teammate Slack map, recipients, feature toggles with credit notes, run-now with date, outbox + Retry); AI suggestions card on tasks (apply selected / dismiss); AI reading on blockers; AI cards on Insights + dashboard with "AI-generated from N records · See the records".
- Migration `002_viasocket.sql`: `integration_connections`, `notification_log`, blocker Slack thread refs + AI reading, outbox result columns.
- Decision: AI features ON (your choice); every AI feature has its own toggle. The smoke test switches all automations off after its demo reset so it never spends credits.

## Phase 5 verification
- Real runs: AI ×5, Slack posts ×7 (test, blocker, thread reply, intervention, 3 digests), Gmail ×4 (test, 3 reports). See viasocket-plan.md.
- `npx -y viasocket-apps check server` → 0 FAIL, 0 WARN (23 files); `check client/src` → 0 FAIL (32 files). No secret/script_id in client code or built bundle.
- `npm test` → **78/78** (+14 integration tests, no network: claim-once, no auto-retry, old events skipped, honest "not connected", template fallback, schedules fire once / not on weekends, interventions not marked while Slack is off, employees blocked from integration routes, ids never in responses, retry only for failed, AI suggestions applied only by owner).
- `npm run screenshots` → 0 console errors. Smoke not re-run on the live DB (its demo reset would wipe the real AI outputs).

## Phase 4 — what changed
- **Scoring module** `server/src/scoring/index.js`: re-exports the pure engine (`shared/scoring.js`) + `recomputeUser/recomputeAll/storedRecords` + a debounced scheduler (1.5 s). Score-relevant changes call `markChanged(db, userId)` (via `logEvent`, status/edit/delete/resubmit/evidence-delete/override-clear; `'all'` for weight/leave changes and demo reset). Startup and `npm run seed` recompute everyone.
- **`performance_records`**: last 8 ISO weeks per employee, upserted with `inputs_json` (per-dimension value, data points, raw inputs, override, weights, dropped, provisional reasons). `GET /api/performance/records`, `POST /api/performance/recompute`. UI: “Stored weekly records” + **Recompute now** on Performance and the profile’s Scores tab.
- **Reports**: `GET /reports/daily|weekly` = live preview; `POST /reports/:kind/generate` stores into `daily_reports`/`weekly_reports` (one row per person|team + period, regenerate replaces); `GET /reports/history`, `GET /reports/saved/:kind/:id` (access-checked; team digests manager-only). Weekly `data_json` now carries engine scores per person. UI: **Generate & save**, saved-version banner, history list, scores table, scores in Markdown export. `summary_source = 'template'`.
- Pages already on real numbers since Phase 2 (Performance, Manager Dashboard, Team Performance, Profile) — unchanged formulas, now cross-checked.

## Phase 4 verification
- `npm test` → **64/64**: 21 scoring unit tests (hours don’t help; splitting a task doesn’t help; doubling task count with same ratios doesn’t help; missing data = null not 0; no-history = all null; overall re-normalisation; external blockers excluded from completion and extend on-time; deleted-within-10-min excluded; provisional (<5 eligible / <2 reviewed); overrides keep original; weights affect only overall; quality ½ for clarification + ratings; latest review wins; impact 100/50/0 + previous-4-week median + cap; impact with no baseline = null; consistency + leave days; consistency starts at first task; ownership parts) + 6 persistence/report API tests + the 37 earlier.
- `npm run smoke` → **19/19** (adds: manager Generate & save team weekly report + reopen from history; Recompute now on a profile).
- `node scripts/verify-dashboard.mjs` → manager dashboard vs hand-written SQL for Aarav + team tiles: **11/11 match** (queries printed by the script; see report).
- `npm run screenshots` → 0 console errors; build ✅.

## Phase 3 — what changed
- **Review loop:** clarification/rejection → employee sees the manager’s note on the task (“Your response” + Add evidence + **Resubmit for review**) → `POST /api/tasks/:id/resubmit` (owner only, response ≥ 10 chars, needs ≥ 1 evidence) → back to `pending` in the manager queue; response stored as a `clarification` comment; outbox `task.resubmitted`.
- **Decision:** adding evidence no longer silently resubmits a sent-back task (only `unsubmitted` → `pending`). Resubmission is an explicit step with a response.
- **In-app nudge:** employee dashboard “Needs your attention” (rejected, clarification, overdue, completed-without-evidence), first 4 + Show all.
- **Server-side search/filter:** My Tasks search is debounced and sent to the server (`q`); new `overdue=1` filter + “Overdue only” toggle.
- **Seed:** stale overdue tasks cut from ~15 to 7 (4 not blocked); repeated templates get distinct titles (“— follow-up”, “— phase 2”). Demo reset / `npm run seed` also clear `server/uploads/`.
- Already in place from Phases 1–2 and re-verified: CRUD, transitions (`started_at`/`completed_at`), wrap-up dialog, “No evidence” flag, all 6 evidence types + validation, blockers (named dependency, external flag, resolution note → In Progress), comments, review with required note + 1–5 rating.

## Phase 3 verification
- `npm test` → **37/37** (+9: transitions, overdue filter, server search, blocked-task locks, resubmit rules incl. other-employee 404 / manager 403, evidence doesn’t auto-resubmit, full loop on the timeline, no-evidence → review)
- `npm run smoke` → **17/17**: employee create → start → block → unblock → complete with evidence → screenshot upload → overdue filter; manager clarification → employee sees nudge → responds & resubmits → manager verifies (4★) → every step on the employee’s Work Impact Timeline
- `npm run screenshots` → 0 console errors; `npm run build` ✅

## Phase 2 — what exists
- `server/` Express API on :4000 (Vite proxies `/api`). Routes: `routes/account.js` (auth, settings, prefs, profile, integrations status/outbox, demo reset), `routes/tasks.js` (tasks, status, wrap-up, evidence + uploads, comments, blockers, reviews), `routes/people.js` (users, timeline, performance + overrides, dashboards, team, reports, insights, search).
- SQLite via built-in `node:sqlite`; numbered migrations in `server/src/db/migrations/` (tracked in `schema_migrations`); DB file `server/data/worklens.db` (git-ignored). Empty DB auto-seeds on first start; `npm run seed` resets.
- Auth: bcryptjs + JWT (7 days) in httpOnly `SameSite=Lax` cookie `wl_token`; `JWT_SECRET` generated into `.env`. Naive login throttle (10 tries / 15 min per email). `GET /api/auth/session` is public and returns `{user|null}` (no console 401s).
- Authorization: `server/src/access.js` is the only place visibility is decided (`canSeeUser`, `getTaskFor(viewer, id, 'read'|'owner'|'review')`, `visibleUsers`). Invisible → 404, visible-but-not-allowed → 403. Client `user_id` is only a filter after a visibility check; create bodies are `.strict()` so extra keys are rejected.
- Every mutation runs in a transaction and writes `activity_timeline`; automation-relevant ones (task.created, task.completed, evidence.submitted, blocker.opened/resolved, review.decided) also insert a `queued` `integration_events` row. Nothing consumes the outbox yet.
- Uploads: multer → `server/uploads/`, PNG/JPEG/WebP/GIF/PDF only, 5 MB, random filenames; served only via `GET /api/evidence/:id/file` after a task-visibility check.
- Read views (`server/src/services/views.js`) run over a team-scoped snapshot using `shared/scoring.js`. Client mock removed; `client/src/api/http.ts` implements the same `Api` interface.

## Phase 2 verification
- `npm test` → **28/28** (auth ×7, authorization ×7 incl. “employee A cannot read B’s task → 404”, CRUD/lifecycle ×14)
- `npm run smoke` (real backend) → **13/13** incl. multipart screenshot upload + authorised file download
- `npm run screenshots` → all pages, both roles/themes + 375px → **0 console errors**
- Read endpoints respond in ~5–40 ms on seeded data.

## Phase 1 verification
- `npm run typecheck` ✅ · `npm run build` ✅
- `npm run screenshots`: all 14 pages as employee + manager, light + dark, plus 375px mobile → **0 console errors**
- `npm run smoke`: create via slide-over → Ctrl+K search → start → report blocker → resolve → wrap-up with evidence → role guard → manager verify (4★) → timeline shows it → reject needs note → weights must total 100 → **11/11 OK**

## Known gaps
- Overall is the re-normalised average of whatever dimensions have data, so a new joiner with only Consistency shows e.g. “100 · Provisional”. Spec-compliant, but could mislead — option: require ≥ 2 dimensions for an overall.
- Team digests are stored with `user_id NULL` and shown to any manager (fine for the single seeded team; multi-team would need a team/manager column).
- Current-week scores are partial (e.g. Impact reads low early in the week) — by design, the period isn’t over.
- Resubmission has no dedicated timeline event type (the spec’s event list is fixed); it shows as the employee’s clarification comment + the later verified/feedback event.
- AI cards show **Not connected** — no AI output exists until Phase 5.
- Integrations panel shows Slack/Gmail/AI as **Not connected**; Connect buttons are disabled until Phase 5. Outbox rows are written on task create/complete, evidence, blocker and review, and stay `queued`.
- Daily/weekly reports use the deterministic **template summary** (`summary_source = 'template'`).
