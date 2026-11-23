// Outbox worker: reads queued integration_events and runs the matching workflow.
// Writes are NEVER retried automatically: an event is claimed (attempts = 1) before it runs, and a failed one
// stays 'failed' until a manager presses Retry in Settings → Integrations.
import cron from 'node-cron';
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

/** Start the worker (every 3 s) and the schedules (every minute). Not started in tests. */
export function startIntegrations(db) {
  enabledAt(db);
  let busy = false;
  const tick = async () => {
    if (busy) return; busy = true;
    try {
      const rows = db.all("SELECT * FROM integration_events WHERE status = 'queued' AND attempts = 0 ORDER BY id LIMIT 5");
      for (const ev of rows) await processOne(db, ev);
    } catch (e) { console.error('[outbox] tick failed', e); } finally { busy = false; }
  };
  const worker = setInterval(tick, 3000);
  worker.unref?.();
  // node-cron (not viaSocket's scheduler): localhost can't receive viaSocket's calls, but outbound calls work.
  const task = cron.schedule('* * * * *', () => { try { scheduleTick(db); } catch (e) { console.error('[schedule] tick failed', e); } });
  console.log('viaSocket outbox worker + schedules started');
  return { stop: () => { clearInterval(worker); task.stop(); }, tick };
}

/** Once a minute: daily report at the workday end, weekly analysis Friday 17:00, interventions every 15 min. Each de-duplicated. */
export function scheduleTick(db, now = new Date()) {
  const s = getSettings(db);
  const tz = s.timezone || 'Asia/Kolkata';
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false }).formatToParts(now).map((p) => [p.type, p.value]));
  const hhmm = `${parts.hour === '24' ? '00' : parts.hour}:${parts.minute}`;
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const managers = db.all("SELECT id FROM users WHERE role = 'manager'").map((m) => m.id);
  const once = (key) => db.run('INSERT OR IGNORE INTO notification_log (key) VALUES (?)', [key]).changes > 0;
  const fired = [];
  if (hhmm === (s.workday_end || '18:30') && !['Sat', 'Sun'].includes(parts.weekday)) {
    for (const m of managers) if (once(`daily:${m}:${date}`)) { enqueue(db, 'report.daily', { manager_id: m, date }); fired.push('daily'); }
  }
  if (parts.weekday === 'Fri' && hhmm === '17:00') {
    const week = isoWeekStart(new Date(date + 'T00:00:00'));
    const wk = `${week.getFullYear()}-${String(week.getMonth() + 1).padStart(2, '0')}-${String(week.getDate()).padStart(2, '0')}`;
    for (const m of managers) if (once(`weekly:${m}:${wk}`)) { enqueue(db, 'report.weekly', { manager_id: m, week: wk }); fired.push('weekly'); }
  }
  if (Number(parts.minute) % 15 === 0) {
    for (const m of managers) {
      if (!getConnection(db, m, 'slack')?.script_id) continue; // nothing could be sent: don't mark items as alerted
      const fresh = interventionItems(db, m).filter((i) => once(`intervention:${i.key}`));
      if (fresh.length) { enqueue(db, 'intervention', { manager_id: m, items: fresh }); fired.push(`intervention×${fresh.length}`); }
    }
  }
  return fired;
}
