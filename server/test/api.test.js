// API tests: auth, role/ownership checks, CRUD. Fresh in-memory DB per suite.
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';
const { openDb } = await import('../src/db/index.js');
const { seedDatabase } = await import('../src/db/seed.js');
const { createApp } = await import('../src/app.js');

function setup(opts) {
  const db = openDb(':memory:');
  seedDatabase(db);
  const app = createApp(db, opts);
  const login = async (email) => {
    const agent = request.agent(app);
    const r = await agent.post('/api/auth/login').send({ email, password: 'demo1234' });
    assert.equal(r.status, 200, `login ${email}`);
    return agent;
  };
  const taskOf = (userId) => db.get('SELECT * FROM tasks WHERE user_id = ? AND deleted_at IS NULL ORDER BY id LIMIT 1', [userId]);
  return { db, app, login, taskOf };
}

describe('auth', () => {
  const { app, login } = setup();
  test('rejects wrong password', async () => {
    const r = await request(app).post('/api/auth/login').send({ email: 'aarav@worklens.dev', password: 'nope' });
    assert.equal(r.status, 401);
  });
  test('validates email format', async () => {
    const r = await request(app).post('/api/auth/login').send({ email: 'not-an-email', password: 'x' });
    assert.equal(r.status, 400);
  });
  test('sets an httpOnly SameSite=Lax cookie and /me works', async () => {
    const r = await request(app).post('/api/auth/login').send({ email: 'AARAV@worklens.dev', password: 'demo1234' });
    assert.equal(r.status, 200);
    const cookie = r.headers['set-cookie'][0];
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Lax/i);
    assert.equal(r.body.password_hash, undefined, 'never leaks the hash');
    const me = await request(app).get('/api/auth/me').set('Cookie', cookie);
    assert.equal(me.status, 200);
    assert.equal(me.body.email, 'aarav@worklens.dev');
  });
  test('protected routes need a session', async () => {
    for (const p of ['/api/auth/me', '/api/tasks', '/api/dashboard/employee', '/api/settings']) {
      assert.equal((await request(app).get(p)).status, 401, p);
    }
  });
  test('public session check returns null instead of 401', async () => {
    const r = await request(app).get('/api/auth/session');
    assert.equal(r.status, 200);
    assert.equal(r.body.user, null);
  });
  test('tampered token is rejected', async () => {
    const r = await request(app).get('/api/auth/me').set('Cookie', 'wl_token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOjF9.bad');
    assert.equal(r.status, 401);
  });
  test('logout clears the session cookie', async () => {
    const a = await login('aarav@worklens.dev');
    const r = await a.post('/api/auth/logout');
    assert.equal(r.status, 204);
    assert.equal((await a.get('/api/auth/me')).status, 401);
  });
});

describe('authorization', () => {
  const { db, login, taskOf } = setup();
  const aarav = 2, priya = 3;

  test('employee A cannot read employee B’s task (404, existence hidden)', async () => {
    const a = await login('aarav@worklens.dev');
    const t = taskOf(priya);
    assert.equal((await a.get(`/api/tasks/${t.id}`)).status, 404);
  });
  test('employee A cannot modify, complete, block, evidence or delete B’s task', async () => {
    const a = await login('aarav@worklens.dev');
    const t = taskOf(priya);
    assert.equal((await a.patch(`/api/tasks/${t.id}`).send({ title: 'hijack' })).status, 404);
    assert.equal((await a.post(`/api/tasks/${t.id}/status`).send({ status: 'in_progress' })).status, 404);
    assert.equal((await a.post(`/api/tasks/${t.id}/complete`).send({ actual_outcome: 'x' })).status, 404);
    assert.equal((await a.post(`/api/tasks/${t.id}/blockers`).send({ description: 'stuck here', dependency_type: 'team', is_external: false })).status, 404);
    assert.equal((await a.post(`/api/tasks/${t.id}/evidence`).send({ type: 'document', url: 'https://x.dev/a' })).status, 404);
    assert.equal((await a.delete(`/api/tasks/${t.id}`)).status, 404);
    assert.equal(db.get('SELECT title FROM tasks WHERE id = ?', [t.id]).title, t.title);
  });
  test('user_id filters on list endpoints are checked, not trusted', async () => {
    const a = await login('aarav@worklens.dev');
    for (const p of [`/api/tasks?user_id=${priya}`, `/api/evidence?user_id=${priya}`, `/api/timeline?user_id=${priya}`, `/api/performance?user_id=${priya}`, `/api/reports/daily?user_id=${priya}`, `/api/insights?user_id=${priya}`]) {
      assert.equal((await a.get(p)).status, 404, p);
    }
  });
  test('user_id in a create body is ignored — task is owned by the session user', async () => {
    const a = await login('aarav@worklens.dev');
    const r = await a.post('/api/tasks').send({ title: 'Mine', user_id: priya });
    assert.equal(r.status, 400, 'unknown keys rejected by strict schema');
    const ok = await a.post('/api/tasks').send({ title: 'Mine' });
    assert.equal(ok.status, 201);
    assert.equal(ok.body.user_id, aarav);
  });
  test('employee cannot use manager endpoints', async () => {
    const a = await login('aarav@worklens.dev');
    assert.equal((await a.get('/api/dashboard/manager')).status, 403);
    assert.equal((await a.get('/api/team/performance')).status, 403);
    assert.equal((await a.get('/api/reviews/queue')).status, 403);
    assert.equal((await a.patch('/api/settings').send({ workday_end: '17:00' })).status, 403);
    assert.equal((await a.post('/api/admin/reset-demo')).status, 403);
    const own = taskOf(aarav);
    assert.equal((await a.post(`/api/tasks/${own.id}/reviews`).send({ decision: 'verified' })).status, 403, 'cannot self-review');
    assert.equal((await a.post('/api/performance/overrides').send({ user_id: aarav, period_start: '2026-11-16', dimension: 'quality', new_value: 100, reason: 'I deserve it, honestly' })).status, 403);
  });
  test('manager can read team tasks but not edit them', async () => {
    const m = await login('manager@worklens.dev');
    const t = taskOf(priya);
    assert.equal((await m.get(`/api/tasks/${t.id}`)).status, 200);
    assert.equal((await m.patch(`/api/tasks/${t.id}`).send({ title: 'x' })).status, 403);
    assert.equal((await m.get(`/api/tasks?user_id=${priya}`)).status, 200);
  });
  test('manager cannot see users outside their team', async () => {
    const m = await login('manager@worklens.dev');
    const other = db.insert('users', { name: 'Outsider', email: 'out@worklens.dev', password_hash: 'x', role: 'employee', team_id: 1, manager_id: null });
    const tid = db.insert('tasks', { user_id: other, title: 'Secret' });
    assert.equal((await m.get(`/api/tasks/${tid}`)).status, 404);
    assert.equal((await m.get(`/api/users/${other}`)).status, 404);
    const team = await m.get('/api/users/team');
    assert.ok(!team.body.some((u) => u.id === other));
  });
});

describe('task CRUD + lifecycle', () => {
  const { db, login } = setup();
  let a, m, id;
  before(async () => { a = await login('aarav@worklens.dev'); m = await login('manager@worklens.dev'); });

  test('create validates and writes timeline + outbox', async () => {
    assert.equal((await a.post('/api/tasks').send({ title: '   ' })).status, 400);
    const r = await a.post('/api/tasks').send({ title: 'Ship audit log', priority: 'high', deadline: '2030-01-01T10:00:00Z', expected_outcome: 'All admin actions logged' });
    assert.equal(r.status, 201);
    id = r.body.id;
    assert.equal(r.body.status, 'not_started');
    assert.equal(r.body.is_planned_today, true);
    assert.ok(db.get("SELECT 1 AS x FROM activity_timeline WHERE task_id = ? AND event_type = 'task_created'", [id]));
    assert.ok(db.get("SELECT 1 AS x FROM integration_events WHERE event_type = 'task.created' AND status = 'queued' AND payload_json LIKE ?", [`%"task_id":${id}%`]));
  });
  test('read + update', async () => {
    const u = await a.patch(`/api/tasks/${id}`).send({ title: 'Ship audit log v2', estimated_minutes: 120 });
    assert.equal(u.status, 200);
    assert.equal(u.body.title, 'Ship audit log v2');
    const g = await a.get(`/api/tasks/${id}`);
    assert.equal(g.body.task.estimated_minutes, 120);
    assert.equal(g.body.owner.id, 2);
    const list = await a.get('/api/tasks?q=audit');
    assert.ok(list.body.some((t) => t.id === id));
  });
  test('status: start sets started_at; complete/blocked need their flows', async () => {
    const s = await a.post(`/api/tasks/${id}/status`).send({ status: 'in_progress' });
    assert.equal(s.status, 200);
    assert.ok(s.body.started_at);
    assert.equal((await a.post(`/api/tasks/${id}/status`).send({ status: 'completed' })).status, 400);
    assert.equal((await a.post(`/api/tasks/${id}/status`).send({ status: 'blocked' })).status, 400);
  });
  test('blocker → task blocked; resolve → in progress', async () => {
    const b = await a.post(`/api/tasks/${id}/blockers`).send({ description: 'Waiting on platform for DB access', dependency_type: 'team', dependency_name: 'Platform team', is_external: false });
    assert.equal(b.status, 201);
    assert.equal(b.body.is_external, false);
    assert.equal((await a.get(`/api/tasks/${id}`)).body.task.status, 'blocked');
    assert.equal((await a.post(`/api/tasks/${id}/blockers`).send({ description: 'again', dependency_type: 'team', is_external: false })).status, 400, 'one open blocker per task');
    const r = await a.post(`/api/blockers/${b.body.id}/resolve`).send({ note: 'Access granted' });
    assert.equal(r.status, 200);
    assert.equal(r.body.status, 'resolved');
    assert.equal((await a.get(`/api/tasks/${id}`)).body.task.status, 'in_progress');
  });
  test('evidence validation', async () => {
    assert.equal((await a.post(`/api/tasks/${id}/evidence`).send({ type: 'github', url: 'https://gitlab.com/x/y/pull/1' })).status, 400);
    assert.equal((await a.post(`/api/tasks/${id}/evidence`).send({ type: 'explanation', note: 'too short' })).status, 400);
    assert.equal((await a.post(`/api/tasks/${id}/evidence`).send({ type: 'screenshot' })).status, 400, 'screenshot needs a file');
    const ok = await a.post(`/api/tasks/${id}/evidence`).send({ type: 'github', url: 'https://github.com/acme/app/pull/42' });
    assert.equal(ok.status, 201);
  });
  test('upload rejects non-image types', async () => {
    const r = await a.post(`/api/tasks/${id}/evidence`).field('payload', JSON.stringify({ type: 'screenshot' })).attach('file', Buffer.from('MZ fake exe'), { filename: 'x.exe', contentType: 'application/x-msdownload' });
    assert.equal(r.status, 400);
  });
  test('complete with evidence → pending review', async () => {
    const r = await a.post(`/api/tasks/${id}/complete`).send({ actual_outcome: 'Audit log live', actual_minutes: 150, evidence: [{ type: 'explanation', note: 'Added audit_log table and middleware; verified in staging.' }] });
    assert.equal(r.status, 200);
    assert.equal(r.body.status, 'completed');
    assert.equal(r.body.verification_status, 'pending');
    assert.equal(r.body.evidence_count, 2);
  });
  test('comments', async () => {
    assert.equal((await a.post(`/api/tasks/${id}/comments`).send({ body: '' })).status, 400);
    const c = await m.post(`/api/tasks/${id}/comments`).send({ body: 'Nice — can you add a screenshot?' });
    assert.equal(c.status, 201);
    assert.equal((await a.get(`/api/tasks/${id}`)).body.comments.length, 1);
  });
  test('manager review: note required for clarification; verify works', async () => {
    assert.equal((await m.post(`/api/tasks/${id}/reviews`).send({ decision: 'clarification_requested' })).status, 400);
    const v = await m.post(`/api/tasks/${id}/reviews`).send({ decision: 'verified', quality_rating: 4 });
    assert.equal(v.status, 201);
    const t = (await a.get(`/api/tasks/${id}`)).body;
    assert.equal(t.task.verification_status, 'verified');
    assert.equal(t.reviews.length, 1);
    assert.ok(t.timeline.some((e) => e.event_type === 'verified'));
  });
  test('complete without evidence → stays unsubmitted', async () => {
    const t = await a.post('/api/tasks').send({ title: 'Quick fix' });
    const r = await a.post(`/api/tasks/${t.body.id}/complete`).send({ actual_outcome: 'Fixed' });
    assert.equal(r.body.verification_status, 'unsubmitted');
  });
  test('delete is a soft delete and hides the task', async () => {
    const t = await a.post('/api/tasks').send({ title: 'Oops' });
    assert.equal((await a.delete(`/api/tasks/${t.body.id}`)).status, 204);
    assert.equal((await a.get(`/api/tasks/${t.body.id}`)).status, 404);
    assert.ok(db.get('SELECT deleted_at FROM tasks WHERE id = ?', [t.body.id]).deleted_at);
  });
  test('settings: weights must total 100', async () => {
    const bad = await m.patch('/api/settings').send({ score_weights: { productivity: 40, quality: 25, impact: 25, consistency: 15, ownership: 10 } });
    assert.equal(bad.status, 400);
    assert.match(bad.body.error, /100/);
    const ok = await m.patch('/api/settings').send({ score_weights: { productivity: 30, quality: 25, impact: 20, consistency: 15, ownership: 10 } });
    assert.equal(ok.status, 200);
  });
  test('override requires a reason and keeps the original', async () => {
    assert.equal((await m.post('/api/performance/overrides').send({ user_id: 2, period_start: '2026-11-16', dimension: 'quality', new_value: 90, reason: '' })).status, 400);
    const r = await m.post('/api/performance/overrides').send({ user_id: 2, period_start: '2026-11-16', dimension: 'quality', new_value: 90, reason: 'Reviewed late due to my leave' });
    assert.equal(r.status, 201);
    const row = db.get("SELECT * FROM score_overrides WHERE user_id = 2 AND dimension = 'quality'");
    assert.equal(row.new_value, 90);
    assert.ok('original_value' in row);
  });
  test('read views respond', async () => {
    for (const p of ['/api/dashboard/employee', '/api/performance', '/api/timeline', '/api/evidence', '/api/insights', '/api/reports/daily', '/api/reports/weekly', '/api/search?q=audit']) assert.equal((await a.get(p)).status, 200, p);
    for (const p of ['/api/dashboard/manager', '/api/team/performance', '/api/reviews/queue', '/api/reports/daily?user_id=team', '/api/integrations/events', '/api/performance?user_id=2']) assert.equal((await m.get(p)).status, 200, p);
  });
});

describe('phase 3: review loop, overdue, transitions', () => {
  const { db, login } = setup();
  let a, b, m, id;
  before(async () => { a = await login('aarav@worklens.dev'); b = await login('priya@worklens.dev'); m = await login('manager@worklens.dev'); });

  test('status transitions set and clear timestamps', async () => {
    id = (await a.post('/api/tasks').send({ title: 'Loop task', deadline: '2020-01-01T00:00:00Z' })).body.id;
    const s1 = await a.post(`/api/tasks/${id}/status`).send({ status: 'in_progress' });
    assert.ok(s1.body.started_at);
    const s0 = await a.post(`/api/tasks/${id}/status`).send({ status: 'not_started' });
    assert.equal(s0.body.started_at, null);
    await a.post(`/api/tasks/${id}/status`).send({ status: 'in_progress' });
  });
  test('overdue filter and is_overdue flag', async () => {
    const r = await a.get('/api/tasks?overdue=1');
    assert.equal(r.status, 200);
    assert.ok(r.body.length >= 1);
    assert.ok(r.body.every((t) => t.is_overdue && t.status !== 'completed'));
    assert.ok(r.body.some((t) => t.id === id));
  });
  test('server-side search', async () => {
    const r = await a.get('/api/tasks?q=loop%20task');
    assert.deepEqual(r.body.map((t) => t.id), [id]);
  });
  test('blocked task: status locked until resolved; completed task cannot be blocked', async () => {
    const bl = await a.post(`/api/tasks/${id}/blockers`).send({ description: 'Vendor outage', dependency_type: 'external', dependency_name: 'AWS support', is_external: true });
    assert.equal((await a.post(`/api/tasks/${id}/status`).send({ status: 'not_started' })).status, 400);
    assert.equal((await a.post(`/api/tasks/${id}/complete`).send({ actual_outcome: 'x' })).status, 400);
    await a.post(`/api/blockers/${bl.body.id}/resolve`).send({ note: 'AWS fixed it' });
    await a.post(`/api/tasks/${id}/complete`).send({ actual_outcome: 'Done', evidence: [{ type: 'document', url: 'https://docs.example.com/x' }] });
    assert.equal((await a.post(`/api/tasks/${id}/blockers`).send({ description: 'too late', dependency_type: 'team', is_external: false })).status, 400);
  });
  test('resubmit only allowed after a clarification/rejection', async () => {
    const r = await a.post(`/api/tasks/${id}/resubmit`).send({ response: 'Nothing was asked yet though' });
    assert.equal(r.status, 400);
  });
  test('clarification → shows in attention list; new evidence does not silently resubmit', async () => {
    await m.post(`/api/tasks/${id}/reviews`).send({ decision: 'clarification_requested', note: 'Add the before/after numbers' });
    const dash = await a.get('/api/dashboard/employee');
    const item = dash.body.attention.find((x) => x.task.id === id);
    assert.equal(item?.kind, 'clarification');
    assert.equal(item.note, 'Add the before/after numbers');
    await a.post(`/api/tasks/${id}/evidence`).send({ type: 'test_result', note: 'p95 1.8s → 380ms' });
    assert.equal((await a.get(`/api/tasks/${id}`)).body.task.verification_status, 'clarification_requested');
  });
  test('resubmit validates, is owner-only, and returns to review', async () => {
    assert.equal((await a.post(`/api/tasks/${id}/resubmit`).send({ response: 'short' })).status, 400);
    assert.equal((await b.post(`/api/tasks/${id}/resubmit`).send({ response: 'Not my task but trying anyway' })).status, 404);
    assert.equal((await m.post(`/api/tasks/${id}/resubmit`).send({ response: 'Manager cannot resubmit for them' })).status, 403);
    const r = await a.post(`/api/tasks/${id}/resubmit`).send({ response: 'Added the numbers: p95 1.8s → 380ms, see test result.' });
    assert.equal(r.status, 200);
    assert.equal(r.body.verification_status, 'pending');
    const q = await m.get('/api/reviews/queue');
    assert.ok(q.body.some((t) => t.id === id));
    assert.ok(db.get("SELECT 1 AS x FROM integration_events WHERE event_type = 'task.resubmitted'"));
    const detail = (await a.get(`/api/tasks/${id}`)).body;
    assert.ok(detail.comments.some((c) => c.author_id === 2 && c.kind === 'clarification'));
  });
  test('verify after resubmit; full loop on the timeline', async () => {
    await m.post(`/api/tasks/${id}/reviews`).send({ decision: 'verified', quality_rating: 5 });
    const tl = (await a.get(`/api/tasks/${id}`)).body.timeline.map((e) => e.event_type);
    for (const e of ['task_created', 'blocker_opened', 'blocker_resolved', 'task_completed', 'evidence_submitted', 'feedback', 'verified']) assert.ok(tl.includes(e), e);
    const dash = await a.get('/api/dashboard/employee');
    assert.ok(!dash.body.attention.some((x) => x.task.id === id));
  });
  test('evidence on a completed no-evidence task sends it to review', async () => {
    const t = (await a.post('/api/tasks').send({ title: 'No-evidence task' })).body;
    await a.post(`/api/tasks/${t.id}/complete`).send({ actual_outcome: 'Done' });
    assert.ok((await a.get('/api/dashboard/employee')).body.attention.some((x) => x.task.id === t.id && x.kind === 'no_evidence'));
    await a.post(`/api/tasks/${t.id}/evidence`).send({ type: 'explanation', note: 'Explained the change and how I checked it with the requester.' });
    assert.equal((await a.get(`/api/tasks/${t.id}`)).body.task.verification_status, 'pending');
  });
});

describe('phase 4: stored scores and reports', () => {
  const { db, app, login, taskOf } = setup({ recomputeDelayMs: 20 });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  let a, b, m;
  before(async () => { a = await login('aarav@worklens.dev'); b = await login('priya@worklens.dev'); m = await login('manager@worklens.dev'); });

  test('recompute on demand stores 8 weekly records with inputs_json', async () => {
    const r = await a.post('/api/performance/recompute').send({});
    assert.equal(r.status, 200);
    assert.equal(r.body.length, 8);
    const cur = r.body[0];
    assert.ok(cur.inputs_json.dimensions.productivity.inputs);
    const live = (await a.get('/api/performance')).body.current;
    assert.equal(cur.period_start, live.period_start);
    assert.equal(cur.overall, live.overall, 'stored = live');
  });
  test('records are access-controlled', async () => {
    assert.equal((await b.get('/api/performance/records?user_id=2')).status, 404);
    assert.equal((await b.post('/api/performance/recompute').send({ user_id: 2 })).status, 404);
    assert.equal((await m.get('/api/performance/records?user_id=2')).status, 200);
    assert.equal((await m.post('/api/performance/recompute').send({})).status, 400);
  });
  test('relevant changes trigger a debounced recompute', async () => {
    const before = db.get("SELECT computed_at FROM performance_records WHERE user_id = 3 ORDER BY period_start DESC LIMIT 1");
    await wait(5);
    const t = (await b.post('/api/tasks').send({ title: 'Recompute me' })).body;
    await b.post(`/api/tasks/${t.id}/status`).send({ status: 'in_progress' });
    await wait(120);
    const after = db.get("SELECT computed_at FROM performance_records WHERE user_id = 3 ORDER BY period_start DESC LIMIT 1");
    assert.ok(after, 'record written');
    assert.notEqual(after.computed_at, before?.computed_at);
  });
  test('weight changes recompute everyone', async () => {
    await m.patch('/api/settings').send({ score_weights: { productivity: 40, quality: 20, impact: 20, consistency: 10, ownership: 10 } });
    await wait(150);
    const row = db.get("SELECT inputs_json FROM performance_records WHERE user_id = 5 ORDER BY period_start DESC LIMIT 1");
    assert.equal(JSON.parse(row.inputs_json).weights.productivity, 40);
  });
  test('generate + save a daily report; regenerate replaces it', async () => {
    const r1 = await a.post('/api/reports/daily/generate').send({ date: '2026-11-20' });
    assert.equal(r1.status, 201);
    assert.equal(r1.body.summary_source, 'template');
    assert.ok(r1.body.saved_id);
    assert.ok(Array.isArray(r1.body.data.completed));
    const r2 = await a.post('/api/reports/daily/generate').send({ date: '2026-11-20' });
    assert.equal(db.get("SELECT COUNT(*) AS n FROM daily_reports WHERE user_id = 2 AND report_date = '2026-11-20'").n, 1);
    const hist = await a.get('/api/reports/history?kind=daily');
    assert.ok(hist.body.some((x) => x.saved_id === r2.body.saved_id));
    const saved = await a.get(`/api/reports/saved/daily/${r2.body.saved_id}`);
    assert.equal(saved.status, 200);
    assert.equal(saved.body.key, '2026-11-20');
  });
  test('weekly report includes engine scores; team digest is manager-only', async () => {
    const w = await a.post('/api/reports/weekly/generate').send({ week: '2026-11-18' });
    assert.equal(w.body.key, '2026-11-16', 'snapped to Monday');
    assert.equal(w.body.data.scores[0].user_id, 2);
    assert.ok('overall' in w.body.data.scores[0]);
    assert.equal((await a.post('/api/reports/weekly/generate').send({ user_id: 'team' })).status, 400);
    assert.equal((await a.get('/api/reports/daily?user_id=team')).status, 400);
    const t = await m.post('/api/reports/weekly/generate').send({ user_id: 'team', week: '2026-11-16' });
    assert.equal(t.status, 201);
    assert.equal(t.body.user_id, null);
    assert.equal(t.body.data.scores.length, 5);
    assert.equal((await a.get(`/api/reports/saved/weekly/${t.body.saved_id}`)).status, 404);
    assert.equal((await b.get(`/api/reports/saved/weekly/${w.body.saved_id}`)).status, 404, 'other employee cannot read it');
    assert.equal((await m.get(`/api/reports/saved/weekly/${w.body.saved_id}`)).status, 200);
    const mh = await m.get('/api/reports/history?kind=weekly');
    assert.ok(mh.body.some((x) => x.user_id === null) && mh.body.some((x) => x.user_id === 2));
  });
});
