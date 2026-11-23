// Phase 5 rules that need no network: the outbox, honesty when nothing is connected, AI fallback, schedules, access.
// viaSocket keys are NOT set in tests, so nothing here can reach viaSocket or spend credits.
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';
delete process.env.VIASOCKET_ORG_ID; delete process.env.VIASOCKET_PROJECT_ID; delete process.env.VIASOCKET_EMBED_SECRET;
const { openDb } = await import('../src/db/index.js');
const { seedDatabase } = await import('../src/db/seed.js');
const { createApp } = await import('../src/app.js');
const { processOne, scheduleTick } = await import('../src/integrations/outbox.js');
const { enqueue } = await import('../src/lib/events.js');

const db = openDb(':memory:');
seedDatabase(db);
const app = createApp(db);
const row = (id) => db.get('SELECT * FROM integration_events WHERE id = ?', [id]);
const run = async (id) => processOne(db, row(id));
const past = new Date(Date.now() - 3600000).toISOString();
const login = async (email) => { const a = request.agent(app); await a.post('/api/auth/login').send({ email, password: 'demo1234' }); return a; };

describe('outbox worker', () => {
  before(() => db.run("INSERT INTO settings (key, value_json) VALUES ('integrations_enabled_at', ?)", [JSON.stringify(past)]));

  test('events queued before integrations were enabled are skipped, never sent', async () => {
    const id = db.insert('integration_events', { event_type: 'task.completed', payload_json: JSON.stringify({ task_id: 1 }), status: 'queued', attempts: 0, created_at: '2020-01-01T00:00:00.000Z' });
    await run(id);
    assert.equal(row(id).status, 'skipped_not_connected');
    assert.match(row(id).result_json, /before viaSocket integrations were enabled/);
  });

  test('not connected → skipped_not_connected with the reason (no fake success)', async () => {
    const t = db.get("SELECT t.id FROM tasks t JOIN task_evidence e ON e.task_id = t.id WHERE t.status = 'completed' LIMIT 1");
    const id = enqueue(db, 'task.completed', { task_id: t.id });
    await run(id);
    assert.equal(row(id).status, 'skipped_not_connected');
    assert.match(row(id).result_json, /not configured|Slack not connected/);
  });

  test('an event is claimed once: running it again does nothing', async () => {
    const id = enqueue(db, 'slack.test', { manager_id: 1 });
    await run(id); const first = row(id);
    db.run("UPDATE integration_events SET status = 'queued' WHERE id = ?", [id]); // even if someone flips it back
    await run(id);
    assert.equal(row(id).attempts, 1, 'never claimed twice');
    assert.equal(first.attempts, 1);
  });

  test('a failure is recorded and NOT retried automatically', async () => {
    const id = enqueue(db, 'blocker.resolved', { blocker_id: 999999 }); // missing blocker → handler throws
    await run(id);
    assert.equal(row(id).status, 'failed');
    assert.ok(row(id).last_error);
    await run(id);
    assert.equal(row(id).attempts, 1);
    assert.equal(row(id).status, 'failed');
  });

  test('unknown event types fail loudly', async () => {
    const id = enqueue(db, 'something.else', {});
    await run(id);
    assert.equal(row(id).status, 'failed');
    assert.match(row(id).last_error, /No workflow/);
  });

  test('daily report with AI unavailable → template summaries, all saved, nothing claimed as sent', async () => {
    const id = enqueue(db, 'report.daily', { manager_id: 1, date: '2026-11-20' });
    await run(id);
    const r = JSON.parse(row(id).result_json);
    assert.equal(row(id).status, 'skipped_not_connected');
    assert.match(r.ai, /template/);
    assert.equal(r.saved, 6);
    const team = db.get("SELECT summary_source, delivered_via FROM daily_reports WHERE user_id IS NULL AND report_date = '2026-11-20'");
    assert.equal(team.summary_source, 'template');
    assert.equal(team.delivered_via, null);
  });
});

describe('schedules (node-cron tick)', () => {
  test('daily report fires once at workday end (18:30 Asia/Kolkata, weekdays)', () => {
    const at1830 = new Date('2026-11-20T13:00:00Z'); // Fri 18:30 IST
    const before = db.get("SELECT COUNT(*) AS n FROM integration_events WHERE event_type = 'report.daily'").n;
    assert.ok(scheduleTick(db, at1830).includes('daily'));
    assert.ok(!scheduleTick(db, at1830).includes('daily'), 'de-duplicated');
    assert.equal(db.get("SELECT COUNT(*) AS n FROM integration_events WHERE event_type = 'report.daily'").n, before + 1);
    assert.ok(!scheduleTick(db, new Date('2026-11-21T13:00:00Z')).includes('daily'), 'not on Saturday');
  });
  test('weekly analysis fires once on Friday from 17:00 team time, never on other days', () => {
    const weekly = () => db.get("SELECT COUNT(*) AS n FROM integration_events WHERE event_type = 'report.weekly' AND payload_json LIKE '%2026-11-16%'").n;
    scheduleTick(db, new Date('2026-11-20T11:30:00Z')); // Fri 17:00 IST
    scheduleTick(db, new Date('2026-11-20T12:30:00Z')); // Fri 18:00 IST (later tick, same week)
    assert.equal(weekly(), 1);
    assert.ok(!scheduleTick(db, new Date('2026-11-19T11:30:00Z')).includes('weekly'), 'not Thursday');
  });
  test('a late tick inside the 2-hour window still runs the daily report; after it, never', () => {
    assert.ok(scheduleTick(db, new Date('2026-11-18T14:40:00Z')).includes('daily'), 'Wed 20:10 IST, 1h40 late'); // within window
    assert.ok(!scheduleTick(db, new Date('2026-11-17T15:30:00Z')).includes('daily'), 'Tue 21:00 IST, too late');
  });
  test('interventions are not marked as alerted while Slack is not connected', () => {
    const fired = scheduleTick(db, new Date('2026-11-20T10:15:00Z'));
    assert.ok(!fired.some((f) => f.startsWith('intervention')));
    assert.equal(db.get("SELECT COUNT(*) AS n FROM notification_log WHERE key LIKE 'intervention:%'").n, 0);
  });
});

describe('integrations API', () => {
  test('employees can see status but not connections, and cannot use manager routes', async () => {
    const a = await login('aarav@worklens.dev');
    const s = await a.get('/api/integrations/status');
    assert.equal(s.status, 200);
    assert.ok(s.body.every((x) => x.connection === undefined));
    for (const p of ['/api/integrations/connect-info', '/api/integrations/events']) assert.equal((await a.get(p)).status, 403, p);
    assert.equal((await a.post('/api/integrations/run/daily').send({})).status, 403);
  });
  test('status never exposes auth_id or script_id', async () => {
    db.run("INSERT INTO integration_connections (user_id, app, auth_id, script_id, label, settings_json, connected_at) VALUES (1, 'slack', 'auth_SECRET_rowbu58rc', 'scriSECRET', 'Test WS', '{}', ?)", [new Date().toISOString()]);
    const m = await login('manager@worklens.dev');
    const s = await m.get('/api/integrations/status');
    assert.equal(s.status, 200);
    assert.ok(!JSON.stringify(s.body).includes('SECRET'));
    db.run("DELETE FROM integration_connections WHERE app = 'slack'");
  });
  test('manual retry only for failed events, as a new event', async () => {
    const m = await login('manager@worklens.dev');
    const failed = db.get("SELECT id FROM integration_events WHERE status = 'failed' LIMIT 1").id;
    const ok = db.get("SELECT id FROM integration_events WHERE status != 'failed' LIMIT 1").id;
    assert.equal((await m.post(`/api/integrations/events/${ok}/retry`)).status, 400);
    const r = await m.post(`/api/integrations/events/${failed}/retry`);
    assert.equal(r.status, 202);
    assert.notEqual(r.body.queued, failed);
    assert.equal(row(r.body.queued).status, 'queued');
    assert.match(row(r.body.queued).payload_json, /retry_of/);
  });
  test('run-now rejects future dates', async () => {
    const m = await login('manager@worklens.dev');
    assert.equal((await m.post('/api/integrations/run/daily').send({ date: '2099-01-01' })).status, 400);
  });
  test('AI suggestions are only applied by the owner, and only the fields chosen', async () => {
    const a = await login('aarav@worklens.dev');
    const b = await login('priya@worklens.dev');
    const t = (await a.post('/api/tasks').send({ title: 'Needs framing', expected_outcome: 'mine' })).body;
    db.update('tasks', t.id, { ai_enriched: 1, ai_suggestions_json: JSON.stringify({ category: 'design', expected_outcome: 'AI outcome', suggested_impact_level: 'high', impact_rationale: 'r', measurable_signal: 's', state: 'pending' }) });
    assert.equal((await b.post(`/api/tasks/${t.id}/ai-suggestions`).send({ action: 'accept', fields: ['category'] })).status, 404);
    const r = await a.post(`/api/tasks/${t.id}/ai-suggestions`).send({ action: 'accept', fields: ['impact_level'] });
    assert.equal(r.status, 200);
    assert.equal(r.body.impact_level, 'high');
    assert.equal(r.body.expected_outcome, 'mine', 'unchosen fields untouched');
    assert.equal(r.body.ai_suggestions_json.state, 'accepted');
  });
});

describe('safety switches', () => {
  test('with viaSocket disabled, a connected Slack is still never called', async () => {
    db.run("INSERT INTO integration_connections (user_id, app, auth_id, script_id, label, settings_json, connected_at) VALUES (1, 'slack', 'a_x', 'scriNEVER', 'WS', '{\"channel_id\":\"C1\"}', '2000-01-01T00:00:00.000Z')");
    const id = enqueue(db, 'slack.test', { manager_id: 1 });
    await run(id);
    assert.equal(row(id).status, 'skipped_not_connected');
    assert.match(row(id).result_json, /disabled|not configured/);
    db.run("DELETE FROM integration_connections WHERE app = 'slack'");
  });
  test('employee preference hides dashboard nudges', async () => {
    const a = await login('aarav@worklens.dev');
    assert.ok((await a.get('/api/dashboard/employee')).body.attention.length > 0);
    await a.put('/api/settings/prefs').send({ in_app: false, slack_dm: false, email_digest: false });
    assert.equal((await a.get('/api/dashboard/employee')).body.attention.length, 0);
    await a.put('/api/settings/prefs').send({ in_app: true, slack_dm: false, email_digest: false });
  });
});

describe('demo reset', () => {
  test('reset works while viaSocket connections exist, and keeps them', async () => {
    db.run("INSERT INTO integration_connections (user_id, app, auth_id, script_id, label, settings_json, connected_at) VALUES (1, 'gmail', 'a_keep', 's_keep', 'me', '{}', ?)", [new Date().toISOString()]);
    const m = await login('manager@worklens.dev');
    assert.equal((await m.post('/api/admin/reset-demo')).status, 204);
    assert.equal(db.get("SELECT COUNT(*) AS n FROM integration_connections WHERE app = 'gmail'").n, 1);
  });
});
