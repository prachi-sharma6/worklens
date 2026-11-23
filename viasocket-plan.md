# viaSocket plan — WorkLens (Phase 5)

Status: **confirmed ("yes", as is) and built.** Changes during the build: one AI call per team report returns team + per-person summaries (instead of one call per person) to keep credits low; report recipients default to the connected Gmail address.

Skill: `viasocket-integrations` (skill.md?format=sdk, version 2026-11-20.6). Backend is Node.js → every call goes
through the `viasocket-apps` npm package, only from `server/src/integrations/viasocket.js`.

Place in the skill's map: **the product, for its users** (the product's three keys are already in `.env`).
Features: `app-integrations` (Slack, Gmail) and `ai` (viaSocket runs the model).

## What users see

1. **Settings → Integrations (manager):** "Connect Slack" and "Connect Gmail" buttons with each app's icon. After
   Slack connects, the manager picks the alert channel from their own Slack's list (once). After Gmail connects, the
   manager types who receives report emails (once; defaults to their own address). Status shows Connected /
   Expired (Reconnect) / Not connected, plus the last 20 outbox events with a Retry button on failed ones.
2. **Alerts in Slack:** blocker reported, task completed with evidence (needs review), review decided, items needing
   intervention (review > 24 h, blocker > 48 h, overdue critical), daily team digest and weekly analysis — each with
   a link back into WorkLens. A resolved blocker posts a short reply in the original alert's thread.
3. **Report emails (Gmail):** daily digest at the workday end time (default 18:30 Asia/Kolkata) and weekly analysis
   on Friday 17:00, sent from the manager's own Gmail.
4. **AI (no connection needed):** suggestions when a task is created (shown, never auto-applied), dependency
   extraction for unclear blockers, 4–6 sentence summaries for daily/weekly reports. Every AI output is labelled
   "AI-generated from N records" and falls back to the template if the AI fails or returns invalid JSON.

## Plan table

| app | action (key, version) | key of `inputData` | who supplies it | when |
| --- | --- | --- | --- | --- |
| slack | `Send_Message` `v110` (action_id `row1jrbor`) | `destination.messageto` | the product's code: `"channel"` for alerts, `"thread"` for a blocker's resolution reply, `"user"` for an employee DM | per run |
| slack | `Send_Message` `v110` | `destination.channel_id` (PICK) | the manager, from their Slack's channel list (`listOptions`) | once, right after Connect; stored with the connection, changeable in Settings |
| slack | `Send_Message` `v110` | `destination.thread_channel_id`, `destination.thread_ts` (PICK) | the record that already names them: the channel and `ts` returned when the blocker alert was posted | per run (thread replies only) |
| slack | `Send_Message` `v110` | `destination.userId` (PICK) | the manager maps each teammate to a Slack user from their Slack's user list (`listOptions`); unmapped → in-app only | once per teammate, in Settings → Team members |
| slack | `Send_Message` `v110` | `markdown_content` | the product's code (built from the task/blocker/report records) | per run |
| slack | `Send_Message` `v110` | `bot_details.bot_name` | constant `"WorkLens"` (right for every user) | constant |
| slack | `Send_Message` `v110` | `destination.tagged_users`, `destination.reply_broadcast`, `buttons`, `schedule_type`, `delay_value`, `post_at`, `bot_details.icon_type/emoji/url`, `preview` | left out on purpose (send now, plain message, link back to WorkLens in the text) | — |
| gmail | `Send_Email` `v56` (action_id `rowogelpy0h6`) | `to` | the manager types recipients once in Settings (default: their own email) | once; read from settings each run |
| gmail | `Send_Email` `v56` | `subject`, `messageBody` | the product's code (report data + summary, HTML) | per run |
| gmail | `Send_Email` `v56` | `fromName` | constant `"WorkLens Reports"` | constant |
| gmail | `Send_Email` `v56` | `from` (PICK), `cc`, `bcc`, `replyTo`, `attachments`, `labelIds` (PICK) | left out on purpose: sends from the connected account itself, no extras | — |
| viaSocket AI | `user.ai.send` (`service: "openai"`, `model: "gpt-6-luna"`, `responseType: "json_schema"`) | `prompt`, `message` | the product's code: fixed instructions + the structured task/report JSON | per run |
| viaSocket AI | same | `threadId` | the product's code: one per job (`enrich-<task>`, `blocker-<id>`, `daily-<user>-<date>`, `weekly-<user>-<week>`) | per run |

**Who picks each action:** the product's code, always (no AI picks actions). So each manager gets **one viaSocket flow
per app** ("WorkLens → Slack", "WorkLens → Gmail"): a call-from-the-product trigger and one step that runs the action.
The flow's `script_id` is stored on the server only (a credential), used only for that manager.

**Who connects:** the manager, from WorkLens' own Connect button; the `auth_id` is stored per manager and app and
reconnected in place when `isExpired`.

**Where it runs:** all calls from the WorkLens server. The browser only receives the per-user embed token for the
Connect popup. Scheduling (daily/weekly/interventions) stays on the server with `node-cron`, because viaSocket's cloud
cannot call back into `localhost`; outbound calls work fine.

**Credits:** AI and action runs use credits. Build-time testing is **one real run each**: Slack post, Slack thread
reply, Gmail send, and ~4 AI calls (task suggestion, blocker extraction, daily summary, weekly analysis). Each AI
feature has an on/off toggle in Settings.

**Writes are tested only on test targets:** a Slack channel made for the test and the manager's own email.

## Tested on real connections (Nov 21–23, 2026)

| Workflow | What ran | Result |
| --- | --- | --- |
| 1 Smart task creation | `ai.send` json_schema, gpt-6-luna | WORKING — suggestions saved, applied only on the owner's choice |
| 2 Completion & verification | Slack `Send_Message` via the manager's flow | Slack path WORKING (same flow/step as below); completion alert itself not triggered by a real completion yet |
| 3 Blocker alert | AI dependency extraction; Slack post; resolution as a thread reply | WORKING (AI read "PDFKit Inc, external"; post + thread reply with `ts` stored) |
| 4 Daily report | 1 AI call → team + 5 person summaries; Slack digest; Gmail email | WORKING (Nov 20: 6 reports saved, `delivered_via = slack+gmail`) |
| 5 Weekly analysis | 1 AI call; Slack; Gmail | WORKING (Nov 23 re-run for Nov 16–22: AI ok, 6 reports saved, slack+gmail). The first run's answer was rejected by our over-strict list check → template fallback; check now trims lists |
| 6 Manager intervention | 15-min node-cron scan → one Slack message with deep links | WORKING (15 items, posted automatically) |
| Gmail test | `Send_Email` to the manager's own address | WORKING (`labelIds: SENT, INBOX`) |

AI credits used while building: 5 (enrich, blocker, daily, weekly ×2 — the second after the list-trim fix, approved by you).

## UNTESTED
- Reconnect in place of an expired connection (`connect({ authId })`) — no connection has expired yet.
- Employee decision DM — no teammate is mapped to a Slack user yet (Settings → Teammates' Slack users).

## Reported to viaSocket
- `row1kk3cbws4` (wrong_instructions): `listConnections()` entries carry the auth_id in `id`, not `identifier` as manage.md / test-connection.md say.

## VIASOCKET-PENDING
- None.
