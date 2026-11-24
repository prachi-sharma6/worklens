// M91 phone alerts (M91 by MSG91, through each manager's viaSocket connection).
// M91 rings every phone in a channel at full volume, through silent mode, until someone answers — so it is used
// only for NAMED conditions where a person must act and may not be looking at WorkLens (never a generic error hook).
// Each condition has a stable customId (names the condition, not the run); an alert opens once while the condition
// holds and is closed from code as soon as it clears. Sends go through the outbox like every other automation.
import { APP_URL } from '../config.js';
import { getSettings } from '../services/data.js';
import { enqueue } from '../lib/events.js';

export const SEVERITY = { critical_overdue: 'HIGH', critical_blocked: 'HIGH', blocker_stuck: 'MEDIUM', delivery_failing: 'MEDIUM' };
/** Outage-shaped answers (M91 playbook): one SHARED claim + one PERSONAL acknowledgement. */
export const ANSWERS = { labels: "I'll handle it,Seen", effects: 'SHARED,PERSONAL' };
const STUCK_HOURS = 48;
const MAX_NEW_PER_SYNC = 3; // a burst (e.g. right after connecting) rings a few at a time, the rest on the next check

const cut = (s, n) => (String(s ?? '').length > n ? `${String(s).slice(0, n - 1)}…` : String(s ?? ''));
const hoursSince = (iso) => (Date.now() - new Date(iso).getTime()) / 3600000;
const fmtAge = (h) => (h < 48 ? `${Math.round(h)}h` : `${Math.round(h / 24)}d`);
const url = (path) => `${APP_URL}${path}`;

/** The events whose job is to deliver to Slack or Gmail (their failures mean WorkLens can't reach people). */
const DELIVERY_EVENTS = ['task.completed', 'task.resubmitted', 'blocker.opened', 'blocker.resolved', 'intervention', 'report.daily', 'report.weekly', 'slack.test', 'gmail.test'];

export function m91Connection(db, managerId) {
  const r = db.get("SELECT * FROM integration_connections WHERE user_id = ? AND app = 'm91'", [managerId]);
  return r ? { ...r, settings: JSON.parse(r.settings_json || '{}') } : null;
}
/** Ready to ring: connected, flow built, a channel picked. */
export const m91Ready = (c) => !!(c?.script_id && c.settings?.channel_id);

/**
 * Every condition that should be ringing right now for this manager's team.
 * Titles stay short and plain: a phone call reads the first 100 characters of the title aloud.
 */
export function m91Conditions(db, managerId, now = new Date()) {
  const team = db.all('SELECT id FROM users WHERE manager_id = ?', [managerId]).map((u) => u.id);
  const out = [];
  if (team.length) {
    const ph = team.map(() => '?').join(',');
    // 1. A critical task past its deadline and not done (a blocked one is covered by its blocker alert).
    for (const t of db.all(`SELECT t.id, t.title, t.deadline, u.name FROM tasks t JOIN users u ON u.id = t.user_id
        WHERE t.user_id IN (${ph}) AND t.deleted_at IS NULL AND t.priority = 'critical' AND t.status NOT IN ('completed','blocked') AND t.deadline < ?`, [...team, now.toISOString()])) {
      out.push({
        custom_id: `worklens-overdue-task-${t.id}`, kind: 'critical_overdue', path: `/tasks/${t.id}`,
        title: cut(`Critical task overdue: ${t.title}`, 95),
        description: cut(`${t.name}'s critical task "${t.title}" was due ${new Date(t.deadline).toUTCString().slice(0, 22)} UTC and is not done yet. Open it in WorkLens: ${url(`/tasks/${t.id}`)}`, 1900),
      });
    }
    // 2/3. Open blockers: on a critical task → now; on any other task → once stuck for 48 h.
    for (const b of db.all(`SELECT b.id, b.task_id, b.description, b.dependency_name, b.opened_at, t.title, t.priority, u.name FROM blockers b
        JOIN tasks t ON t.id = b.task_id JOIN users u ON u.id = b.user_id
        WHERE b.user_id IN (${ph}) AND b.status = 'open' AND t.deleted_at IS NULL`, team)) {
      const critical = b.priority === 'critical';
      const age = hoursSince(b.opened_at);
      if (!critical && age < STUCK_HOURS) continue;
      const waiting = b.dependency_name ? `waiting on ${b.dependency_name}` : 'dependency not named';
      out.push({
        custom_id: `worklens-blocker-${b.id}`, kind: critical ? 'critical_blocked' : 'blocker_stuck', path: `/tasks/${b.task_id}`,
        title: cut(critical ? `Critical task blocked: ${b.title}` : `Blocked ${fmtAge(age)}: ${b.title}`, 95),
        description: cut(`${b.name} is blocked on "${b.title}" (${waiting}). "${b.description}" Open it in WorkLens: ${url(`/tasks/${b.task_id}`)}`, 1900),
      });
    }
  }
  // 4. WorkLens can't reach people: the last two Slack/Gmail deliveries both failed (persisting, not a one-off).
  const last = db.all(`SELECT status, last_error FROM integration_events WHERE event_type IN (${DELIVERY_EVENTS.map(() => '?').join(',')})
      AND status IN ('sent','failed') ORDER BY processed_at DESC, id DESC LIMIT 2`, DELIVERY_EVENTS);
  if (last.length === 2 && last.every((e) => e.status === 'failed')) {
    out.push({
      custom_id: 'worklens-delivery-failing', kind: 'delivery_failing', path: '/settings?tab=integrations',
      title: 'WorkLens alerts and reports are failing to send',
      description: cut(`The last two Slack/Gmail deliveries failed, so blocker alerts and reports are not reaching the team. Latest error: ${last[0].last_error ?? 'unknown'}. Check the connections in WorkLens: ${url('/settings?tab=integrations')}`, 1900),
    });
  }
  return out.map((c) => ({ ...c, severity: SEVERITY[c.kind] }));
}

/**
 * Open an alert for every new condition and close the ones that cleared. DB-only (the outbox does the sending),
 * so it is cheap to call on every drain and tick. Returns what it queued.
 */
export function syncM91(db, now = new Date()) {
  const fired = [];
  const nowIso = now.toISOString();
  const on = getSettings(db).features?.m91_alerts !== false;
  const managers = db.all("SELECT id FROM users WHERE role = 'manager'").map((m) => m.id);
  for (const m of managers) {
    const conn = m91Connection(db, m);
    const open = db.all("SELECT * FROM m91_alerts WHERE manager_id = ? AND status = 'open' AND kind != 'test'", [m]);
    if (!conn?.script_id) { // disconnected: nothing can reach M91 any more, so forget the open ones here
      if (open.length) db.run("UPDATE m91_alerts SET status = 'closed', closed_at = ?, close_reason = 'M91 disconnected in WorkLens', updated_at = ? WHERE manager_id = ? AND status = 'open'", [nowIso, nowIso, m]);
      continue;
    }
    const want = on && m91Ready(conn) ? m91Conditions(db, m, now) : [];
    const wantIds = new Set(want.map((c) => c.custom_id));
    for (const a of open) {
      if (wantIds.has(a.custom_id)) continue;
      const reason = on ? 'condition cleared' : 'M91 alerts turned off in Settings';
      db.tx(() => {
        db.run("UPDATE m91_alerts SET status = 'closed', closed_at = ?, close_reason = ?, updated_at = ? WHERE id = ?", [nowIso, reason, nowIso, a.id]);
        enqueue(db, 'm91.close', { manager_id: m, custom_id: a.custom_id, reason });
      });
      fired.push(`m91-close:${a.kind}`);
    }
    const openIds = new Set(open.map((a) => a.custom_id));
    for (const c of want.filter((x) => !openIds.has(x.custom_id)).slice(0, MAX_NEW_PER_SYNC)) {
      db.tx(() => {
        db.insert('m91_alerts', { manager_id: m, custom_id: c.custom_id, kind: c.kind, title: c.title, severity: c.severity, path: c.path, status: 'open', opened_at: nowIso });
        enqueue(db, 'm91.alert', { manager_id: m, custom_id: c.custom_id, kind: c.kind, title: c.title, description: c.description, severity: c.severity });
      });
      fired.push(`m91:${c.kind}`);
    }
  }
  return fired;
}
