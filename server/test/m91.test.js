// M91 phone alerts: which conditions ring, that each rings once, closes when it clears, and stays honest when
// nothing is connected. viaSocket keys are NOT set, so nothing here reaches viaSocket/M91 or spends credits.
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';
delete process.env.VIASOCKET_ORG_ID; delete process.env.VIASOCKET_PROJECT_ID; delete process.env.VIASOCKET_EMBED_SECRET;
const { openDb } = await import('../src/db/index.js');
const { seedDatabase } = await import('../src/db/seed.js');
const { createApp } = await import('../src/app.js');
const { processOne, scheduleTick } = await import('../src/integrations/outbox.js');
const { syncM91, m91Conditions } = await import('../src/integrations/m91.js');
const { setSetting, getSettings } = await import('../src/services/data.js');

const db = openDb(':memory:');
seedDatabase(db);
const app = createApp(db);
const MANAGER = db.get("SELECT id FROM users WHERE role = 'manager'").id;
const EMP = db.get("SELECT id FROM users WHERE email = 'aarav@worklens.dev'").id;
const past = new Date(Date.now() - 3600000).toISOString();
db.run("INSERT INTO settings (key, value_json) VALUES ('integrations_enabled_at', ?)", [JSON.stringify(past)]);
const login = async (email) => { const a = request.agent(app); await a.post('/api/auth/login').send({ email, password: 'demo1234' }); return a; };

const connect = (settings = { channel_id: 'ch_test', channel_name: 'WorkLens on-call' }) =>
  db.run(`INSERT INTO integration_connections (user_id, app, auth_id, script_id, label, settings_json, connected_at) VALUES (?, 'm91', 'auth_secret_x', 'script_secret_y', 'M91 test', ?, ?)
          ON CONFLICT(user_id, app) DO UPDATE SET settings_json = excluded.settings_json`, [MANAGER, JSON.stringify(settings), past]);
const disconnect = () => db.run("DELETE FROM integration_connections WHERE app = 'm91'");
const queued = (type) => db.all("SELECT * FROM integration_events WHERE event_type = ? AND status = 'queued'", [type]).map((e) => ({ ...e, payload: JSON.parse(e.payload_json) }));
const open = () => db.all("SELECT * FROM m91_alerts WHERE status = 'open'");
const overdueCritical = () => {
  const future = new Date(Date.now() + 7 * 86400000).toISOString();
  db.run("UPDATE tasks SET deadline = ? WHERE priority = 'critical' AND status != 'completed'", [future]); // start from a clean slate
  return db.insert('tasks', { user_id: EMP, title: 'Ship the payments fix', priority: 'critical', status: 'in_progress', deadline: new Date(Date.now() - 3600000).toISOString(), created_at: past, updated_at: past });
};

describe('M91 conditions', () => {
  beforeEach(() => {
    disconnect();
    db.run('DELETE FROM m91_alerts'); db.run('DELETE FROM integration_events');
    db.run("DELETE FROM settings WHERE key = 'features'");
    db.run("UPDATE blockers SET status = 'resolved', resolved_at = ? WHERE status = 'open'", [past]);
  });

  test('a critical task past its deadline rings HIGH with a stable customId and a link back', () => {
    const id = overdueCritical();
    const c = m91Conditions(db, MANAGER).find((x) => x.custom_id === `worklens-overdue-task-${id}`);
    assert.ok(c, 'condition found');
    assert.equal(c.severity, 'HIGH');
    assert.equal(c.kind, 'critical_overdue');
    assert.ok(c.title.length <= 100, 'a phone call reads the first 100 characters');
    assert.match(c.description, new RegExp(`/tasks/${id}`));
  });

  test('a blocker on a critical task rings now; on other tasks only after 48 h; never HIGH for a normal one', () => {
    const t = db.insert('tasks', { user_id: EMP, title: 'Critical migration', priority: 'critical', status: 'blocked', created_at: past, updated_at: past });
    const b1 = db.insert('blockers', { task_id: t, user_id: EMP, description: 'Waiting for DB access', dependency_type: 'team', dependency_name: 'Platform', opened_at: new Date().toISOString() });
    const n = db.insert('tasks', { user_id: EMP, title: 'Normal task', priority: 'medium', status: 'blocked', created_at: past, updated_at: past });
    const b2 = db.insert('blockers', { task_id: n, user_id: EMP, description: 'Waiting', dependency_type: 'person', dependency_name: 'Zoya', opened_at: new Date().toISOString() });
    let all = m91Conditions(db, MANAGER);
    assert.equal(all.find((x) => x.custom_id === `worklens-blocker-${b1}`)?.severity, 'HIGH');
    assert.ok(!all.some((x) => x.custom_id === `worklens-blocker-${b2}`), 'fresh normal blocker does not ring');
    assert.ok(!all.some((x) => x.custom_id === `worklens-overdue-task-${t}`), 'a blocked task is covered by its blocker alert');
    db.run('UPDATE blockers SET opened_at = ? WHERE id = ?', [new Date(Date.now() - 50 * 3600000).toISOString(), b2]);
    all = m91Conditions(db, MANAGER);
    const stuck = all.find((x) => x.custom_id === `worklens-blocker-${b2}`);
    assert.equal(stuck?.severity, 'MEDIUM');
    assert.match(stuck.title, /^Blocked 2d: /);
  });

  test('the last two Slack/Gmail deliveries failing rings once; a success clears it', () => {
    const at = (m) => new Date(Date.now() - m * 60000).toISOString();
    db.insert('integration_events', { event_type: 'report.daily', payload_json: '{}', status: 'failed', attempts: 1, last_error: 'Slack: channel_not_found', processed_at: at(5) });
    assert.ok(!m91Conditions(db, MANAGER).some((c) => c.kind === 'delivery_failing'), 'one failure is not a pattern');
    db.insert('integration_events', { event_type: 'blocker.opened', payload_json: '{}', status: 'failed', attempts: 1, last_error: 'Slack: token_revoked', processed_at: at(2) });
    const c = m91Conditions(db, MANAGER).find((x) => x.kind === 'delivery_failing');
    assert.equal(c?.severity, 'MEDIUM');
    assert.match(c.description, /token_revoked/);
    db.insert('integration_events', { event_type: 'slack.test', payload_json: '{}', status: 'sent', attempts: 1, processed_at: at(0) });
    assert.ok(!m91Conditions(db, MANAGER).some((x) => x.kind === 'delivery_failing'));
  });
});

describe('M91 sync: ring once, close when cleared', () => {
  beforeEach(() => {
    disconnect();
    db.run('DELETE FROM m91_alerts'); db.run('DELETE FROM integration_events');
    db.run("DELETE FROM settings WHERE key = 'features'");
    db.run("UPDATE blockers SET status = 'resolved', resolved_at = ? WHERE status = 'open'", [past]);
  });

  test('nothing is queued while M91 is not connected, or connected without a channel', () => {
    overdueCritical();
    assert.deepEqual(syncM91(db), []);
    connect({});
    assert.deepEqual(syncM91(db), []);
    assert.equal(open().length, 0);
  });

  test('a condition opens one alert, never a second while it holds, and closes when it clears', () => {
    connect();
    const id = overdueCritical();
    syncM91(db);
    const sends = queued('m91.alert').filter((e) => e.payload.custom_id === `worklens-overdue-task-${id}`);
    assert.equal(sends.length, 1);
    assert.equal(sends[0].payload.severity, 'HIGH');
    syncM91(db); scheduleTick(db);
    assert.equal(queued('m91.alert').filter((e) => e.payload.custom_id === `worklens-overdue-task-${id}`).length, 1, 'no repeat while open');
    db.run("UPDATE tasks SET status = 'completed', completed_at = ? WHERE id = ?", [new Date().toISOString(), id]);
    syncM91(db);
    const closes = queued('m91.close');
    assert.equal(closes.length, 1);
    assert.equal(closes[0].payload.custom_id, `worklens-overdue-task-${id}`);
    assert.equal(db.get('SELECT status, close_reason FROM m91_alerts WHERE custom_id = ?', [`worklens-overdue-task-${id}`]).close_reason, 'condition cleared');
  });

  test('turning M91 alerts off closes what is open and opens nothing new', () => {
    connect();
    overdueCritical();
    syncM91(db);
    assert.ok(open().length >= 1);
    setSetting(db, 'features', { ...getSettings(db).features, m91_alerts: false });
    syncM91(db);
    assert.equal(open().length, 0);
    assert.ok(queued('m91.close').every((e) => e.payload.reason === 'M91 alerts turned off in Settings'));
  });

  test('a burst rings at most 3 at a time; the rest follow on the next check', () => {
    connect();
    for (let i = 0; i < 5; i++) db.insert('tasks', { user_id: EMP, title: `Late critical ${i}`, priority: 'critical', status: 'not_started', deadline: past, created_at: past, updated_at: past });
    const first = syncM91(db).filter((x) => x.startsWith('m91:')).length;
    assert.equal(first, 3);
    assert.ok(syncM91(db).filter((x) => x.startsWith('m91:')).length >= 2);
  });

  test('disconnecting forgets open alerts locally', () => {
    connect(); overdueCritical(); syncM91(db);
    disconnect(); syncM91(db);
    assert.equal(open().length, 0);
  });

  test('sending without viaSocket is honest: skipped with the reason, never "sent"', async () => {
    connect(); overdueCritical(); syncM91(db);
    const ev = db.get("SELECT * FROM integration_events WHERE event_type = 'm91.alert' LIMIT 1");
    await processOne(db, ev);
    const after = db.get('SELECT * FROM integration_events WHERE id = ?', [ev.id]);
    assert.equal(after.status, 'skipped_not_connected');
    assert.match(after.result_json, /viaSocket not configured/);
  });
});

describe('connection labels', () => {
  test('M91’s {"API KEY": masked} label reads as text; plain labels and emails are unchanged', async () => {
    const { cleanLabel } = await import('../src/integrations/viasocket.js');
    assert.equal(cleanLabel('{"API KEY":"m91******745"}'), 'Api key m91******745');
    assert.equal(cleanLabel('{"email":"meera@example.com"}'), 'meera@example.com');
    assert.equal(cleanLabel('meera@example.com'), 'meera@example.com');
    assert.equal(cleanLabel(null), null);
  });
});

describe('M91 routes', () => {
  test('employees cannot reach the M91 controls', async () => {
    const a = await login('aarav@worklens.dev');
    for (const [m, p] of [['get', '/api/integrations/m91/channels'], ['put', '/api/integrations/m91/settings'], ['get', '/api/integrations/m91/alerts'], ['post', '/api/integrations/run/m91-test']]) {
      assert.equal((await a[m](p).send({})).status, 403, `${m} ${p}`);
    }
  });

  test('status lists M91 without ever returning auth_id or script_id; test alert queues one event', async () => {
    connect();
    const a = await login('manager@worklens.dev');
    const st = await a.get('/api/integrations/status');
    const m = st.body.find((x) => x.app === 'm91');
    assert.ok(m, 'M91 in status');
    assert.ok(!JSON.stringify(st.body).includes('auth_secret_x') && !JSON.stringify(st.body).includes('script_secret_y'));
    const r = await a.post('/api/integrations/run/m91-test').send({});
    assert.equal(r.status, 202);
    assert.equal(db.get('SELECT event_type FROM integration_events WHERE id = ?', [r.body.queued]).event_type, 'm91.test');
    const al = await a.get('/api/integrations/m91/alerts');
    assert.equal(al.status, 200);
    assert.ok(Array.isArray(al.body.recent) && Array.isArray(al.body.holding_now));
  });

  test('picking a channel is stored with the connection; a bad body is refused', async () => {
    connect({});
    const a = await login('manager@worklens.dev');
    assert.equal((await a.put('/api/integrations/m91/settings').send({ channel_id: '' })).status, 400);
    const ok = await a.put('/api/integrations/m91/settings').send({ channel_id: 'ch_2', channel_name: 'Team on-call' });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.settings.channel_name, 'Team on-call');
    assert.ok(!JSON.stringify(ok.body).includes('script_secret_y'));
  });
});
