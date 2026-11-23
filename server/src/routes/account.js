import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { h, parse, HttpError, badRequest } from '../lib/http.js';
import { issueSession, clearSession, requireManager, publicUserCols, sessionUser } from '../auth.js';
import { getSettings, setSetting, eventRow, getPrefs } from '../services/data.js';
import { markChanged } from '../lib/events.js';
import { seedDatabase } from '../db/seed.js';

/** Public routes (no session needed). */
export function authRoutes(db) {
  const r = Router();
  const attempts = new Map(); // naive per-email throttle against brute force
  r.post('/auth/login', h(async (req, res) => {
    const { email, password } = parse(z.object({ email: z.string().trim().toLowerCase().email('Enter a valid email'), password: z.string().min(1, 'Enter your password').max(200) }), req.body);
    const a = attempts.get(email) ?? { n: 0, t: Date.now() };
    if (Date.now() - a.t > 15 * 60000) { a.n = 0; a.t = Date.now(); }
    if (a.n >= 10) throw new HttpError(429, 'Too many attempts — try again in a few minutes');
    const row = db.get('SELECT * FROM users WHERE email = ?', [email]);
    const ok = row && (await bcrypt.compare(password, row.password_hash));
    if (!ok) { a.n++; attempts.set(email, a); throw new HttpError(401, 'Invalid email or password'); }
    attempts.delete(email);
    issueSession(res, row);
    res.json(db.get(`SELECT ${publicUserCols} FROM users WHERE id = ?`, [row.id]));
  }));
  // Public: lets the client check for a session without a 401 in the console.
  r.get('/auth/session', (req, res) => res.json({ user: sessionUser(db, req) }));
  r.post('/auth/logout', (_req, res) => { clearSession(res); res.status(204).end(); });
  return r;
}

const WEIGHTS = z.object({ productivity: z.number().int().min(0).max(100), quality: z.number().int().min(0).max(100), impact: z.number().int().min(0).max(100), consistency: z.number().int().min(0).max(100), ownership: z.number().int().min(0).max(100) }).strict();
const SettingsPatch = z.object({
  score_weights: WEIGHTS.refine((w) => Object.values(w).reduce((a, b) => a + b, 0) === 100, (w) => ({ message: `Weights must total 100% (currently ${Object.values(w).reduce((a, b) => a + b, 0)}%)` })),
  workday_end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'use HH:MM'),
  timezone: z.string().min(1).max(64),
  slack_channel: z.string().max(200).nullable(),
  report_recipients: z.array(z.string().email()).max(20),
  leave_days: z.record(z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/))),
  features: z.record(z.boolean()),
}).partial().strict();
const Prefs = z.object({ in_app: z.boolean(), slack_dm: z.boolean(), email_digest: z.boolean() }).strict();

/** Authenticated account/settings routes. */
export function accountRoutes(db) {
  const r = Router();
  r.get('/auth/me', (req, res) => res.json(req.user));

  r.patch('/me/profile', h((req, res) => {
    const p = parse(z.object({ name: z.string().trim().min(1, 'Name is required').max(100), title: z.string().trim().max(100), timezone: z.string().trim().min(1).max(64) }).partial().strict(), req.body);
    db.update('users', req.user.id, p);
    res.json(db.get(`SELECT ${publicUserCols} FROM users WHERE id = ?`, [req.user.id]));
  }));

  r.get('/settings', h((_req, res) => res.json(getSettings(db))));
  r.patch('/settings', requireManager, h((req, res) => {
    const p = parse(SettingsPatch, req.body);
    db.tx(() => { for (const [k, v] of Object.entries(p)) setSetting(db, k, v); });
    if (p.score_weights || p.leave_days) markChanged(db, 'all');
    res.json(getSettings(db));
  }));

  r.get('/settings/prefs', h((req, res) => {
    res.json(getPrefs(db, req.user.id));
  }));
  r.put('/settings/prefs', h((req, res) => {
    const p = parse(Prefs, req.body);
    setSetting(db, `prefs:${req.user.id}`, p);
    res.json(p);
  }));

  r.post('/admin/reset-demo', requireManager, h((_req, res) => {
    if (process.env.ALLOW_DEMO_RESET === 'false') throw badRequest('Demo reset is disabled');
    seedDatabase(db, new Date(), { clearUploads: true });
    markChanged(db, 'all');
    res.status(204).end();
  }));
  return r;
}
