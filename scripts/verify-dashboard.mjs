// Phase 4 acceptance: manager-dashboard numbers vs. hand-written SQL on the same database.
// Usage (server running on :4000): node scripts/verify-dashboard.mjs [employee-email]
import { DatabaseSync } from 'node:sqlite';

const EMAIL = process.argv[2] ?? 'aarav@worklens.dev';
const API = process.env.API_URL ?? 'http://localhost:4000/api';
const db = new DatabaseSync('server/data/worklens.db', { readOnly: true });

// --- API side (as the manager) ---
const login = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'manager@worklens.dev', password: 'demo1234' }) });
const cookie = login.headers.get('set-cookie').split(';')[0];
const dash = await (await fetch(`${API}/dashboard/manager`, { headers: { cookie } })).json();

// --- SQL side ---
const ws = new Date(); ws.setHours(0, 0, 0, 0); ws.setDate(ws.getDate() - ((ws.getDay() + 6) % 7)); // Monday 00:00 local
const today = new Date(); today.setHours(0, 0, 0, 0);
const P = { ws: ws.toISOString(), today: today.toISOString(), now: new Date().toISOString() };
const user = db.prepare('SELECT id, name FROM users WHERE email = ?').get(EMAIL);
const row = dash.members.find((m) => m.user.id === user.id);

const Q = {
  completed_week: [`SELECT COUNT(*) AS v FROM tasks
  WHERE user_id = $uid AND deleted_at IS NULL AND completed_at >= $ws`],
  on_time_pct: [`SELECT CAST(ROUND(100.0 * SUM(completed_at <= deadline) / COUNT(*)) AS INTEGER) AS v FROM tasks
  WHERE user_id = $uid AND deleted_at IS NULL AND completed_at >= $ws AND deadline IS NOT NULL`],
  verified_pct: [`SELECT CAST(ROUND(100.0 * SUM(verification_status = 'verified') / COUNT(*)) AS INTEGER) AS v FROM tasks
  WHERE user_id = $uid AND deleted_at IS NULL AND completed_at >= $ws
    AND verification_status IN ('verified','clarification_requested','rejected')`],
  open_blockers: [`SELECT COUNT(*) AS v FROM blockers WHERE user_id = $uid AND status = 'open'`],
  current_task: [`SELECT title AS v FROM tasks WHERE user_id = $uid AND deleted_at IS NULL AND status = 'in_progress'
  ORDER BY updated_at DESC LIMIT 1`],
  last_activity: [`SELECT MAX(occurred_at) AS v FROM activity_timeline WHERE user_id = $uid`],
};
const TEAM = {
  in_progress: `SELECT COUNT(*) AS v FROM tasks t JOIN users u ON u.id = t.user_id WHERE u.manager_id = 1 AND t.deleted_at IS NULL AND t.status = 'in_progress'`,
  blocked: `SELECT COUNT(*) AS v FROM tasks t JOIN users u ON u.id = t.user_id WHERE u.manager_id = 1 AND t.deleted_at IS NULL AND t.status = 'blocked'`,
  pending_reviews: `SELECT COUNT(*) AS v FROM tasks t JOIN users u ON u.id = t.user_id WHERE u.manager_id = 1 AND t.deleted_at IS NULL AND t.status = 'completed' AND t.verification_status = 'pending'`,
  completed_today: `SELECT COUNT(*) AS v FROM tasks t JOIN users u ON u.id = t.user_id WHERE u.manager_id = 1 AND t.deleted_at IS NULL AND t.completed_at >= $today`,
  delivery_pct: `SELECT CAST(ROUND(100.0 * SUM(t.status = 'completed') / COUNT(*)) AS INTEGER) AS v FROM tasks t JOIN users u ON u.id = t.user_id
  WHERE u.manager_id = 1 AND t.deleted_at IS NULL AND t.deadline >= $ws AND t.deadline < $now`,
};

const results = [];
const check = (scope, name, sql, params, apiVal) => {
  const used = Object.fromEntries(Object.entries(params).filter(([k]) => sql.includes("$" + k)));
  const v = db.prepare(sql).get(used)?.v ?? null;
  results.push({ scope, metric: name, api: apiVal, sql: v, match: String(apiVal ?? null) === String(v ?? null) });
  return sql;
};

console.log(`Employee: ${user.name} (id ${user.id}) · week starts ${P.ws} (Monday 00:00 local)\n`);
for (const [k, [sql]] of Object.entries(Q)) {
  const apiVal = k === 'current_task' ? row.current_task?.title ?? null : row[k];
  check(user.name, k, sql, { uid: user.id, ws: P.ws }, apiVal);
  console.log(`-- ${k}\n${sql};\n`);
}
for (const [k, sql] of Object.entries(TEAM)) {
  check('team', k, sql, { ws: P.ws, today: P.today, now: P.now }, dash[k]);
  console.log(`-- team.${k}\n${sql};\n`);
}
console.table(results);
const bad = results.filter((r) => !r.match);
console.log(bad.length ? `MISMATCH on ${bad.length} metric(s)` : `All ${results.length} metrics match.`);
process.exit(bad.length ? 1 : 0);
