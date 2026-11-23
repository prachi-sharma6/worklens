// The six WorkLens workflows (spec §5.4), run by the outbox worker. Each handler returns
// { status: 'sent' | 'skipped_not_connected', result } or throws (→ 'failed', never retried automatically).
import * as vs from './viasocket.js';
import { APP_URL as APP_URL_CONFIG } from '../config.js';
import * as ai from './ai.js';
import { getSettings, getPrefs, snapshot, taskRow, blockerRow } from '../services/data.js';
import { dailyReport, weeklyReport, insights, dk } from '../services/views.js';
import { saveReport } from '../services/reports.js';
import { isoWeekStart } from '../scoring/index.js';

const APP_URL = () => APP_URL_CONFIG;
const link = (path, text) => `[${text}](${APP_URL()}${path})`;
const hoursSince = (iso) => Math.round((Date.now() - new Date(iso).getTime()) / 3600000);
const fmtDur = (h) => (h < 48 ? `${h}h` : `${Math.round(h / 24)}d`);

// ------------------------------------------------------------- connection helpers
export function getConnection(db, userId, app) {
  const r = db.get('SELECT * FROM integration_connections WHERE user_id = ? AND app = ?', [userId, app]);
  return r ? { ...r, settings: JSON.parse(r.settings_json || '{}') } : null;
}
const managerIdOf = (db, userId) => db.get('SELECT manager_id FROM users WHERE id = ?', [userId])?.manager_id ?? null;
const nameOf = (db, userId) => db.get('SELECT name FROM users WHERE id = ?', [userId])?.name ?? 'Someone';

/** Post to the manager's chosen Slack channel (or a thread / a DM). Returns the app's response, or null when not connected. */
async function slack(db, managerId, eventCreatedAt, body) {
  if (!vs.isConfigured()) return { skipped: 'viaSocket not configured on this server' };
  const conn = getConnection(db, managerId, 'slack');
  if (!conn?.script_id) return { skipped: 'Slack not connected' };
  if (eventCreatedAt < conn.connected_at) return { skipped: 'event happened before Slack was connected' };
  if (!getSettings(db).features?.slack_alerts) return { skipped: 'Slack alerts turned off in Settings' };
  if (body.kind !== 'thread' && body.kind !== 'user' && !conn.settings.channel_id) return { skipped: 'no Slack channel chosen yet' };
  const res = await vs.runFlow(conn.script_id, { kind: 'channel', channel_id: conn.settings.channel_id, ...body });
  return { sent: true, res };
}
async function gmail(db, managerId, eventCreatedAt, { subject, html }) {
  if (!vs.isConfigured()) return { skipped: 'viaSocket not configured on this server' };
  const conn = getConnection(db, managerId, 'gmail');
  if (!conn?.script_id) return { skipped: 'Gmail not connected' };
  if (eventCreatedAt < conn.connected_at) return { skipped: 'event happened before Gmail was connected' };
  if (!getSettings(db).features?.email_reports) return { skipped: 'Report emails turned off in Settings' };
  const to = (conn.settings.recipients ?? []).join(',');
  if (!to) return { skipped: 'no report recipients set' };
  const res = await vs.runFlow(conn.script_id, { to, subject, html });
  return { sent: true, res };
}
/** Slack's answer is one object for one target (or an array for several): take the first. */
const firstMsg = (res) => (Array.isArray(res) ? res[0] : res) ?? {};
const outcome = (parts) => {
  const vals = Object.values(parts);
  return { status: vals.some((p) => p === 'sent' || p === 'ok' || p?.sent === true) ? 'sent' : 'skipped_not_connected', result: parts };
};
const brief = (p) => (p?.sent ? 'sent' : p?.skipped ? `skipped: ${p.skipped}` : p);

// ------------------------------------------------------------- 1. Smart task creation
async function taskCreated(db, ev, payload) {
  const t = taskRow(db.get('SELECT * FROM tasks WHERE id = ?', [payload.task_id]));
  if (!t || t.deleted_at) return { status: 'skipped_not_connected', result: { reason: 'task deleted' } };
  if (!getSettings(db).features?.ai_enrichment) return { status: 'skipped_not_connected', result: { reason: 'AI task suggestions turned off in Settings' } };
  if (!vs.isConfigured()) return { status: 'skipped_not_connected', result: { reason: 'viaSocket AI not configured' } };
  const { data, meta } = await ai.enrichTask(t);
  db.update('tasks', t.id, { ai_enriched: 1, ai_suggestions_json: JSON.stringify({ ...data, ...meta, state: 'pending' }) });
  return { status: 'sent', result: { ai: 'ok', model: meta.model } };
}

// ------------------------------------------------------------- 2. Completion & verification
async function taskCompleted(db, ev, payload) {
  const t = taskRow(db.get('SELECT * FROM tasks WHERE id = ?', [payload.task_id]));
  if (!t) return { status: 'skipped_not_connected', result: { reason: 'task missing' } };
  const evidence = db.all('SELECT type, url, note FROM task_evidence WHERE task_id = ?', [t.id]);
  if (!evidence.length) {
    // No evidence: flagged "No evidence" (unsubmitted) and shown in the employee's "Needs your attention" card.
    return { status: 'sent', result: { in_app_nudge: 'shown on the employee dashboard', slack: 'not sent (no evidence, nothing to review)' } };
  }
  const who = nameOf(db, t.user_id);
  const ev1 = evidence.slice(0, 5).map((e) => `• ${e.type.replace('_', ' ')}: ${e.url ?? (e.note ?? '').slice(0, 120)}`).join('\n');
  const s = await slack(db, managerIdOf(db, t.user_id), ev.created_at, {
    text: `✅ *${who}* completed *${t.title}* — ready for review\n*Outcome:* ${t.actual_outcome ?? '—'}\n*Evidence (${evidence.length}):*\n${ev1}\n${link(`/tasks/${t.id}`, 'Review in WorkLens')}`,
  });
  return outcome({ slack: brief(s) });
}
async function taskResubmitted(db, ev, payload) {
  const t = db.get('SELECT * FROM tasks WHERE id = ?', [payload.task_id]);
  const reply = db.get("SELECT body FROM task_comments WHERE task_id = ? AND author_id = ? ORDER BY id DESC LIMIT 1", [t.id, t.user_id]);
  const s = await slack(db, managerIdOf(db, t.user_id), ev.created_at, {
    text: `🔁 *${nameOf(db, t.user_id)}* resubmitted *${t.title}* for review\n> ${(reply?.body ?? '').slice(0, 400)}\n${link(`/tasks/${t.id}`, 'Review in WorkLens')}`,
  });
  return outcome({ slack: brief(s) });
}

// ------------------------------------------------------------- 3. Blocker alert
async function blockerOpened(db, ev, payload) {
  const b = blockerRow(db.get('SELECT * FROM blockers WHERE id = ?', [payload.blocker_id]));
  if (!b) return { status: 'skipped_not_connected', result: { reason: 'blocker missing' } };
  const t = db.get('SELECT * FROM tasks WHERE id = ?', [b.task_id]);
  const parts = {};
  let aiNote = '';
  if ((b.dependency_type === 'unclear' || !b.dependency_name) && getSettings(db).features?.ai_blockers && vs.isConfigured()) {
    try {
      const { data, meta } = await ai.extractDependency(b, t);
      db.update('blockers', b.id, { ai_extraction_json: JSON.stringify({ ...data, ...meta }) });
      parts.ai = 'ok';
      if (data.dependency_name) aiNote = `\n_AI reading of the description: waiting on *${data.dependency_name}* (${data.dependency_type}, ${data.confidence} confidence)_`;
    } catch (e) { parts.ai = `failed: ${e.message}`; }
  }
  const dep = b.dependency_name ? `${b.dependency_name} (${b.dependency_type}${b.is_external ? ', external' : ''})` : 'not named';
  const s = await slack(db, managerIdOf(db, b.user_id), ev.created_at, {
    text: `🚧 *${nameOf(db, b.user_id)}* is blocked on *${t.title}*\n> ${b.description}\n*Waiting on:* ${dep}${aiNote}\n${link(`/tasks/${t.id}`, 'Open in WorkLens')}`,
  });
  if (s.sent) { const m = firstMsg(s.res); if (m.ts) db.update('blockers', b.id, { slack_channel: m.channel ?? null, slack_ts: m.ts }); }
  parts.slack = brief(s);
  return outcome(parts);
}
async function blockerResolved(db, ev, payload) {
  const b = db.get('SELECT * FROM blockers WHERE id = ?', [payload.blocker_id]);
  const t = db.get('SELECT title FROM tasks WHERE id = ?', [b.task_id]);
  const dur = b.resolved_at ? fmtDur(Math.round((new Date(b.resolved_at) - new Date(b.opened_at)) / 3600000)) : '—';
  const text = `✅ Unblocked after ${dur}: *${t.title}*${b.resolution_note ? `\n> ${b.resolution_note}` : ''}`;
  const s = b.slack_ts && b.slack_channel
    ? await slack(db, managerIdOf(db, b.user_id), ev.created_at, { kind: 'thread', thread_channel_id: b.slack_channel, thread_ts: b.slack_ts, text })
    : await slack(db, managerIdOf(db, b.user_id), ev.created_at, { text: `${text}\n${link(`/tasks/${b.task_id}`, 'Open in WorkLens')}` });
  return outcome({ slack: brief(s), thread: !!b.slack_ts, open_duration: dur });
}

// ------------------------------------------------------------- 6. Manager intervention (+ decision → employee)
async function reviewDecided(db, ev, payload) {
  const t = db.get('SELECT * FROM tasks WHERE id = ?', [payload.task_id]);
  const r = db.get('SELECT * FROM manager_reviews WHERE task_id = ? ORDER BY id DESC LIMIT 1', [t.id]);
  const mgr = managerIdOf(db, t.user_id);
  const conn = getConnection(db, mgr, 'slack');
  const mapped = conn?.settings?.user_map?.[t.user_id];
  const parts = { in_app: 'timeline + task page' };
  if (!getPrefs(db, t.user_id).slack_dm) parts.slack_dm = 'skipped: employee has not opted in to Slack DMs';
  else if (!mapped?.id) parts.slack_dm = 'skipped: teammate not mapped to a Slack user';
  else if (!getSettings(db).features?.employee_dms) parts.slack_dm = 'skipped: employee DMs turned off';
  else {
    const label = { verified: '✅ verified', clarification_requested: '❓ asked for clarification on', rejected: '❌ sent back' }[r.decision];
    parts.slack_dm = brief(await slack(db, mgr, ev.created_at, { kind: 'user', slack_user_id: mapped.id, text: `Your manager ${label} *${t.title}*${r.note ? `\n> ${r.note}` : ''}\n${link(`/tasks/${t.id}`, 'Open in WorkLens')}` }));
  }
  return { status: 'sent', result: parts }; // the in-app notice (timeline + task page) always lands
}
async function intervention(db, ev, payload) {
  const lines = payload.items.slice(0, 10).map((i) => `• ${i.icon} ${i.text} — ${link(i.path, 'open')}`);
  const more = payload.items.length > 10 ? `\n…and ${payload.items.length - 10} more on the ${link('/manager', 'manager dashboard')}` : '';
  const s = await slack(db, payload.manager_id, ev.created_at, { text: `⚠️ *${payload.items.length} item${payload.items.length === 1 ? '' : 's'} need your attention*\n${lines.join('\n')}${more}` });
  return outcome({ slack: brief(s), items: payload.items.length });
}

// ------------------------------------------------------------- 4/5. Daily report & weekly analysis
function teamOf(db, managerId) {
  return db.all('SELECT id, name, email, role, team_id, manager_id, title, avatar_color, timezone FROM users WHERE manager_id = ? ORDER BY name', [managerId]);
}
async function teamReport(db, ev, payload, kind) {
  const managerId = payload.manager_id;
  const team = teamOf(db, managerId);
  const s = snapshot(db, team.map((u) => u.id));
  const key = kind === 'daily' ? payload.date : payload.week;
  const build = (users) => (kind === 'daily' ? dailyReport(s, key, users) : weeklyReport(s, key, users));
  const teamRep = build(team); teamRep.user_id = null; teamRep.data.user_id = null; teamRep.data.user_name = null;
  const personal = team.map((u) => ({ u, rep: build([u]) }));
  const parts = {};

  if (getSettings(db).features?.ai_reports && vs.isConfigured()) {
    try {
      const people = personal.map(({ u, rep }) => ({ user_id: u.id, name: u.name, report: ai.compactReport(rep.data) }));
      if (kind === 'daily') {
        const { data, meta } = await ai.summariseDaily(managerId, key, ai.compactReport(teamRep.data), people);
        teamRep.summary_text = data.team_summary; teamRep.summary_source = 'ai';
        teamRep.data.ai = { ...meta, records: ai.recordCount(teamRep.data) };
        for (const p of personal) { const m = data.people.find((x) => x.user_id === p.u.id); if (m) { p.rep.summary_text = m.summary; p.rep.summary_source = 'ai'; p.rep.data.ai = { ...meta, records: ai.recordCount(p.rep.data) }; } }
      } else {
        const start = isoWeekStart(new Date(key + 'T00:00:00')).getTime();
        const groups = insights({ ...s, blockers: s.blockers.filter((b) => new Date(b.opened_at).getTime() >= start && new Date(b.opened_at).getTime() < start + 7 * 86400000) }, team.map((u) => u.id)).recurring_blockers.map((g) => ({ dependency: g.dependency, type: g.type, occurrences: g.count, still_open: g.open }));
        const { data, meta } = await ai.analyseWeekly(managerId, key, ai.compactReport(teamRep.data), people, groups);
        teamRep.summary_text = data.team_summary; teamRep.summary_source = 'ai';
        teamRep.data.ai = { ...meta, records: ai.recordCount(teamRep.data) };
        teamRep.data.ai_analysis = { achievements: data.achievements, recurring_problems: data.recurring_problems, planned_vs_actual: data.planned_vs_actual, suggestions: data.suggestions };
        for (const p of personal) { const m = data.people.find((x) => x.user_id === p.u.id); if (m) { p.rep.summary_text = m.summary; p.rep.summary_source = 'ai'; p.rep.data.ai = { ...meta, records: ai.recordCount(p.rep.data) }; } }
      }
      parts.ai = 'ok';
    } catch (e) { parts.ai = `failed → template summary: ${e.message}`; } // fallback: template summaries stay
  } else parts.ai = 'skipped → template summary';

  const savedTeamId = saveReport(db, teamRep);
  for (const p of personal) saveReport(db, p.rep);
  parts.saved = personal.length + 1;

  const d = teamRep.data;
  const title = kind === 'daily' ? `Daily team report · ${d.period_label}` : `Weekly analysis · ${d.period_label}`;
  const reportPath = `/reports/${kind}`;
  const aiTag = teamRep.summary_source === 'ai' ? `_AI-generated by viaSocket AI from ${d.ai.records} records_` : '_Template summary_';
  const extra = d.ai_analysis ? `\n*Achievements:* ${d.ai_analysis.achievements.slice(0, 3).join('; ') || '—'}\n*Suggestions:*\n${d.ai_analysis.suggestions.map((x) => `• ${x}`).join('\n')}` : '';
  const sl = await slack(db, managerId, ev.created_at, {
    text: `📊 *${title}*\n${teamRep.summary_text}\n*Completed:* ${d.completed.length} · *Blocked:* ${d.blocked.length} · *Pending:* ${d.pending.length} · *Impact points:* ${d.impact_points}${extra}\n${aiTag} · ${link(reportPath, 'Open report')}`,
  });
  parts.slack = brief(sl);
  const gm = await gmail(db, managerId, ev.created_at, { subject: `WorkLens — ${title}`, html: emailHtml(title, teamRep, personal, reportPath) });
  parts.gmail = brief(gm);
  const via = [sl.sent && 'slack', gm.sent && 'gmail'].filter(Boolean).join('+');
  if (via) db.run(`UPDATE ${kind === 'daily' ? 'daily_reports' : 'weekly_reports'} SET delivered_via = ?, delivered_at = ? WHERE id = ?`, [via, new Date().toISOString(), savedTeamId]);
  // Reports are saved even when nothing is connected, so the job itself succeeded.
  return { status: via ? 'sent' : 'skipped_not_connected', result: parts };
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function emailHtml(title, teamRep, personal, path) {
  const d = teamRep.data;
  const li = (arr, f) => (arr.length ? `<ul>${arr.slice(0, 15).map((x) => `<li>${f(x)}</li>`).join('')}</ul>` : '<p style="color:#6b7280">None</p>');
  const tag = teamRep.summary_source === 'ai' ? `AI-generated by viaSocket AI from ${d.ai?.records ?? 0} WorkLens records` : 'Template summary built from WorkLens records';
  return `<div style="font-family:Inter,Segoe UI,Arial,sans-serif;max-width:640px;color:#111827">
<h2 style="margin:0 0 4px">${esc(title)}</h2><p style="color:#6b7280;margin:0 0 16px;font-size:12px">${esc(tag)}</p>
<p>${esc(teamRep.summary_text)}</p>
<p><b>Completed</b> ${d.completed.length} · <b>Blocked</b> ${d.blocked.length} · <b>Pending</b> ${d.pending.length} · <b>Impact points</b> ${d.impact_points}</p>
${d.ai_analysis ? `<h3>Achievements</h3>${li(d.ai_analysis.achievements, esc)}<h3>Recurring problems</h3>${li(d.ai_analysis.recurring_problems, (r) => `${esc(r.dependency)} (${r.occurrences}×) — ${esc(r.note)}`)}<h3>Planned vs actual</h3><p>${esc(d.ai_analysis.planned_vs_actual)}</p><h3>Suggestions</h3>${li(d.ai_analysis.suggestions, esc)}` : ''}
<h3>Completed</h3>${li(d.completed, (t) => `${esc(t.title)} — ${esc(t.user_name)} (${esc(t.verification_status.replace('_', ' '))})`)}
<h3>Needs attention</h3>${li(d.needs_attention, esc)}
<h3>By person</h3>${personal.map((p) => `<p><b>${esc(p.u.name)}</b><br>${esc(p.rep.summary_text)}</p>`).join('')}
<p><a href="${esc(APP_URL() + path)}">Open in WorkLens</a></p><p style="color:#6b7280;font-size:12px">Delivered by <a href="https://viasocket.com">viaSocket</a> for WorkLens.</p></div>`;
}

// ------------------------------------------------------------- test messages (Settings → Integrations)
async function slackTest(db, ev, payload) {
  const s = await slack(db, payload.manager_id, ev.created_at, { text: `👋 WorkLens test message — alerts for your team will appear in this channel. ${link('/settings', 'Settings')}` });
  return outcome({ slack: brief(s), response: s.res ? { ok: firstMsg(s.res).ok, channel: firstMsg(s.res).channel, ts: firstMsg(s.res).ts } : undefined });
}
async function gmailTest(db, ev, payload) {
  const g = await gmail(db, payload.manager_id, ev.created_at, { subject: 'WorkLens test email', html: '<p>This is a WorkLens test email. Daily and weekly reports will arrive at this address.</p>' });
  return outcome({ gmail: brief(g), response: g.res ? { id: g.res.id ? 'present' : undefined, labelIds: g.res.labelIds } : undefined });
}

export const HANDLERS = {
  'task.created': taskCreated,
  'task.completed': taskCompleted,
  'task.resubmitted': taskResubmitted,
  'blocker.opened': blockerOpened,
  'blocker.resolved': blockerResolved,
  'review.decided': reviewDecided,
  'intervention': intervention,
  'report.daily': (db, ev, p) => teamReport(db, ev, p, 'daily'),
  'report.weekly': (db, ev, p) => teamReport(db, ev, p, 'weekly'),
  'slack.test': slackTest,
  'gmail.test': gmailTest,
};

/** Items needing intervention right now (pending review > 24 h, blocker open > 48 h, overdue critical). */
export function interventionItems(db, managerId) {
  const ids = teamOf(db, managerId).map((u) => u.id);
  if (!ids.length) return [];
  const ph = ids.map(() => '?').join(',');
  const items = [];
  for (const t of db.all(`SELECT t.id, t.title, t.completed_at, u.name FROM tasks t JOIN users u ON u.id = t.user_id WHERE t.user_id IN (${ph}) AND t.deleted_at IS NULL AND t.status = 'completed' AND t.verification_status = 'pending'`, ids)) {
    if (hoursSince(t.completed_at) > 24) items.push({ key: `review:${t.id}`, icon: '🕒', text: `Review waiting ${fmtDur(hoursSince(t.completed_at))}: ${t.title} (${t.name})`, path: `/tasks/${t.id}` });
  }
  for (const b of db.all(`SELECT b.id, b.task_id, b.opened_at, b.dependency_name, t.title, u.name FROM blockers b JOIN tasks t ON t.id = b.task_id JOIN users u ON u.id = b.user_id WHERE b.user_id IN (${ph}) AND b.status = 'open'`, ids)) {
    if (hoursSince(b.opened_at) > 48) items.push({ key: `blocker:${b.id}`, icon: '🚧', text: `Blocked ${fmtDur(hoursSince(b.opened_at))}: ${b.title} (${b.name}${b.dependency_name ? `, waiting on ${b.dependency_name}` : ''})`, path: `/tasks/${b.task_id}` });
  }
  for (const t of db.all(`SELECT t.id, t.title, t.deadline, u.name FROM tasks t JOIN users u ON u.id = t.user_id WHERE t.user_id IN (${ph}) AND t.deleted_at IS NULL AND t.status != 'completed' AND t.priority = 'critical' AND t.deadline < ?`, [...ids, new Date().toISOString()])) {
    items.push({ key: `overdue:${t.id}`, icon: '🔥', text: `Critical task overdue: ${t.title} (${t.name})`, path: `/tasks/${t.id}` });
  }
  return items;
}
export { dk };
