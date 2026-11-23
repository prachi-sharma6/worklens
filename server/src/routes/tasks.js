import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { UPLOAD_DIR } from '../config.js';
import { z } from 'zod';
import { h, parse, badRequest, notFound } from '../lib/http.js';
import { logEvent, enqueue, nowIso, markChanged } from '../lib/events.js';
import { requireManager } from '../auth.js';
import { assertCanSeeUser, getTaskFor, visibleUserIds, isManager, visibleUsers } from '../access.js';
import { snapshot, taskRow, blockerRow } from '../services/data.js';
import { filterTasks, meta, reviewQueue, dk } from '../services/views.js';

export { UPLOAD_DIR };
const ALLOWED = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif', 'application/pdf': '.pdf' };
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _f, cb) => { fs.mkdirSync(UPLOAD_DIR, { recursive: true }); cb(null, UPLOAD_DIR); },
    filename: (_req, f, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ALLOWED[f.mimetype]}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 10 },
  fileFilter: (_req, f, cb) => (ALLOWED[f.mimetype] ? cb(null, true) : cb(badRequest('Only PNG, JPEG, WebP, GIF or PDF files are allowed'))),
});

const id = z.coerce.number().int().positive();
const isoDate = z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'must be a date').transform((v) => new Date(v).toISOString());
const TaskInput = z.object({
  title: z.string().trim().min(1, 'Title is required').max(200),
  description: z.string().max(5000).nullish(),
  category: z.string().trim().max(40).nullish(),
  priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  expected_outcome: z.string().max(1000).nullish(),
  estimated_minutes: z.coerce.number().int().min(0).max(100000).nullish(),
  deadline: isoDate.nullish(),
  impact_level: z.enum(['low', 'medium', 'high']).optional(),
  impact_note: z.string().max(1000).nullish(),
  is_planned_today: z.boolean().optional(),
}).strict();
const TaskPatch = TaskInput.partial().extend({ actual_outcome: z.string().max(2000).nullish(), actual_minutes: z.coerce.number().int().min(0).max(100000).nullish() }).strict();

const GITHUB_RE = /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/(pull\/\d+|commit\/[0-9a-f]{7,40})/i;
const EvidenceInput = z.object({
  type: z.enum(['github', 'document', 'screenshot', 'test_result', 'deliverable', 'explanation']),
  url: z.string().trim().url('must be a valid URL').max(2000).nullish().or(z.literal('')),
  note: z.string().trim().max(5000).nullish(),
}).superRefine((e, ctx) => {
  if (e.type === 'github' && !GITHUB_RE.test(e.url ?? '')) ctx.addIssue({ code: 'custom', message: 'Enter a GitHub pull request or commit URL', path: ['url'] });
  if (e.type === 'explanation' && (e.note ?? '').length < 30) ctx.addIssue({ code: 'custom', message: 'Written explanation must be at least 30 characters', path: ['note'] });
  if ((e.type === 'document' || e.type === 'deliverable') && !e.url) ctx.addIssue({ code: 'custom', message: 'A link is required', path: ['url'] });
  if (e.type === 'test_result' && !e.url && !e.note) ctx.addIssue({ code: 'custom', message: 'Add a link or paste the test output', path: ['note'] });
});

/** JSON body, or multipart with a `payload` JSON field. */
const body = (req) => (typeof req.body?.payload === 'string' ? JSON.parse(req.body.payload) : req.body ?? {});
const removeFiles = (files) => (files ?? []).forEach((f) => fs.rm(f.path, { force: true }, () => {}));

function insertEvidence(db, task, ev, file, viewer) {
  if (ev.type === 'screenshot' && !file) throw badRequest('Attach a screenshot file (PNG, JPEG or PDF, max 5 MB)');
  const at = nowIso();
  const evId = db.insert('task_evidence', { task_id: task.id, type: ev.type, url: ev.url || null, file_path: file ? path.basename(file.path) : null, note: ev.note || null, submitted_at: at });
  logEvent(db, { user_id: viewer.id, task_id: task.id, event_type: 'evidence_submitted', title: `Evidence added to “${task.title}”`, detail: ev.type.replace('_', ' ') });
  return evId;
}

export function taskRoutes(db) {
  const r = Router();
  const one = (tid) => meta(snapshot(db, [db.get('SELECT user_id FROM tasks WHERE id = ?', [tid]).user_id]), taskRow(db.get('SELECT * FROM tasks WHERE id = ?', [tid])));

  // ---------- tasks ----------
  r.get('/tasks', h((req, res) => {
    const q = parse(z.object({
      q: z.string().optional(), status: z.enum(['not_started', 'in_progress', 'completed', 'blocked', '']).optional(),
      priority: z.enum(['low', 'medium', 'high', 'critical', '']).optional(), category: z.string().optional(),
      sort: z.enum(['deadline', 'created', 'priority']).optional(), user_id: id.optional(),
      overdue: z.enum(['1', 'true', '0', 'false', '']).optional().transform((v) => v === '1' || v === 'true'),
    }), req.query);
    const uid = q.user_id ?? req.user.id;
    assertCanSeeUser(db, req.user, uid);
    res.json(filterTasks(snapshot(db, [uid]), uid, q));
  }));

  r.get('/tasks/:id', h((req, res) => {
    const t = getTaskFor(db, req.user, parse(id, req.params.id));
    const s = snapshot(db, [t.user_id]);
    const owner = s.users.find((u) => u.id === t.user_id);
    const names = new Map(db.all('SELECT id, name FROM users').map((u) => [u.id, u.name]));
    res.json({
      task: meta(s, taskRow(t)),
      owner: (({ category, ...u }) => u)(owner),
      evidence: s.evidence.filter((e) => e.task_id === t.id),
      comments: db.all('SELECT * FROM task_comments WHERE task_id = ? ORDER BY created_at, id', [t.id]).map((c) => ({ ...c, author_name: names.get(c.author_id) })),
      blockers: s.blockers.filter((b) => b.task_id === t.id),
      reviews: s.reviews.filter((x) => x.task_id === t.id).map((x) => ({ ...x, manager_name: names.get(x.manager_id) })),
      timeline: s.timeline.filter((e) => e.task_id === t.id).sort((a, b) => b.occurred_at.localeCompare(a.occurred_at)),
    });
  }));

  r.post('/tasks', h((req, res) => {
    if (isManager(req.user)) throw badRequest('Managers don’t own tasks in WorkLens');
    const b = parse(TaskInput, req.body);
    const me = db.get('SELECT category FROM users WHERE id = ?', [req.user.id]);
    const planned = b.is_planned_today ?? true;
    const tid = db.tx(() => {
      const newId = db.insert('tasks', {
        user_id: req.user.id, title: b.title, description: b.description ?? null, category: b.category || me?.category || 'general',
        priority: b.priority ?? 'medium', expected_outcome: b.expected_outcome ?? null, estimated_minutes: b.estimated_minutes ?? null,
        deadline: b.deadline ?? null, impact_level: b.impact_level ?? 'medium', impact_note: b.impact_note ?? null,
        is_planned_today: planned, planned_for_date: planned ? dk(new Date()) : null, status: 'not_started', verification_status: 'unsubmitted',
      });
      logEvent(db, { user_id: req.user.id, task_id: newId, event_type: 'task_created', title: `Created “${b.title}”` });
      enqueue(db, 'task.created', { task_id: newId });
      return newId;
    });
    res.status(201).json(one(tid));
  }));

  r.patch('/tasks/:id', h((req, res) => {
    const t = getTaskFor(db, req.user, parse(id, req.params.id), 'owner');
    const b = parse(TaskPatch, req.body);
    if ('is_planned_today' in b) b.planned_for_date = b.is_planned_today ? dk(new Date()) : null;
    db.update('tasks', t.id, b);
    markChanged(db, t.user_id);
    res.json(one(t.id));
  }));

  r.post('/tasks/:id/status', h((req, res) => {
    const t = getTaskFor(db, req.user, parse(id, req.params.id), 'owner');
    const { status } = parse(z.object({ status: z.enum(['not_started', 'in_progress', 'completed', 'blocked']) }), req.body);
    if (status === 'completed') throw badRequest('Use the wrap-up flow to complete a task');
    if (status === 'blocked') throw badRequest('Report a blocker to block a task');
    if (t.status === 'blocked') throw badRequest('Resolve the open blocker first');
    db.update('tasks', t.id, { status, started_at: status === 'in_progress' ? t.started_at ?? nowIso() : null, completed_at: null, verification_status: t.status === 'completed' ? 'unsubmitted' : t.verification_status });
    markChanged(db, t.user_id);
    res.json(one(t.id));
  }));

  r.post('/tasks/:id/complete', upload.any(), h((req, res) => {
    try {
      const t = getTaskFor(db, req.user, parse(id, req.params.id), 'owner');
      if (t.status === 'blocked') throw badRequest('Resolve the open blocker before completing');
      if (t.status === 'completed') throw badRequest('Task is already completed');
      const p = parse(z.object({
        actual_outcome: z.string().trim().min(1, 'Describe the actual outcome').max(2000),
        actual_minutes: z.coerce.number().int().min(0).max(100000).nullish(),
        evidence: z.array(EvidenceInput).max(10).default([]),
      }), body(req));
      const files = new Map((req.files ?? []).map((f) => [f.fieldname, f]));
      db.tx(() => {
        const now = nowIso();
        db.update('tasks', t.id, { status: 'completed', completed_at: now, started_at: t.started_at ?? now, actual_outcome: p.actual_outcome, actual_minutes: p.actual_minutes ?? null });
        logEvent(db, { user_id: req.user.id, task_id: t.id, event_type: 'task_completed', title: `Completed “${t.title}”`, detail: p.actual_outcome });
        p.evidence.forEach((ev, i) => insertEvidence(db, t, ev, files.get(`file_${i}`), req.user));
        const has = !!db.get('SELECT 1 AS x FROM task_evidence WHERE task_id = ?', [t.id]);
        db.update('tasks', t.id, { verification_status: has ? 'pending' : 'unsubmitted' });
        enqueue(db, 'task.completed', { task_id: t.id, has_evidence: has });
      });
      res.json(one(t.id));
    } catch (e) { removeFiles(req.files); throw e; }
  }));

  r.delete('/tasks/:id', h((req, res) => {
    const t = getTaskFor(db, req.user, parse(id, req.params.id), 'owner');
    db.update('tasks', t.id, { deleted_at: nowIso() });
    markChanged(db, t.user_id);
    res.status(204).end();
  }));

  /** After a clarification request or rejection: employee replies and sends the task back to review. */
  r.post('/tasks/:id/resubmit', h((req, res) => {
    const t = getTaskFor(db, req.user, parse(id, req.params.id), 'owner');
    const { response } = parse(z.object({ response: z.string().trim().min(10, 'Explain what changed (at least 10 characters)').max(5000) }), req.body);
    if (t.status !== 'completed' || !['clarification_requested', 'rejected'].includes(t.verification_status)) throw badRequest('Only tasks sent back by your manager can be resubmitted');
    if (!db.get('SELECT 1 AS x FROM task_evidence WHERE task_id = ?', [t.id])) throw badRequest('Add at least one piece of evidence before resubmitting');
    db.tx(() => {
      db.insert('task_comments', { task_id: t.id, author_id: req.user.id, body: response, kind: 'clarification' });
      db.update('tasks', t.id, { verification_status: 'pending' });
      enqueue(db, 'task.resubmitted', { task_id: t.id });
      markChanged(db, t.user_id);
    });
    res.json(one(t.id));
  }));

  /** AI suggestions are only ever applied by the owner's choice: accept some fields, or dismiss. */
  r.post('/tasks/:id/ai-suggestions', h((req, res) => {
    const t = taskRow(getTaskFor(db, req.user, parse(id, req.params.id), 'owner'));
    const p = parse(z.object({ action: z.enum(['accept', 'dismiss']), fields: z.array(z.enum(['category', 'expected_outcome', 'impact_level'])).default([]) }), req.body);
    const sug = t.ai_suggestions_json;
    if (!sug) throw badRequest('No AI suggestions for this task');
    const patch = {};
    if (p.action === 'accept') {
      if (p.fields.includes('category')) patch.category = sug.category;
      if (p.fields.includes('expected_outcome')) patch.expected_outcome = sug.expected_outcome;
      if (p.fields.includes('impact_level')) { patch.impact_level = sug.suggested_impact_level; patch.impact_note = t.impact_note || sug.impact_rationale; }
    }
    db.update('tasks', t.id, { ...patch, ai_suggestions_json: JSON.stringify({ ...sug, state: p.action === 'accept' ? 'accepted' : 'dismissed', applied: p.fields }) });
    if (Object.keys(patch).length) markChanged(db, t.user_id);
    res.json(one(t.id));
  }));

  // ---------- evidence ----------
  r.get('/evidence', h((req, res) => {
    const uid = req.query.user_id ? parse(id, req.query.user_id) : req.user.id;
    assertCanSeeUser(db, req.user, uid);
    res.json(db.all(`SELECT e.*, t.title AS task_title, t.verification_status FROM task_evidence e JOIN tasks t ON t.id = e.task_id
                     WHERE t.user_id = ? AND t.deleted_at IS NULL ORDER BY e.submitted_at DESC`, [uid]));
  }));

  r.post('/tasks/:id/evidence', upload.single('file'), h((req, res) => {
    try {
      const t = getTaskFor(db, req.user, parse(id, req.params.id), 'owner');
      const ev = parse(EvidenceInput, body(req));
      const evId = db.tx(() => {
        const x = insertEvidence(db, t, ev, req.file, req.user);
        // Completed-without-evidence tasks enter review once evidence arrives. Sent-back tasks need an explicit resubmit (with a response).
        if (t.status === 'completed' && t.verification_status === 'unsubmitted') db.update('tasks', t.id, { verification_status: 'pending' });
        return x;
      });
      res.status(201).json(db.get('SELECT * FROM task_evidence WHERE id = ?', [evId]));
    } catch (e) { removeFiles(req.file ? [req.file] : []); throw e; }
  }));

  r.delete('/evidence/:id', h((req, res) => {
    const e = db.get('SELECT * FROM task_evidence WHERE id = ?', [parse(id, req.params.id)]);
    if (!e) throw notFound();
    getTaskFor(db, req.user, e.task_id, 'owner');
    db.run('DELETE FROM task_evidence WHERE id = ?', [e.id]);
    markChanged(db, db.get('SELECT user_id FROM tasks WHERE id = ?', [e.task_id]).user_id);
    if (e.file_path) fs.rm(path.join(UPLOAD_DIR, path.basename(e.file_path)), { force: true }, () => {});
    res.status(204).end();
  }));

  r.get('/evidence/:id/file', h((req, res) => {
    const e = db.get('SELECT * FROM task_evidence WHERE id = ?', [parse(id, req.params.id)]);
    if (!e?.file_path) throw notFound();
    getTaskFor(db, req.user, e.task_id);
    const file = path.join(UPLOAD_DIR, path.basename(e.file_path));
    if (!fs.existsSync(file)) throw notFound('File missing');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.sendFile(file);
  }));

  // ---------- comments ----------
  r.post('/tasks/:id/comments', h((req, res) => {
    const t = getTaskFor(db, req.user, parse(id, req.params.id));
    const { body: text } = parse(z.object({ body: z.string().trim().min(1, 'Comment is empty').max(5000) }), req.body);
    const cid = db.insert('task_comments', { task_id: t.id, author_id: req.user.id, body: text, kind: 'comment' });
    res.status(201).json({ ...db.get('SELECT * FROM task_comments WHERE id = ?', [cid]), author_name: req.user.name });
  }));

  // ---------- blockers ----------
  r.get('/blockers', h((req, res) => {
    const q = parse(z.object({ status: z.enum(['open', 'resolved']).optional(), user_id: id.optional() }), req.query);
    let ids = visibleUserIds(db, req.user);
    if (q.user_id) { assertCanSeeUser(db, req.user, q.user_id); ids = [q.user_id]; }
    const rows = db.all(`SELECT b.*, t.title AS task_title, u.name AS user_name FROM blockers b JOIN tasks t ON t.id = b.task_id JOIN users u ON u.id = b.user_id
                         WHERE b.user_id IN (${ids.map(() => '?').join(',')}) ${q.status ? 'AND b.status = ?' : ''} ORDER BY b.opened_at DESC`, q.status ? [...ids, q.status] : ids);
    res.json(rows.map(blockerRow));
  }));

  r.post('/tasks/:id/blockers', h((req, res) => {
    const t = getTaskFor(db, req.user, parse(id, req.params.id), 'owner');
    const b = parse(z.object({
      description: z.string().trim().min(5, 'Describe the blocker').max(2000),
      dependency_type: z.enum(['person', 'team', 'external', 'tool', 'unclear']),
      dependency_name: z.string().trim().max(200).nullish(),
      is_external: z.boolean(),
    }), req.body);
    if (t.status === 'completed') throw badRequest('Task is already completed');
    if (db.get("SELECT 1 AS x FROM blockers WHERE task_id = ? AND status = 'open'", [t.id])) throw badRequest('This task already has an open blocker');
    const bid = db.tx(() => {
      const now = nowIso();
      const newId = db.insert('blockers', { task_id: t.id, user_id: req.user.id, description: b.description, dependency_type: b.dependency_type, dependency_name: b.dependency_name || null, is_external: b.is_external, status: 'open', opened_at: now });
      db.update('tasks', t.id, { status: 'blocked', started_at: t.started_at ?? now });
      logEvent(db, { user_id: req.user.id, task_id: t.id, event_type: 'blocker_opened', title: `Blocked: ${t.title}`, detail: b.description });
      enqueue(db, 'blocker.opened', { blocker_id: newId, task_id: t.id });
      return newId;
    });
    res.status(201).json(blockerRow(db.get('SELECT * FROM blockers WHERE id = ?', [bid])));
  }));

  r.post('/blockers/:id/resolve', h((req, res) => {
    const b = db.get('SELECT * FROM blockers WHERE id = ?', [parse(id, req.params.id)]);
    if (!b) throw notFound();
    const t = getTaskFor(db, req.user, b.task_id, 'owner');
    if (b.status === 'resolved') throw badRequest('Blocker is already resolved');
    const { note } = parse(z.object({ note: z.string().trim().max(2000).optional().default('') }), req.body ?? {});
    db.tx(() => {
      db.update('blockers', b.id, { status: 'resolved', resolved_at: nowIso(), resolution_note: note || null });
      db.update('tasks', t.id, { status: 'in_progress' });
      logEvent(db, { user_id: req.user.id, task_id: t.id, event_type: 'blocker_resolved', title: `Unblocked: ${t.title}`, detail: note || null });
      enqueue(db, 'blocker.resolved', { blocker_id: b.id, task_id: t.id });
    });
    res.json(blockerRow(db.get('SELECT * FROM blockers WHERE id = ?', [b.id])));
  }));

  // ---------- reviews ----------
  r.get('/reviews/queue', requireManager, h((req, res) => {
    const team = visibleUsers(db, req.user);
    res.json(reviewQueue(snapshot(db, team.map((u) => u.id)), team));
  }));

  r.post('/tasks/:id/reviews', requireManager, h((req, res) => {
    const t = getTaskFor(db, req.user, parse(id, req.params.id), 'review');
    const p = parse(z.object({
      decision: z.enum(['verified', 'clarification_requested', 'rejected']),
      note: z.string().trim().max(2000).optional(),
      quality_rating: z.number().int().min(1).max(5).nullish(),
    }), req.body);
    if (t.status !== 'completed') throw badRequest('Only completed tasks can be reviewed');
    if (p.decision !== 'verified' && !p.note) throw badRequest('A note is required for this decision');
    const rid = db.tx(() => {
      const newId = db.insert('manager_reviews', { task_id: t.id, manager_id: req.user.id, decision: p.decision, note: p.note || null, quality_rating: p.quality_rating ?? null });
      db.update('tasks', t.id, { verification_status: p.decision });
      if (p.note) db.insert('task_comments', { task_id: t.id, author_id: req.user.id, body: p.note, kind: p.decision === 'verified' ? 'decision' : 'clarification' });
      logEvent(db, { user_id: t.user_id, task_id: t.id, event_type: p.decision === 'verified' ? 'verified' : 'feedback', title: p.decision === 'verified' ? `Verified: ${t.title}` : `Feedback on “${t.title}”`, detail: p.note || null });
      if (p.decision === 'verified' && t.impact_level === 'high') logEvent(db, { user_id: t.user_id, task_id: t.id, event_type: 'achievement', title: `High-impact delivery: ${t.title}`, detail: t.expected_outcome });
      enqueue(db, 'review.decided', { task_id: t.id, decision: p.decision });
      return newId;
    });
    res.status(201).json({ ...db.get('SELECT * FROM manager_reviews WHERE id = ?', [rid]), manager_name: req.user.name });
  }));

  return r;
}
