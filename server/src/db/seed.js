// `npm run seed` — wipes the database and loads the deterministic demo data from shared/seed.js.
import bcrypt from 'bcryptjs';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

import { generateSeed } from '../../../shared/seed.js';
import { openDb } from './index.js';
import { UPLOAD_DIR, DB_FILE } from '../config.js';

const TABLES = ['notification_log', 'integration_events', 'activity_timeline', 'weekly_reports', 'daily_reports', 'performance_records', 'score_overrides',
  'manager_reviews', 'blockers', 'task_comments', 'task_evidence', 'tasks', 'settings', 'users', 'teams'];

/** opts.clearUploads: also delete uploaded evidence files (their DB rows are being wiped). */
export function seedDatabase(db, now = new Date(), opts = {}) {
  const s = generateSeed(now);
  const hash = bcrypt.hashSync('demo1234', 10);
  const nowIso = now.toISOString();
  db.tx(() => {
    // Users are re-inserted with the same ids, so rows that survive a reset (viaSocket connections) stay valid:
    // check foreign keys once at commit instead of on every delete.
    db.exec('PRAGMA defer_foreign_keys = ON');
    // Keep the "integrations switched on at" marker: without it the first event after a reset would be dated
    // before a freshly made marker and skipped as history (outbox.js enabledAt).
    const keep = db.all("SELECT key, value_json FROM settings WHERE key IN ('integrations_enabled_at')");
    for (const t of TABLES) db.exec(`DELETE FROM ${t}`);
    for (const t of s.teams) db.insert('teams', t);
    for (const u of s.users) db.insert('users', { ...u, password_hash: hash, created_at: nowIso, updated_at: nowIso });
    for (const t of s.tasks) db.insert('tasks', t);
    for (const e of s.evidence) db.insert('task_evidence', e);
    for (const c of s.comments) db.insert('task_comments', c);
    for (const b of s.blockers) db.insert('blockers', b);
    for (const r of s.reviews) db.insert('manager_reviews', r);
    for (const e of s.timeline) db.insert('activity_timeline', e);
    for (const [key, value] of Object.entries(s.settings)) db.insert('settings', { key, value_json: JSON.stringify(value) });
    for (const k of keep) db.insert('settings', k);
  });
  if (opts.clearUploads && fs.existsSync(UPLOAD_DIR)) {
    for (const f of fs.readdirSync(UPLOAD_DIR)) if (f !== '.gitkeep') fs.rmSync(path.join(UPLOAD_DIR, f), { force: true });
  }
  return { users: s.users.length, tasks: s.tasks.length, evidence: s.evidence.length, reviews: s.reviews.length, blockers: s.blockers.length, timeline: s.timeline.length };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const db = openDb(DB_FILE);
  const counts = seedDatabase(db, new Date(), { clearUploads: true });
  const { recomputeAll } = await import('../scoring/index.js');
  console.log('Seeded WorkLens demo data:', counts, `· weekly scores stored for ${recomputeAll(db)} employees`);
  console.log('Logins: manager@worklens.dev / aarav@worklens.dev (and priya, rohan, zoya, kabir) — password demo1234');
  db.close();
}
