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
import { m91Conditions } from '../integrations/m91.js';
import { dk } from '../services/views.js';
import { isoWeekStart } from '../scoring/index.js';

const APP = z.enum(['slack', 'gmail', 'm91']);

/** In-flight connection saves, per `userId:app` (see POST /integrations/:app/connected). */
const saving = new Map();

/** What the UI may see about a connection. */
function publicConn(c, live) {
  if (!c) return null;
  return { app: c.app, label: vs.cleanLabel(c.label), connected_at: c.connected_at, flow_ready: !!c.script_id, expired: !!live?.expired, settings: c.settings };
}

export function integrationRoutes(db) {
  const r = Router();

  r.get('/integrations/status', h(async (req, res) => {
    const managerId = req.user.role === 'manager' ? req.user.id : req.user.manager_id;
    let live = []; let liveError = null;
    if (vs.isConfigured() && managerId && ['slack', 'gmail', 'm91'].some((a) => getConnection(db, managerId, a))) {
      try { live = await vs.listConnections(managerId); } catch (e) { liveError = e.message; }
    }
    const item = (app, label) => {
      const c = getConnection(db, managerId, app);
      const l = c && live.find((x) => x.authId === c.auth_id);
      const stillThere = !c || liveError || !!l; // a connection revoked on viaSocket's side shows as expired
      return {
        app, label, connected: !!c?.script_id && stillThere && !l?.expired, expired: !!c && (!!l?.expired || !stillThere),
        detail: !c ? 'Not connected' : l?.expired || !stillThere ? 'Connection expired — reconnect' : c.settings?.channel_name || c.settings?.recipients?.length ? (app === 'm91' ? `Rings the “${c.settings.channel_name}” channel` : 'Connected and configured') : 'Connected — finish setup below',
        connection: req.user.role === 'manager' ? publicConn(c, l) : undefined,
      };
    };
    res.json([
      { app: 'ai', label: 'viaSocket AI', connected: vs.isConfigured(), expired: false, detail: vs.isConfigured() ? `Ready — ${vs.AI_MODEL.model}, no account needed` : 'viaSocket keys missing in .env' },
      item('slack', 'Slack'), item('gmail', 'Gmail'), item('m91', 'M91 phone alerts'),
    ]);
  }));

  r.use('/integrations', requireManager);

  r.get('/integrations/connect-info', h(async (req, res) => {
    if (!vs.isConfigured()) throw badRequest('viaSocket keys are missing in .env');
    const info = await vs.connectInfo(req.user.id);
    const reconnect = {};
    for (const app of ['slack', 'gmail', 'm91']) { const c = getConnection(db, req.user.id, app); if (c) reconnect[app] = c.auth_id; }
    // auth_id is the one id the Connect popup takes for an in-place reconnect of this user's own connection.
    res.json({ ...info, reconnect });
  }));

  /**
   * Called after the Connect popup resolves. Verifies the auth_id is this user's, then builds the user's flow.
   * One save per user and app at a time: building a flow takes seconds, and a repeated click or a late popup success
   * must reuse the flow the first save made, never create another.
   */
  r.post('/integrations/:app/connected', h(async (req, res) => {
    const app = parse(APP, req.params.app);
    const { authId } = parse(z.object({ authId: z.string().min(3).max(200) }), req.body);
    const key = `${req.user.id}:${app}`;
    const prev = saving.get(key) ?? Promise.resolve();
    const run = prev.catch(() => {}).then(() => saveConnection(req.user, app, authId));
    saving.set(key, run);
    try { res.json(await run); } finally { if (saving.get(key) === run) saving.delete(key); }
  }));

  async function saveConnection(user, app, authId) {
    const mine = (await vs.listConnections(user.id)).find((c) => c.authId === authId);
    if (!mine) throw badRequest('That connection does not belong to your account');
    const existing = getConnection(db, user.id, app);
    const { scriptId } = await vs.buildFlow(user.id, app, authId, existing?.script_id ?? null);
    const now = new Date().toISOString();
    // Default report recipient: the connected Gmail account's own address (the manager's), changeable in Settings.
    const ownEmail = typeof mine.label === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mine.label) ? mine.label : user.email;
    const settings = existing?.settings ?? (app === 'gmail' ? { recipients: [ownEmail] } : {});
    db.run(`INSERT INTO integration_connections (user_id, app, auth_id, script_id, label, settings_json, connected_at) VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id, app) DO UPDATE SET auth_id = excluded.auth_id, script_id = excluded.script_id, label = excluded.label, updated_at = excluded.connected_at,
            connected_at = CASE WHEN integration_connections.auth_id = excluded.auth_id THEN integration_connections.connected_at ELSE excluded.connected_at END`,
      [user.id, app, authId, scriptId, mine.label ?? null, JSON.stringify(settings), now]);
    return publicConn(getConnection(db, user.id, app));
  }

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

  // ---- M91: pick the channel to ring (once, right after Connect), see what rang.
  r.get('/integrations/m91/channels', h(async (req, res) => {
    const c = getConnection(db, req.user.id, 'm91');
    if (!c?.script_id) throw badRequest('Connect M91 first');
    const out = await vs.runFlow(c.script_id, { op: 'channels' }); // the flow returns id + name only, never send links
    res.json({ channels: (out?.channels ?? []).map((x) => ({ id: String(x.id), name: String(x.name ?? 'Unnamed channel') })) });
  }));

  r.put('/integrations/m91/settings', h((req, res) => {
    const p = parse(z.object({ channel_id: z.string().min(1).max(100), channel_name: z.string().min(1).max(200) }), req.body);
    const c = getConnection(db, req.user.id, 'm91');
    if (!c) throw badRequest('Connect M91 first');
    db.update('integration_connections', c.id, { settings_json: JSON.stringify({ ...c.settings, ...p }) });
    res.json(publicConn(getConnection(db, req.user.id, 'm91')));
  }));

  /** What rang (or would ring) for this manager: open + recent alerts, and the conditions holding right now. */
  r.get('/integrations/m91/alerts', h((req, res) => {
    const rows = db.all('SELECT kind, title, severity, path, status, opened_at, closed_at, close_reason FROM m91_alerts WHERE manager_id = ? ORDER BY id DESC LIMIT 15', [req.user.id]);
    const now = m91Conditions(db, req.user.id).map(({ kind, title, severity, path }) => ({ kind, title, severity, path }));
    res.json({ recent: rows, holding_now: now });
  }));

  r.post('/integrations/:app/disconnect', h(async (req, res) => {
    const app = parse(APP, req.params.app);
    const c = getConnection(db, req.user.id, app);
    if (!c) throw notFound('Not connected');
    const u = vs.vsUser(req.user.id);
    if (app === 'm91' && c.script_id && c.settings?.channel_id) {
      // Close what is still ringing while the flow can still reach M91 (best effort: an open alert absorbs later sends).
      for (const a of db.all("SELECT custom_id FROM m91_alerts WHERE manager_id = ? AND status = 'open' AND kind != 'test'", [req.user.id])) {
        await vs.runFlow(c.script_id, { op: 'close', channel_id: c.settings.channel_id, custom_id: a.custom_id }).catch(() => {});
      }
    }
    // Pause the flow before revoking, as the skill's manage page says; then revoke and forget.
    if (c.script_id) await u.setFlowStatus(c.script_id, 2).catch(() => {});
    await u.revokeConnection(c.auth_id).catch(() => {});
    db.run('DELETE FROM integration_connections WHERE id = ?', [c.id]);
    if (app === 'm91') db.run("UPDATE m91_alerts SET status = 'closed', closed_at = ?, close_reason = 'M91 disconnected in WorkLens' WHERE manager_id = ? AND status = 'open'", [new Date().toISOString(), req.user.id]);
    res.status(204).end();
  }));

  /** Queue a test message / a report run now. Each is one write; the worker runs it once. */
  r.post('/integrations/run/:what', h((req, res) => {
    const what = parse(z.enum(['slack-test', 'gmail-test', 'm91-test', 'daily', 'weekly']), req.params.what);
    // Optional period: a past day / any day of a past week (default: today / this week).
    const { date } = parse(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use YYYY-MM-DD').optional() }), req.body ?? {});
    const day = date ? new Date(date + 'T00:00:00') : new Date();
    if (day.getTime() > Date.now()) throw badRequest('Pick today or a past date');
    let id;
    if (what === 'slack-test') id = enqueue(db, 'slack.test', { manager_id: req.user.id });
    else if (what === 'gmail-test') id = enqueue(db, 'gmail.test', { manager_id: req.user.id });
    else if (what === 'm91-test') id = enqueue(db, 'm91.test', { manager_id: req.user.id });
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
