# WorkLens — make every contribution visible

WorkLens is an internal work-measurement app built for the viaSocket challenge *“How can you and your work be
measured?”*. It doesn’t measure how busy someone looks; it measures what they actually contribute. Employees plan
tasks around outcomes, attach evidence and report blockers; managers verify the evidence, request clarification or
correct an assessment. From those records WorkLens computes five explained scores — **Productivity, Quality, Impact,
Consistency, Ownership** — builds daily and weekly reports, and (through viaSocket) adds AI summaries, Slack alerts
and Gmail report delivery. Every number shows how it was calculated, and every AI output links back to the records it
was written from.

---

## Quick start

Requirements: Node.js 20+ (built and tested on Node 26, Windows 11). No database server, no Docker.

```bash
npm install
npm run seed      # optional: resets the database to the demo data (an empty database seeds itself on first start)
npm run dev       # API on http://localhost:4000 + app on http://localhost:5173
```

Open http://localhost:5173 and pick a demo account on the login page (all passwords `demo1234`):

| Role | Email | Notes |
| --- | --- | --- |
| Manager | `manager@worklens.dev` | Meera Kapoor — team of five |
| Employee | `aarav@worklens.dev` | Engineering, ~3 weeks of history |
| Employee | `priya@worklens.dev`, `rohan@worklens.dev`, `zoya@worklens.dev` | Design, Support, Marketing |
| Employee | `kabir@worklens.dev` | Joined this week — shows the **Provisional** score state |

`npm start` builds the client and serves app + API together on http://localhost:4000.

### Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | API (`node --watch`) + Vite client together |
| `npm run seed` | Wipe and reload demo data (keeps viaSocket connections), then store weekly scores |
| `npm test` | 87 server tests: scoring + fairness rules, API, authorization, integrations, security |
| `npm run typecheck` / `npm run build` | Client TypeScript check / production build |
| `npm run smoke:isolated` | Full click-through (employee + manager) on a **copy** of the database, port 4100, viaSocket off — your data and credits are untouched |
| `npm run screenshots` | Every page, both roles, both themes → `screenshots/` + console-error report |
| `node scripts/responsive.mjs` | Every page × both roles × 375/768/1280 px × light/dark: console errors, failed requests, horizontal overflow |
| `node scripts/verify-dashboard.mjs` | Manager-dashboard numbers vs hand-written SQL |

`npm run smoke` runs the same click-through against the **live** dev database and resets the demo data first — use
`smoke:isolated` unless you mean that.

---

## The five dimensions

Computed per employee per ISO week (Monday–Sunday) and as a rolling 4-week view, from records only. Code:
`shared/scoring.js` (pure functions, unit-tested in `server/test/scoring.test.js`). Every score card in the app has a
**“How is this calculated?”** popover with the formula, the real inputs (“7 of 9 tasks completed, 6 on time”) and
anything excluded.

| Dimension (default weight) | Formula |
| --- | --- |
| **Productivity (25%)** | 50% × completion rate + 50% × on-time rate. Each task weighted by priority (low 1, medium 2, high 3, critical 4). |
| **Quality (25%)** | 60% × verified rate (clarification = ½, rejected = 0) + 25% × evidence rate + 15% × average manager rating (×20). Missing parts are re-weighted. |
| **Impact (25%)** | Impact points (low 1, medium 3, high 6) for verified tasks, unverified at 50%, rejected 0 — ÷ your own median weekly points over the previous 4 weeks, ×100, capped at 100. |
| **Consistency (15%)** | Share of working days (excluding leave, counted from your first task) with ≥1 meaningful update: task completed, evidence submitted or status change. |
| **Ownership (10%)** | 40% × blockers reported within 1 working day of stalling + 30% × blockers with a named dependency + 30% × tasks updated before their deadline passed. |

**Overall** = the weighted average of the dimensions that have data; weights are editable by the manager in Settings
and must total 100%.

**Eligible tasks** = tasks with a deadline or completion inside the period, excluding tasks deleted within 10 minutes
of creation.

### Fairness rules (enforced in code, each one tested)

- **Hours worked never increase any score.** Actual time is shown only for estimation accuracy.
- **Task count alone never increases a score** — priority weighting and ratios, so splitting work into tiny tasks gains nothing.
- **Missing data is never zero.** A dimension with fewer than 3 data points shows “Not enough data” and is dropped from the overall; the remaining weights are re-normalised.
- **External blockers don’t count against you:** tasks blocked by an external dependency are excluded from completion, and the blocked time extends the deadline for on-time.
- **Provisional** when there are fewer than 5 eligible tasks or fewer than 2 reviewed tasks in the period.
- **Manager overrides** need a written reason, are stored in an audit table, show an “Adjusted by manager” tag, and keep the original value visible.
- **No rankings.** Team views are alphabetical distributions; there is no leaderboard or “top performer”.
- **AI never computes or changes a score.** AI summaries may only quote scores the engine produced.

---

## viaSocket setup (AI, Slack, Gmail)

WorkLens uses [viaSocket](https://viasocket.com) for three things, all from the server through the
[`viasocket-apps`](https://www.npmjs.com/package/viasocket-apps) package (only `server/src/integrations/viasocket.js`
imports it):

- **viaSocket AI** — task suggestions, reading unclear blockers, daily/weekly report summaries. No model account needed.
- **Slack** (`Send_Message` v110) — blocker, review, intervention and report alerts in one channel the manager picks.
- **Gmail** (`Send_Email` v56) — daily and weekly report emails from the manager’s own Gmail.

### 1. Product keys (once)

`.env` (git-ignored; see `.env.example`) needs:

```
VIASOCKET_ORG_ID=...
VIASOCKET_PROJECT_ID=...
VIASOCKET_EMBED_SECRET=...
```

If they’re missing, run this in the project folder, open the link it prints, pick your workspace and click **Allow**:

```bash
npx -y viasocket-apps setup --no-open
```

Check: Settings → Integrations shows **viaSocket AI · Ready**.

### 2. Connect Slack and Gmail (manager, once)

1. Sign in as the manager → **Settings → Integrations · viaSocket**.
2. **Connect Slack** → sign in to the Slack workspace you want → **Allow**. Then choose the **Alert channel** (use a test channel first).
   Optional: map teammates to Slack users so review decisions can be DMed to them (each employee must also opt in under their own Settings → Notifications).
3. **Connect Gmail** → sign in → **Allow**. **Report recipients** defaults to the connected Gmail address; change it there.
4. **What runs automatically** has one switch per feature; the AI ones are marked *uses AI credits*.

WorkLens stores the connection id and builds one small viaSocket workflow per app for the manager
(“WorkLens → Slack”, “WorkLens → Gmail”); both ids stay on the server. An expired connection shows **Reconnect**,
which re-signs it in place.

### 3. Test each workflow

| Workflow | How to trigger it |
| --- | --- |
| Slack / Gmail | **Send test** on each card |
| 1 Smart task creation | Create a task as an employee → the task page shows **AI suggestions** (apply selected / dismiss) |
| 2 Completion & verification | Complete a task with evidence → “ready for review” in Slack; without evidence → the employee’s “Needs your attention” |
| 3 Blocker alert | Report a blocker → Slack alert (+ AI reading if the dependency is unclear); resolve it → reply in the same Slack thread |
| 4 Daily report | **Send daily report now** (pick a date) — or wait for the workday end time (default 18:30, team timezone, weekdays) |
| 5 Weekly analysis | **Send weekly analysis now** — or Friday 17:00 |
| 6 Manager intervention | Automatic every 15 min while Slack is connected: reviews pending > 24 h, blockers open > 48 h, overdue critical tasks |

Every automation is written to the **outbox** first (Settings → Integrations, last 20 events), run once by a worker,
and marked `sent`, `skipped_not_connected` (with the reason) or `failed`. Failed sends are **never retried
automatically** — press **Retry**.

**Why node-cron and not viaSocket’s scheduler:** WorkLens runs on `localhost`, which viaSocket’s cloud can’t call back
into; outbound calls work fine. On a public URL the schedules could move to viaSocket triggers.

### AI guardrails

The model receives only structured WorkLens records, with instructions to use nothing else (no web), never invent
achievements, numbers or people, never compute scores, and refer to people by name only. Answers are requested as
JSON schema and re-validated with zod; on any error or invalid answer the plain template summary is used and labelled
“Template summary”. Every AI output is labelled “AI-generated from N records” with a link to those records.

---

## Integration status (tested on real connections, Nov 2026)

| Workflow | Status |
| --- | --- |
| 1 Smart task creation (AI) | **WORKING** |
| 2 Completion & verification | Slack send **WORKING** (shared step); the completion trigger itself not yet exercised on a real completion |
| 3 Blocker alert + thread reply (+ AI dependency reading) | **WORKING** |
| 4 Daily report (AI summary, Slack, Gmail) | **WORKING** |
| 5 Weekly analysis (AI, Slack, Gmail) | **WORKING** |
| 6 Manager intervention | **WORKING** (runs automatically) |
| Reconnect an expired connection | UNTESTED — no connection has expired |
| Review decision → employee Slack DM | UNTESTED — needs a teammate mapped to a Slack user and the employee’s opt-in |

`npx -y viasocket-apps check server` → 0 FAIL, 0 WARN. Details and the plan table: `viasocket-plan.md`.

---

## How it’s built

- **Client** (`client/`): React 18 + Vite + TypeScript + Tailwind (CSS-variable tokens, light/dark) + Recharts +
  react-router + lucide. One `Api` interface (`client/src/api/`) used by every page.
- **Server** (`server/`): Node ESM + Express + zod. SQLite through Node’s built-in `node:sqlite` (numbered SQL
  migrations, `server/data/worklens.db`). bcryptjs + JWT in an httpOnly `SameSite=Lax` cookie.
  `server/src/access.js` is the single authorization helper: employees see only their own records, managers their
  team’s; a `user_id` from the client is only ever a filter after a visibility check.
- **Shared** (`shared/`): the scoring engine and the deterministic demo-data generator.
- Uploads: PNG/JPEG/WebP/GIF/PDF, 5 MB, served only after a task-visibility check.

> **Windows note:** Smart App Control blocks unsigned native Node add-ons in this folder, so the project uses
> `node:sqlite`, `bcryptjs` and Rollup’s WebAssembly build (`@rollup/wasm-node`) instead of native modules.

## Known limitations

- Dependency advisories needing major upgrades: `zod` 3 (oversized-collection validation; mitigated by the 1 MB body
  limit and bounded arrays) and `react-router-dom` 6 (open-redirect via user-controlled links — WorkLens only
  navigates to paths it builds; SSR advisory not applicable). Fix: zod 4, react-router 7.
- One manager per team is assumed (team digests are stored per period, not per manager).
- Current-week scores are partial by design (the week isn’t over); Impact reads low early in the week.
- The client bundle is one ~800 KB chunk (Recharts); route-level code splitting would cut first load.
