// Settings → Integrations. Manager-only (except the read-only status, which everyone may see).
// The browser receives only: the per-user embed token + service ids (for the Connect popup), labels, and choices.
// auth_id and script_id never leave the server.
import { Router } from 'express';
import { z } from 'zod';
import { h, parse, badRequest, notFound } from '../lib/http.js';
import { requireManager } from '../auth.js';
import { enqueue } from '../lib/events.js';
import { eventRow } from '../services/data.js';
import { visibleUsers } from '../access.js';
import * as vs from '../integrations/viasocket.js';
import { getConnection } from '../integrations/workflows.js';
import { dk } from '../services/views.js';
import { isoWeekStart } from '../scoring/index.js';

const APP = z.enum(['slack', 'gmail']);

/** What the UI may see about a connection. */
function publicConn(c, live) {
  if (!c) return null;
  return { app: c.app, label: c.label, connected_at: c.connected_at, flow_ready: !!c.script_id, expired: !!live?.expired, settings: c.settings };
}

export function integrationRoutes(db) {
  const r = Router();

  r.get('/integrations/status', h(async (req, res) => {
    const managerId = req.user.role === 'manager' ? req.user.id : req.user.manager_id;
    let live = []; let liveError = null;
    if (vs.isConfigured() && managerId && (getConnection(db, managerId, 'slack') || getConnection(db, managerId, 'gmail'))) {
      try { live = await vs.listConnections(managerId); } catch (e) { liveError = e.message; }
    }
    const item = (app, label) => {
      const c = getConnection(db, managerId, app);
      const l = c && live.find((x) => x.authId === c.auth_id);
      const stillThere = !c || liveError || !!l; // a connection revoked on viaSocket's side shows as expired
      return {
        app, label, connected: !!c?.script_id && stillThere && !l?.expired, expired: !!c && (!!l?.expired || !stillThere),
        detail: !c ? 'Not connected' : l?.expired || !stillThere ? 'Connection expired — reconnect' : c.settings?.channel_name || c.settings?.recipients?.length ? 'Connected and configured' : 'Connected — finish setup below',
        connection: req.user.role === 'manager' ? publicConn(c, l) : undefined,
      };
    };
    res.json([
      { app: 'ai', label: 'viaSocket AI', connected: vs.isConfigured(), expired: false, detail: vs.isConfigured() ? `Ready — ${vs.AI_MODEL.model}, no account needed` : 'viaSocket keys missing in .env' },
      item('slack', 'Slack'), item('gmail', 'Gmail'),
    ]);
  }));

  r.use('/integrations', requireManager);

  r.get('/integrations/connect-info', h(async (req, res) => {
    if (!vs.isConfigured()) throw badRequest('viaSocket keys are missing in .env');
    const info = await vs.connectInfo(req.user.id);
    const reconnect = {};
    for (const app of ['slack', 'gmail']) { const c = getConnection(db, req.user.id, app); if (c) reconnect[app] = c.auth_id; }
    // auth_id is the one id the Connect popup takes for an in-place reconnect of this user's own connection.
    res.json({ ...info, reconnect });
  }));

  /** Called after the Connect popup resolves. Verifies the auth_id is this user's, then builds the user's flow. */
  r.post('/integrations/:app/connected', h(async (req, res) => {
    const app = parse(APP, req.params.app);
    const { authId } = parse(z.object({ authId: z.string().min(3).max(200) }), req.body);
    const mine = (await vs.listConnections(req.user.id)).find((c) => c.authId === authId);
    if (!mine) throw badRequest('That connection does not belong to your account');
    const existing = getConnection(db, req.user.id, app);
    const { scriptId } = await vs.buildFlow(req.user.id, app, authId, existing?.script_id ?? null);
    const now = new Date().toISOString();
    // Default report recipient: the connected Gmail account's own address (the manager's), changeable in Settings.
    const ownEmail = typeof mine.label === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mine.label) ? mine.label : req.user.email;
    const settings = existing?.settings ?? (app === 'gmail' ? { recipients: [ownEmail] } : {});
    db.run(`INSERT INTO integration_connections (user_id, app, auth_id, script_id, label, settings_json, connected_at) VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id, app) DO UPDATE SET auth_id = excluded.auth_id, script_id = excluded.script_id, label = excluded.label, updated_at = excluded.connected_at,
            connected_at = CASE WHEN integration_connections.auth_id = excluded.auth_id THEN integration_connections.connected_at ELSE excluded.connected_at END`,
      [req.user.id, app, authId, scriptId, mine.label ?? null, JSON.stringify(settings), now]);
    res.json(publicConn(getConnection(db, req.user.id, app)));
  }));

  r.get('/integrations/slack/options', h(async (req, res) => {
    const q = parse(z.object({ field: z.enum(['channel', 'user']), search: z.string().max(100).optional(), paginate: z.string().max(500).optional() }), req.query);
    const c = getConnection(db, req.user.id, 'slack');
    if (!c) throw badRequest('Connect Slack first');
    const fieldKey = q.field === 'channel' ? 'destination.channel_id' : 'destination.userId';
    const existingFields = { destination: { messageto: q.field === 'channel' ? 'channel' : 'user' } };
    const out = await vs.listOptions(req.user.id, 'slack', fieldKey, c.auth_id, { search: q.search || undefined, paginate: q.paginate ? JSON.parse(q.paginate) : undefined, existingFields });
    res.json({ options: out.options, hasMore: out.hasMore, paginate: out.paginate == null ? null : JSON.stringify(out.paginate), message: out.message ?? null });
  }));

  r.put('/integrations/slack/settings', h((req, res) => {
    const p = parse(z.object({ channel_id: z.string().min(1).max(100), channel_name: z.string().max(200) }), req.body);
    const c = getConnection(db, req.user.id, 'slack');
    if (!c) throw badRequest('Connect Slack first');
    db.update('integration_connections', c.id, { settings_json: JSON.stringify({ ...c.settings, ...p }) });
    res.json(publicConn(getConnection(db, req.user.id, 'slack')));
  }));

  r.put('/integrations/slack/user-map', h((req, res) => {
    const p = parse(z.object({ user_id: z.number().int(), slack_user_id: z.string().max(100).nullable(), label: z.string().max(200).nullable() }), req.body);
    if (!visibleUsers(db, req.user).some((u) => u.id === p.user_id)) throw notFound('User not found');
    const c = getConnection(db, req.user.id, 'slack');
    if (!c) throw badRequest('Connect Slack first');
    const map = { ...(c.settings.user_map ?? {}) };
    if (p.slack_user_id) map[p.user_id] = { id: p.slack_user_id, label: p.label }; else delete map[p.user_id];
    db.update('integration_connections', c.id, { settings_json: JSON.stringify({ ...c.settings, user_map: map }) });
    res.json(publicConn(getConnection(db, req.user.id, 'slack')));
  }));

  r.put('/integrations/gmail/settings', h((req, res) => {
    const p = parse(z.object({ recipients: z.array(z.string().trim().email('Enter valid email addresses')).min(1, 'Add at least one recipient').max(10) }), req.body);
    const c = getConnection(db, req.user.id, 'gmail');
    if (!c) throw badRequest('Connect Gmail first');
    db.update('integration_connections', c.id, { settings_json: JSON.stringify({ ...c.settings, recipients: p.recipients }) });
    res.json(publicConn(getConnection(db, req.user.id, 'gmail')));
  }));

  r.post('/integrations/:app/disconnect', h(async (req, res) => {
    const app = parse(APP, req.params.app);
    const c = getConnection(db, req.user.id, app);
    if (!c) throw notFound('Not connected');
    const u = vs.vsUser(req.user.id);
    // Pause the flow before revoking, as the skill's manage page says; then revoke and forget.
    if (c.script_id) await u.setFlowStatus(c.script_id, 2).catch(() => {});
    await u.revokeConnection(c.auth_id).catch(() => {});
    db.run('DELETE FROM integration_connections WHERE id = ?', [c.id]);
    res.status(204).end();
  }));

  /** Queue a test message / a report run now. Each is one write; the worker runs it once. */
  r.post('/integrations/run/:what', h((req, res) => {
    const what = parse(z.enum(['slack-test', 'gmail-test', 'daily', 'weekly']), req.params.what);
    // Optional period: a past day / any day of a past week (default: today / this week).
    const { date } = parse(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use YYYY-MM-DD').optional() }), req.body ?? {});
    const day = date ? new Date(date + 'T00:00:00') : new Date();
    if (day.getTime() > Date.now()) throw badRequest('Pick today or a past date');
    let id;
    if (what === 'slack-test') id = enqueue(db, 'slack.test', { manager_id: req.user.id });
    else if (what === 'gmail-test') id = enqueue(db, 'gmail.test', { manager_id: req.user.id });
    else if (what === 'daily') id = enqueue(db, 'report.daily', { manager_id: req.user.id, date: dk(day) });
    else id = enqueue(db, 'report.weekly', { manager_id: req.user.id, week: dk(isoWeekStart(day)) });
    res.status(202).json({ queued: id });
  }));

  r.get('/integrations/events', h((_req, res) => res.json(db.all('SELECT * FROM integration_events ORDER BY id DESC LIMIT 20').map((e) => ({ ...eventRow(e), result_json: e.result_json ? JSON.parse(e.result_json) : null })))));

  /** Manual retry of a failed event (never automatic). */
  r.post('/integrations/events/:id/retry', h((req, res) => {
    const id = parse(z.coerce.number().int().positive(), req.params.id);
    const e = db.get('SELECT * FROM integration_events WHERE id = ?', [id]);
    if (!e) throw notFound();
    if (e.status !== 'failed') throw badRequest('Only failed events can be retried');
    // A retry is a new event (fresh claim), so the audit trail keeps the failed attempt.
    const newId = enqueue(db, e.event_type, { ...JSON.parse(e.payload_json), retry_of: e.id });
    res.status(202).json({ queued: newId });
  }));

  return r;
}
