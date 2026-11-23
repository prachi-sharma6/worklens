// Row mapping + team-scoped snapshot loading for read views and scoring.
import { DEFAULT_SETTINGS } from '../../../shared/seed.js';

export const taskRow = (r) => r && ({
  ...r,
  is_planned_today: !!r.is_planned_today,
  ai_enriched: !!r.ai_enriched,
  ai_suggestions_json: r.ai_suggestions_json ? JSON.parse(r.ai_suggestions_json) : null,
});
export const blockerRow = (r) => r && ({ ...r, is_external: !!r.is_external, ai_extraction_json: r.ai_extraction_json ? JSON.parse(r.ai_extraction_json) : null });
export const eventRow = (r) => r && ({ ...r, payload_json: safeJson(r.payload_json) });
function safeJson(s) { try { return JSON.parse(s); } catch { return s; } }

export function getSettings(db) {
  const out = structuredClone(DEFAULT_SETTINGS);
  for (const r of db.all("SELECT key, value_json FROM settings WHERE key NOT LIKE 'prefs:%' AND key != 'integrations_enabled_at'")) {
    const v = safeJson(r.value_json);
    out[r.key] = r.key === 'features' ? { ...DEFAULT_SETTINGS.features, ...v } : v; // new toggles default on
  }
  return out;
}
export const DEFAULT_PREFS = { in_app: true, slack_dm: false, email_digest: false };
export function getPrefs(db, userId) {
  const row = db.get('SELECT value_json FROM settings WHERE key = ?', [`prefs:${userId}`]);
  return { ...DEFAULT_PREFS, ...(row ? safeJson(row.value_json) : {}) };
}

export function setSetting(db, key, value) {
  db.run(`INSERT INTO settings (key, value_json) VALUES (?, ?)
          ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`, [key, JSON.stringify(value)]);
}

const inList = (ids) => (ids.length ? ids : [-1]);
const ph = (ids) => inList(ids).map(() => '?').join(',');

/** Everything the scoring engine and read views need for a set of users. Includes soft-deleted tasks (for the 10-minute rule). */
export function snapshot(db, userIds) {
  const ids = inList(userIds);
  const p = ph(ids);
  return {
    users: db.all(`SELECT id, name, email, role, team_id, manager_id, title, avatar_color, timezone, category FROM users WHERE id IN (${p}) OR id IN (SELECT manager_id FROM users WHERE id IN (${p}))`, [...ids, ...ids]),
    tasks: db.all(`SELECT * FROM tasks WHERE user_id IN (${p})`, ids).map(taskRow),
    evidence: db.all(`SELECT e.* FROM task_evidence e JOIN tasks t ON t.id = e.task_id WHERE t.user_id IN (${p}) ORDER BY e.submitted_at`, ids),
    reviews: db.all(`SELECT r.* FROM manager_reviews r JOIN tasks t ON t.id = r.task_id WHERE t.user_id IN (${p}) ORDER BY r.created_at, r.id`, ids),
    comments: [],
    blockers: db.all(`SELECT * FROM blockers WHERE user_id IN (${p}) ORDER BY opened_at`, ids).map(blockerRow),
    timeline: db.all(`SELECT id, user_id, task_id, event_type, title, detail, occurred_at FROM activity_timeline WHERE user_id IN (${p}) ORDER BY occurred_at`, ids),
    score_overrides: db.all(`SELECT * FROM score_overrides WHERE user_id IN (${p})`, ids),
    settings: getSettings(db),
  };
}
