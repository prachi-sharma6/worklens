// Security pass: every API route is behind auth (except the public four), manager routes refuse employees,
// uploads are type- and size-limited, headers are set, nothing sensitive leaks.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';
delete process.env.VIASOCKET_ORG_ID; delete process.env.VIASOCKET_PROJECT_ID; delete process.env.VIASOCKET_EMBED_SECRET;
const { openDb } = await import('../src/db/index.js');
const { seedDatabase } = await import('../src/db/seed.js');
const { createApp } = await import('../src/app.js');

const db = openDb(':memory:');
seedDatabase(db);
const app = createApp(db);
const login = async (email) => { const a = request.agent(app); await a.post('/api/auth/login').send({ email, password: 'demo1234' }); return a; };

/** Every [method, path] registered on the app's routers, with :params filled by a real id. */
function routes() {
  const out = [];
  const walk = (stack) => {
    for (const layer of stack) {
      if (layer.route) for (const m of Object.keys(layer.route.methods)) out.push([m, '/api' + layer.route.path]);
      else if (layer.handle?.stack) walk(layer.handle.stack);
    }
  };
  walk(app._router.stack);
  return [...new Map(out.map((r) => [r.join(' '), r])).values()].map(([m, p]) => [m, p.replace(/:app/g, 'slack').replace(/:kind/g, 'daily').replace(/:what/g, 'daily').replace(/:[a-z_]+/g, '1')]);
}
const PUBLIC = new Set(['get /api/health', 'post /api/auth/login', 'post /api/auth/logout', 'get /api/auth/session']);
const MANAGER_ONLY = [
  ['get', '/api/dashboard/manager'], ['get', '/api/team/performance'], ['get', '/api/reviews/queue'], ['patch', '/api/settings'],
  ['post', '/api/admin/reset-demo'], ['post', '/api/performance/overrides'], ['delete', '/api/performance/overrides'],
  ['get', '/api/integrations/connect-info'], ['post', '/api/integrations/slack/connected'], ['get', '/api/integrations/slack/options'],
  ['put', '/api/integrations/slack/settings'], ['put', '/api/integrations/slack/user-map'], ['put', '/api/integrations/gmail/settings'],
  ['post', '/api/integrations/slack/disconnect'], ['post', '/api/integrations/run/daily'], ['get', '/api/integrations/events'], ['post', '/api/integrations/events/1/retry'],
];

describe('security', () => {
  test('the route table is non-trivial', () => assert.ok(routes().length > 50, `found ${routes().length}`));

  test('every non-public API route answers 401 without a session', async () => {
    const leaks = [];
    for (const [m, p] of routes()) {
      if (PUBLIC.has(`${m} ${p}`)) continue;
      const r = await request(app)[m](p).send({});
      if (r.status !== 401) leaks.push(`${m.toUpperCase()} ${p} → ${r.status}`);
    }
    assert.deepEqual(leaks, []);
  });

  test('every manager-only route answers 403 to an employee', async () => {
    const a = await login('aarav@worklens.dev');
    const wrong = [];
    for (const [m, p] of MANAGER_ONLY) { const r = await a[m](p).send({}); if (r.status !== 403) wrong.push(`${m.toUpperCase()} ${p} → ${r.status}`); }
    assert.deepEqual(wrong, []);
  });

  test('uploads over 5 MB are refused', async () => {
    const a = await login('aarav@worklens.dev');
    const t = db.get("SELECT id FROM tasks WHERE user_id = 2 AND status = 'in_progress' LIMIT 1");
    const big = Buffer.alloc(5 * 1024 * 1024 + 10, 0x89);
    const r = await a.post(`/api/tasks/${t.id}/evidence`).field('payload', JSON.stringify({ type: 'screenshot' })).attach('file', big, { filename: 'big.png', contentType: 'image/png' });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /5 MB/);
  });

  test('security headers and no stack traces', async () => {
    const r = await request(app).get('/api/health');
    assert.equal(r.headers['x-content-type-options'], 'nosniff');
    assert.equal(r.headers['x-frame-options'], 'DENY');
    assert.equal(r.headers['x-powered-by'], undefined);
    const bad = await request(app).post('/api/auth/login').set('content-type', 'application/json').send('{not json');
    assert.equal(bad.status, 400);
    assert.ok(!JSON.stringify(bad.body).includes('at '), 'no stack trace');
  });

  test('user payloads never include password hashes', async () => {
    const m = await login('manager@worklens.dev');
    for (const p of ['/api/auth/me', '/api/users/team', '/api/users/2', '/api/dashboard/manager', '/api/team/performance']) {
      assert.ok(!JSON.stringify((await m.get(p)).body).includes('password'), p);
    }
  });
});
