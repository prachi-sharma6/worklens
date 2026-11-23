// Outbox worker: reads queued integration_events and runs the matching workflow.
// Writes are NEVER retried automatically: an event is claimed (attempts = 1) before it runs, and a failed one
// stays 'failed' until a manager presses Retry in Settings → Integrations.
import { HANDLERS, interventionItems, getConnection } from './workflows.js';
import { getSettings, setSetting } from '../services/data.js';
import { isoWeekStart } from '../scoring/index.js';
import { enqueue } from '../lib/events.js';

const ENABLED_KEY = 'integrations_enabled_at';

function enabledAt(db) {
  const row = db.get('SELECT value_json FROM settings WHERE key = ?', [ENABLED_KEY]);
  if (row) return JSON.parse(row.value_json);
  const now = new Date().toISOString();
  setSetting(db, ENABLED_KEY, now);
  return now;
}

export async function processOne(db, ev) {
  const claimed = db.run("UPDATE integration_events SET attempts = attempts + 1, updated_at = ? WHERE id = ? AND status = 'queued' AND attempts = 0", [new Date().toISOString(), ev.id]);
  if (!claimed.changes) return; // someone else has it, or it already ran once
  const finish = (status, result, error = null) => db.run('UPDATE integration_events SET status = ?, result_json = ?, last_error = ?, processed_at = ?, updated_at = ? WHERE id = ?',
    [status, result ? JSON.stringify(result) : null, error, new Date().toISOString(), new Date().toISOString(), ev.id]);
  // Events from before Phase 5 was switched on are history, not work: never send them now.
  if (ev.created_at < enabledAt(db)) return finish('skipped_not_connected', { reason: 'queued before viaSocket integrations were enabled' });
  const handler = HANDLERS[ev.event_type];
  if (!handler) return finish('failed', null, `No workflow handles "${ev.event_type}"`);
  try {
    const { status, result } = await handler(db, ev, JSON.parse(ev.payload_json));
    finish(status, result);
  } catch (e) {
    finish('failed', e.body ? { response: e.body } : null, String(e.message ?? e).slice(0, 500));
    console.error(`[outbox] ${ev.event_type} #${ev.id} failed:`, e.message);
  }
}

/** Run every queued event once, oldest first. Safe to call often: one drain at a time. */
let draining = null;
export function drain(db) {
  if (draining) return draining;
  draining = (async () => {
    try {
      for (;;) {
        const rows = db.all("SELECT * FROM integration_events WHERE status = 'queued' AND attempts = 0 ORDER BY id LIMIT 5");
        if (!rows.length) break;
        for (const ev of rows) await processOne(db, ev);
      }
    } catch (e) { console.error('[outbox] drain failed', e); } finally { draining = null; }
  })();
  return draining;
}

/**
 * The work of one scheduled tick: due reports and interventions, then the outbox.
 * Hosted (Embarko): called by the "/tasks/tick" schedule every 5 minutes. Locally: an interval every minute.
 */
export async function runTick(db, now = new Date()) {
  const fired = scheduleTick(db, now);
  await drain(db);
  return fired;
}

/**
 * Start integrations. Events run right after the request that queued them (no background worker).
 * Embarko forbids in-process timers, so the periodic tick comes from embarko.json there; locally a plain interval stands in.
 */
export function startIntegrations(db, { hosted = false } = {}) {
  enabledAt(db);
  db.onEnqueue = () => setImmediate(() => drain(db));
  drain(db);
  let timer = null;
  if (!hosted) {
    timer = setInterval(() => runTick(db).catch((e) => console.error('[schedule] tick failed', e)), 60_000);
    timer.unref?.();
  }
  console.log(`viaSocket outbox ready (${hosted ? 'ticks from the Embarko schedule' : 'local tick every minute'})`);
  return { stop: () => timer && clearInterval(timer) };
}

const WINDOW_MIN = 120; // a due job still runs if a tick arrives up to 2 h late; never replayed after that

/**
 * Due work, de-duplicated in notification_log: daily report at/after the workday end (weekdays), weekly analysis
 * Friday at/after 17:00, interventions on every tick (each item alerted once, only while Slack is connected).
 */
export function scheduleTick(db, now = new Date()) {
  const s = getSettings(db);
  const tz = s.timezone || 'Asia/Kolkata';
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false }).formatToParts(now).map((p) => [p.type, p.value]));
  const nowMin = (parts.hour === '24' ? 0 : Number(parts.hour)) * 60 + Number(parts.minute);
  const toMin = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
  const inWindow = (start) => nowMin >= start && nowMin < start + WINDOW_MIN;
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const managers = db.all("SELECT id FROM users WHERE role = 'manager'").map((m) => m.id);
  const once = (key) => db.run('INSERT OR IGNORE INTO notification_log (key) VALUES (?)', [key]).changes > 0;
  const fired = [];
  if (inWindow(toMin(s.workday_end || '18:30')) && !['Sat', 'Sun'].includes(parts.weekday)) {
    for (const m of managers) if (once(`daily:${m}:${date}`)) { enqueue(db, 'report.daily', { manager_id: m, date }); fired.push('daily'); }
  }
  if (parts.weekday === 'Fri' && inWindow(17 * 60)) {
    const week = isoWeekStart(new Date(date + 'T00:00:00'));
    const wk = `${week.getFullYear()}-${String(week.getMonth() + 1).padStart(2, '0')}-${String(week.getDate()).padStart(2, '0')}`;
    for (const m of managers) if (once(`weekly:${m}:${wk}`)) { enqueue(db, 'report.weekly', { manager_id: m, week: wk }); fired.push('weekly'); }
  }
  for (const m of managers) {
    if (!getConnection(db, m, 'slack')?.script_id) continue; // nothing could be sent: don't mark items as alerted
    const fresh = interventionItems(db, m).filter((i) => once(`intervention:${i.key}`));
    if (fresh.length) { enqueue(db, 'intervention', { manager_id: m, items: fresh }); fired.push(`intervention×${fresh.length}`); }
  }
  return fired;
}
