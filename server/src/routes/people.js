import { Router } from 'express';
import { z } from 'zod';
import { h, parse, badRequest, notFound } from '../lib/http.js';
import { logEvent, markChanged } from '../lib/events.js';
import { requireManager, publicUserCols } from '../auth.js';
import { assertCanSeeUser, visibleUsers, isManager, canSeeUser } from '../access.js';
import { snapshot, getPrefs } from '../services/data.js';
import { saveReport, getSaved, history } from '../services/reports.js';
import { isConfigured as vsConfigured } from '../integrations/viasocket.js';
import { recomputeUser, storedRecords } from '../scoring/index.js';
import { computeScores } from '../scoring/index.js';
import { employeeDashboard, managerDashboard, performanceView, teamPerformance, dailyReport, weeklyReport, insights, meta, dk } from '../services/views.js';

const id = z.coerce.number().int().positive();
const DIMENSION = z.enum(['productivity', 'quality', 'impact', 'consistency', 'ownership']);
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use YYYY-MM-DD');
const strip = ({ category, ...u }) => u;

export function peopleRoutes(db) {
  const r = Router();

  /** Resolve the report audience: omitted → self, 'team' → viewer's visible users, number → that (visible) user. */
  function audience(req) {
    const raw = req.query.user_id;
    if (raw === 'team') return visibleUsers(db, req.user);
    const uid = raw ? parse(id, raw) : req.user.id;
    assertCanSeeUser(db, req.user, uid);
    return [db.get(`SELECT ${publicUserCols} FROM users WHERE id = ?`, [uid])];
  }

  r.get('/users/team', h((req, res) => res.json(visibleUsers(db, req.user).map(strip))));
  r.get('/users/:id', h((req, res) => {
    const uid = parse(id, req.params.id);
    assertCanSeeUser(db, req.user, uid);
    res.json(db.get(`SELECT ${publicUserCols} FROM users WHERE id = ?`, [uid]));
  }));

  r.get('/timeline', h((req, res) => {
    const uid = req.query.user_id ? parse(id, req.query.user_id) : req.user.id;
    assertCanSeeUser(db, req.user, uid);
    res.json(db.all('SELECT id, user_id, task_id, event_type, title, detail, occurred_at FROM activity_timeline WHERE user_id = ? ORDER BY occurred_at DESC, id DESC', [uid]));
  }));

  r.get('/performance', h((req, res) => {
    const uid = req.query.user_id ? parse(id, req.query.user_id) : req.user.id;
    assertCanSeeUser(db, req.user, uid);
    res.json(performanceView(snapshot(db, [uid]), uid));
  }));

  r.post('/performance/overrides', requireManager, h((req, res) => {
    const p = parse(z.object({ user_id: z.number().int(), period_start: dateStr, dimension: DIMENSION, new_value: z.number().int().min(0).max(100), reason: z.string().trim().min(10, 'Explain the adjustment (at least 10 characters)').max(1000) }), req.body);
    assertCanSeeUser(db, req.user, p.user_id);
    if (p.user_id === req.user.id) throw badRequest('You can’t adjust your own score');
    const s = snapshot(db, [p.user_id]);
    const original = computeScores({ ...s, score_overrides: [] }, p.user_id, new Date(p.period_start + 'T00:00:00'), { now: new Date() }).dimensions[p.dimension].value;
    db.tx(() => {
      db.run('DELETE FROM score_overrides WHERE user_id = ? AND period_start = ? AND dimension = ?', [p.user_id, p.period_start, p.dimension]);
      db.insert('score_overrides', { user_id: p.user_id, period_start: p.period_start, dimension: p.dimension, original_value: original, new_value: p.new_value, reason: p.reason, manager_id: req.user.id });
      logEvent(db, { user_id: p.user_id, event_type: 'feedback', title: `Score adjusted: ${p.dimension}`, detail: `${original ?? '—'} → ${p.new_value}. ${p.reason}` });
    });
    res.status(201).json({ ok: true });
  }));

  r.delete('/performance/overrides', requireManager, h((req, res) => {
    const p = parse(z.object({ user_id: id, period_start: dateStr, dimension: DIMENSION }), req.query);
    assertCanSeeUser(db, req.user, p.user_id);
    db.run('DELETE FROM score_overrides WHERE user_id = ? AND period_start = ? AND dimension = ?', [p.user_id, p.period_start, p.dimension]);
    markChanged(db, p.user_id);
    res.status(204).end();
  }));

  r.get('/dashboard/employee', h((req, res) => {
    const d = employeeDashboard(snapshot(db, [req.user.id]), req.user.id);
    // The employee's own preference: hide the "Needs your attention" nudges.
    if (!getPrefs(db, req.user.id).in_app) d.attention = [];
    res.json(d);
  }));
  r.get('/dashboard/manager', requireManager, h((req, res) => {
    const team = visibleUsers(db, req.user);
    res.json(managerDashboard(snapshot(db, team.map((u) => u.id)), team));
  }));
  r.get('/team/performance', requireManager, h((req, res) => {
    const team = visibleUsers(db, req.user);
    res.json(teamPerformance(snapshot(db, team.map((u) => u.id)), team));
  }));

  const build = (kind, req, src) => {
    if (src.user_id === 'team' && !isManager(req.user)) throw badRequest('Team digests are for managers');
    const users = audience({ query: { user_id: src.user_id }, user: req.user });
    const key = src[kind === 'daily' ? 'date' : 'week'] ? parse(dateStr, src[kind === 'daily' ? 'date' : 'week']) : dk(new Date());
    const s = snapshot(db, users.map((u) => u.id));
    const r = kind === 'daily' ? dailyReport(s, key, users) : weeklyReport(s, key, users);
    if (src.user_id === 'team') { r.user_id = null; r.data.user_id = null; r.data.user_name = null; }
    return r;
  };
  // Preview (not stored)
  r.get('/reports/daily', h((req, res) => res.json(build('daily', req, req.query))));
  r.get('/reports/weekly', h((req, res) => res.json(build('weekly', req, req.query))));
  // Generate + store (replaces any earlier version for the same person/team + period)
  r.post('/reports/:kind/generate', h((req, res) => {
    const kind = parse(z.enum(['daily', 'weekly']), req.params.kind);
    const body = parse(z.object({ date: dateStr.optional(), week: dateStr.optional(), user_id: z.union([z.literal('team'), z.number().int()]).optional() }).strict(), req.body ?? {});
    if (body.user_id === 'team' && !isManager(req.user)) throw badRequest('Team digests are for managers');
    const rep = build(kind, req, { ...body, user_id: body.user_id === undefined ? undefined : String(body.user_id) });
    const savedId = saveReport(db, rep);
    res.status(201).json(getSaved(db, kind, savedId));
  }));
  r.get('/reports/history', h((req, res) => {
    const q = parse(z.object({ kind: z.enum(['daily', 'weekly']), user_id: z.string().optional() }), req.query);
    let userIds; let includeTeam = false;
    if (q.user_id === 'team') { if (!isManager(req.user)) throw badRequest('Team digests are for managers'); userIds = []; includeTeam = true; }
    else if (q.user_id) { const uid = parse(id, q.user_id); assertCanSeeUser(db, req.user, uid); userIds = [uid]; }
    else if (isManager(req.user)) { userIds = visibleUsers(db, req.user).map((u) => u.id); includeTeam = true; }
    else userIds = [req.user.id];
    res.json(history(db, q.kind, { userIds, includeTeam }));
  }));
  r.get('/reports/saved/:kind/:id', h((req, res) => {
    const kind = parse(z.enum(['daily', 'weekly']), req.params.kind);
    const rep = getSaved(db, kind, parse(id, req.params.id));
    if (!rep) throw notFound('Report not found');
    if (rep.user_id == null ? !isManager(req.user) : !canSeeUser(db, req.user, rep.user_id)) throw notFound('Report not found');
    res.json(rep);
  }));

  r.get('/performance/records', h((req, res) => {
    const uid = req.query.user_id ? parse(id, req.query.user_id) : req.user.id;
    assertCanSeeUser(db, req.user, uid);
    res.json(storedRecords(db, uid));
  }));
  r.post('/performance/recompute', h((req, res) => {
    const uid = req.body?.user_id ? parse(id, req.body.user_id) : req.user.id;
    assertCanSeeUser(db, req.user, uid);
    if (isManager(req.user) && uid === req.user.id) throw badRequest('Managers have no personal scores — pass user_id');
    recomputeUser(db, uid);
    res.json(storedRecords(db, uid));
  }));

  r.get('/insights', h((req, res) => {
    const ids = req.query.user_id ? (assertCanSeeUser(db, req.user, parse(id, req.query.user_id)), [Number(req.query.user_id)]) : visibleUsers(db, req.user).map((u) => u.id);
    const base = insights(snapshot(db, ids), ids);
    // Latest AI-written reports (saved by the daily/weekly workflows). Employees: their own; managers: the team digest.
    const own = !isManager(req.user) || req.query.user_id;
    const uid = own ? ids[0] : null;
    const latest = (table, key) => {
      const row = db.get(`SELECT * FROM ${table} WHERE user_id IS ? AND summary_source = 'ai' ORDER BY ${key} DESC LIMIT 1`, [uid]);
      if (!row) return null;
      const data = JSON.parse(row.data_json);
      return { saved_id: row.id, key: row[key], summary_text: row.summary_text, generated_at: row.updated_at, ai: data.ai ?? null, analysis: data.ai_analysis ?? null,
        source_task_ids: [...new Set([...data.completed, ...data.pending, ...data.blocked, ...data.planned].map((t) => t.id))] };
    };
    const pending_suggestions = db.all(`SELECT id, title, ai_suggestions_json FROM tasks WHERE user_id IN (${ids.map(() => '?').join(',')}) AND deleted_at IS NULL AND ai_suggestions_json LIKE '%"state":"pending"%' ORDER BY updated_at DESC LIMIT 6`, ids)
      .map((t) => { const s = JSON.parse(t.ai_suggestions_json); return { task_id: t.id, title: t.title, expected_outcome: s.expected_outcome, suggested_impact_level: s.suggested_impact_level }; });
    res.json({ ...base, ai_connected: vsConfigured(), latest_daily: latest('daily_reports', 'report_date'), latest_weekly: latest('weekly_reports', 'week_start'), pending_suggestions });
  }));

  r.get('/search', h((req, res) => {
    const q = String(req.query.q ?? '').trim().toLowerCase();
    if (!q) return res.json({ tasks: [], people: [] });
    const team = visibleUsers(db, req.user);
    const s = snapshot(db, team.map((u) => u.id));
    const tasks = s.tasks.filter((t) => !t.deleted_at && t.title.toLowerCase().includes(q)).slice(0, 8).map((t) => meta(s, t));
    const people = isManager(req.user) ? team.filter((u) => u.name.toLowerCase().includes(q)).map(strip) : [];
    res.json({ tasks, people });
  }));

  return r;
}
