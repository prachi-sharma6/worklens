// Scoring on the server. The formulas are pure functions in shared/scoring.js (also unit-tested here);
// this module persists weekly results to performance_records and keeps them fresh.
import { computeScores, computeTrend, computeRolling, isoWeekStart, FORMULAS, DIMENSIONS } from '../../../shared/scoring.js';
import { snapshot } from '../services/data.js';

export { computeScores, computeTrend, computeRolling, isoWeekStart, FORMULAS, DIMENSIONS };

const DAY = 86400000;
export const STORED_WEEKS = 8;

/** Recompute and upsert the last `weeks` ISO weeks for one user. Returns the rows written. */
export function recomputeUser(db, userId, { weeks = STORED_WEEKS, now = new Date() } = {}) {
  const s = snapshot(db, [userId]);
  const thisWeek = isoWeekStart(now).getTime();
  const at = new Date().toISOString();
  const rows = [];
  db.tx(() => {
    for (let i = weeks - 1; i >= 0; i--) {
      const r = computeScores(s, userId, new Date(thisWeek - i * 7 * DAY), { now });
      const inputs = Object.fromEntries(DIMENSIONS.map((d) => [d, {
        value: r.dimensions[d].value, data_points: r.dimensions[d].data_points, inputs: r.dimensions[d].inputs,
        excluded: r.dimensions[d].excluded.length, override: r.dimensions[d].override ?? null,
      }]));
      const row = {
        user_id: userId, period_type: 'week', period_start: r.period_start,
        productivity: r.dimensions.productivity.value, quality: r.dimensions.quality.value, impact: r.dimensions.impact.value,
        consistency: r.dimensions.consistency.value, ownership: r.dimensions.ownership.value, overall: r.overall,
        is_provisional: r.is_provisional,
        inputs_json: JSON.stringify({ dimensions: inputs, weights: r.weights, dropped: r.dropped, provisional_reasons: r.provisional_reasons }),
        computed_at: at,
      };
      db.run(`INSERT INTO performance_records (user_id, period_type, period_start, productivity, quality, impact, consistency, ownership, overall, is_provisional, inputs_json, computed_at)
              VALUES ($user_id, $period_type, $period_start, $productivity, $quality, $impact, $consistency, $ownership, $overall, $is_provisional, $inputs_json, $computed_at)
              ON CONFLICT(user_id, period_type, period_start) DO UPDATE SET
                productivity = excluded.productivity, quality = excluded.quality, impact = excluded.impact, consistency = excluded.consistency,
                ownership = excluded.ownership, overall = excluded.overall, is_provisional = excluded.is_provisional,
                inputs_json = excluded.inputs_json, computed_at = excluded.computed_at, updated_at = excluded.computed_at`, row);
      rows.push(row);
    }
  });
  return rows;
}

export function recomputeAll(db, opts) {
  const ids = db.all("SELECT id FROM users WHERE role = 'employee'").map((u) => u.id);
  for (const id of ids) recomputeUser(db, id, opts);
  return ids.length;
}

export function storedRecords(db, userId) {
  return db.all("SELECT * FROM performance_records WHERE user_id = ? AND period_type = 'week' ORDER BY period_start DESC", [userId])
    .map((r) => ({ ...r, is_provisional: !!r.is_provisional, inputs_json: JSON.parse(r.inputs_json ?? '{}') }));
}

/** Debounced recompute after state changes (many quick edits → one recompute per user). */
export function createRecomputeScheduler(db, delayMs = 1500) {
  const timers = new Map();
  const run = (userId) => {
    timers.delete(userId);
    try { if (userId === 'all') recomputeAll(db); else recomputeUser(db, userId); }
    catch (e) { console.error('score recompute failed', e); }
  };
  return {
    schedule(userId) {
      clearTimeout(timers.get(userId));
      const t = setTimeout(run, delayMs, userId);
      t.unref?.();
      timers.set(userId, t);
    },
    flush() { for (const [id, t] of timers) { clearTimeout(t); run(id); } },
    pending: () => timers.size,
  };
}
