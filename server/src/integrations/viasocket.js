// The ONLY module that imports viasocket-apps. Every viaSocket call in WorkLens goes through here.
// Skill: viasocket-integrations (skill.md?format=sdk, 2026-11-24.3). Place: the product, for its users.
// Secrets (VIASOCKET_EMBED_SECRET, every auth_id and script_id) never leave the server.
import { ViaSocket, ViaSocketError } from 'viasocket-apps';

export { ViaSocketError };

/** Pinned action keys + versions, copied from https://viasocket.com/docs/slack/send-message.md and /gmail/send-email.md. */
export const APPS = {
  slack: { slug: 'slack', action: 'Send_Message', version: 'v110', actionId: 'row1jrbor', fn: 'sendMessage' },
  gmail: { slug: 'gmail', action: 'Send_Email', version: 'v56', actionId: 'rowogelpy0h6', fn: 'sendEmail' },
};
/**
 * M91 (slug `m91`, service rowzi2rxrvo0), copied from https://viasocket.com/docs/m91.md and its action pages.
 * Its flow calls three actions: the channel list (needs the connection) gives each channel's send link, which the
 * send/close actions take — so the send link stays inside viaSocket and never reaches WorkLens.
 */
export const M91 = {
  slug: 'm91',
  listChannels: { key: 'List_Channels', version: 'v3', actionId: 'rowr62kckt5z', fn: 'listChannels' },
  send: { key: 'Send_Channel_Alert', version: 'v6', actionId: 'rowo1ijawy9p', fn: 'sendChannelAlert' },
  close: { key: 'Close_Channel_Alert', version: 'v8', actionId: 'row2vear3nno', fn: 'closeChannelAlert' },
};
/** Cheapest model row of https://viasocket.com/docs/ai.md for short structured jobs. */
export const AI_MODEL = { service: 'openai', model: 'gpt-6-luna' };

let client = null;
export function isConfigured() {
  if (process.env.VIASOCKET_DISABLED === '1') return false; // isolated test servers: never reach viaSocket
  return !!(process.env.VIASOCKET_ORG_ID && process.env.VIASOCKET_PROJECT_ID && process.env.VIASOCKET_EMBED_SECRET);
}
export function viasocket() {
  if (!isConfigured()) throw new Error('viaSocket keys are not set in .env');
  client ??= new ViaSocket({ orgId: process.env.VIASOCKET_ORG_ID, projectId: process.env.VIASOCKET_PROJECT_ID, secret: process.env.VIASOCKET_EMBED_SECRET });
  return client;
}

/** WorkLens user id → viaSocket unique_identifier (stable, never the email). */
export const vsUser = (userId) => viasocket().user(`wl-${userId}`);

// ---------------------------------------------------------------- connections

/** Embed token + service ids for the Connect popup. The only viaSocket values the browser ever receives. */
export async function connectInfo(userId) {
  const u = vsUser(userId);
  const [token, slack, gmail, m91] = await Promise.all([u.token(), u.serviceIdFor('slack'), u.serviceIdFor('gmail'), u.serviceIdFor(M91.slug)]);
  return {
    token, serviceIds: { slack, gmail, m91 },
    actions: { slack: [APPS.slack.actionId], gmail: [APPS.gmail.actionId], m91: [M91.listChannels.actionId, M91.send.actionId, M91.close.actionId] },
  };
}

/** The user's live connections, normalised: { authId, serviceId, label, expired }. */
export async function listConnections(userId) {
  const rows = await vsUser(userId).listConnections();
  // The live API answers the auth_id as `id` (the skill's manage page calls it `identifier`; reported to viaSocket).
  return rows.map((c) => ({
    authId: c.id ?? c.identifier,
    serviceId: c.service_id ?? null,
    service: c.service_name ?? null,
    label: parseLabel(c.connection_label),
    expired: !!c.isExpired,
  }));
}
/**
 * A readable account label. Apps label connections differently: Slack/Gmail give an email or name; M91 gives
 * {"API KEY":"m91******745"} (already masked by viaSocket) → "API key m91******745".
 */
function parseLabel(l) {
  if (!l) return null;
  const pick = (o) => {
    const named = o.email ?? o.Email ?? o.name ?? o.Name ?? o.team ?? o.Team;
    if (typeof named === 'string') return named;
    const [k, v] = Object.entries(o).find(([, x]) => typeof x === 'string' && x) ?? [];
    return k ? `${k.charAt(0).toUpperCase()}${k.slice(1).toLowerCase()} ${v}` : null;
  };
  if (typeof l !== 'string') return pick(l);
  try { const o = JSON.parse(l); return (o && typeof o === 'object' ? pick(o) : null) ?? l; } catch { return l; }
}
/** Labels stored before parseLabel understood every shape (e.g. raw JSON) are cleaned on the way out. */
export const cleanLabel = (l) => (typeof l === 'string' && l.trim().startsWith('{') ? parseLabel(l) : l ?? null);

/** Options for a PICK field, read from the user's own account. */
export async function listOptions(userId, app, fieldKey, authId, { search, paginate, existingFields } = {}) {
  const a = APPS[app];
  return vsUser(userId).listOptions(a.slug, a.action, { fieldKey, authId, version: a.version, search, paginate, existingFields });
}

// ---------------------------------------------------------------- the per-manager flow (one per app)
// The action is known in advance (the product's code picks it), so per the skill's "The order" it runs as a flow:
// a webhook trigger + one step that calls the action. WorkLens POSTs the per-run values to the flow's URL.

const SLACK_STEP = `
const b = context?.req?.body || {}
let destination
if (b.kind === 'thread') destination = { messageto: 'thread', thread_channel_id: b.thread_channel_id, thread_ts: b.thread_ts }
else if (b.kind === 'user') destination = { messageto: 'user', userId: [b.slack_user_id] }
else destination = { messageto: 'channel', channel_id: [b.channel_id] }
return await sendMessage({ inputData: { destination, markdown_content: b.text, bot_details: { bot_name: 'WorkLens' } } })`;

const GMAIL_STEP = `
const b = context?.req?.body || {}
return await sendEmail({ inputData: { to: b.to, subject: b.subject, messageBody: b.html, fromName: 'WorkLens Reports' } })`;

// M91: { op: 'channels' } → the account's channels (id + name only; send links are dropped here);
// { op: 'send', channel_id, alert } → Send Channel Alert; { op: 'close', channel_id, custom_id } → Close Channel Alert.
// The channel's send link is looked up inside the run each time, so it never leaves viaSocket.
const M91_STEP = `
const b = context?.req?.body || {}
const list = await listChannels({ inputData: {} })
const rows = Array.isArray(list?.data) ? list.data : Array.isArray(list) ? list : []
if (b.op === 'channels') return { channels: rows.map((c) => ({ id: c._id, name: c.name })) }
const ch = rows.find((c) => c._id === b.channel_id)
if (!ch || !ch.sendLink) throw new Error('The chosen M91 channel is not in this M91 account any more. Pick a channel again in WorkLens Settings.')
if (b.op === 'close') {
  try {
    return await closeChannelAlert({ inputData: { send_link: ch.sendLink, identifier_type: 'customId', custom_id: b.custom_id } })
  } catch (e) {
    const m = String(e?.message || '') + JSON.stringify(e?.response?.data || e?.data || {})
    if (/already_resolved|NOT_FOUND|not found/i.test(m)) return { success: true, already_closed: true }
    throw e
  }
}
const a = b.alert || {}
const input = { send_link: ch.sendLink, title: a.title, severity: a.severity, allowResponseOptions: true,
  responseOptions: { labels: a.labels, effects: a.effects }, isAutoClose: a.isAutoClose === true }
if (a.description) input.description = a.description
if (a.customId) input.customId = a.customId
const sent = await sendChannelAlert({ inputData: input })
const d = sent?.data || sent || {}
return { success: sent?.success !== false, channel: ch.name, alert: { id: d._id, status: d.status, customId: d.customId, severity: d.severity,
  delivered: d.delivered, unregistered: Array.isArray(d.unregistered) ? d.unregistered.length : 0, deduplicated: !!d.deduplicated, reopened: !!d.reopened } }`;

const FLOWS = {
  slack: (authId) => ({ title: 'WorkLens → Slack', description: 'Blocker, review and report alerts from WorkLens', step: { stepname: 'send_slack', code: SLACK_STEP, serviceActionFunctions: [{ name: APPS.slack.fn, authId, actionId: APPS.slack.actionId }] } }),
  gmail: (authId) => ({ title: 'WorkLens → Gmail', description: 'Daily and weekly WorkLens reports by email', step: { stepname: 'send_email', code: GMAIL_STEP, serviceActionFunctions: [{ name: APPS.gmail.fn, authId, actionId: APPS.gmail.actionId }] } }),
  m91: (authId) => ({
    title: 'WorkLens → M91', description: 'Phone alerts from WorkLens when work is stuck or deliveries fail',
    step: { stepname: 'm91_alert', code: M91_STEP, serviceActionFunctions: [M91.listChannels, M91.send, M91.close].map((x) => ({ name: x.fn, authId, actionId: x.actionId })) },
  }),
};

/** Creates (or rebuilds) the user's "WorkLens → <app>" flow for this connection. Returns { scriptId }. */
export async function buildFlow(userId, app, authId, existingScriptId = null) {
  const f = FLOWS[app](authId);
  const u = vsUser(userId);
  // createFlow has no idempotency key (automations.md: "list first, create once"): adopt this user's existing
  // "WorkLens → <app>" flow if there is one (e.g. after a disconnect), resuming it if paused.
  let scriptId = existingScriptId;
  if (!scriptId) {
    const mine = (await u.listFlows()).filter((x) => x.title === f.title && x.status !== 'deleted');
    const pickFlow = mine.find((x) => x.status === 'active') ?? mine[0];
    if (pickFlow) {
      scriptId = pickFlow.id;
      if (pickFlow.status === 'paused') await u.setFlowStatus(scriptId, 1);
    }
  }
  scriptId ??= (await u.createFlow({ title: f.title, description: f.description })).scriptId;
  await u.setTrigger(scriptId, { triggerType: 'webhook' });
  await u.saveSteps(scriptId, [f.step]);
  return { scriptId };
}

/**
 * POST the per-run values to the user's flow. A write: called once, never retried here.
 * The caller gets the last step's return (the app's response, e.g. Slack's { ok, ts, channel }).
 */
export async function runFlow(scriptId, body) {
  if (!isConfigured()) throw new Error('viaSocket is disabled or not configured on this server');
  const res = await fetch(`https://flow.sokt.io/func/${scriptId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = { message: text.slice(0, 300) }; }
  if (!res.ok) throw Object.assign(new Error(data?.message || `flow run failed (${res.status})`), { status: res.status, body: data });
  // A failed step does not fail the HTTP call: its result is { error } — surface it.
  if (data && typeof data === 'object' && data.error) throw Object.assign(new Error(typeof data.error === 'string' ? data.error : JSON.stringify(data.error).slice(0, 300)), { status: 400, body: data });
  if (data?.ok === false) throw Object.assign(new Error(`Slack: ${data.error ?? 'not ok'}`), { status: 400, body: data });
  if (data?.success === false) throw Object.assign(new Error(`M91: ${data.error?.code ?? data.error?.message ?? data.message ?? 'not accepted'}`), { status: 400, body: data });
  return data;
}

export async function flowStatus(userId, scriptId) {
  const f = await vsUser(userId).readFlow(scriptId);
  return { status: f.status, steps: f.steps.map((s) => s.stepname), trigger: f.trigger?.triggerType };
}
export async function runHistory(userId, scriptId) {
  return vsUser(userId).runHistory(scriptId, { limit: 5 });
}

// ---------------------------------------------------------------- AI

/** One JSON-schema AI call (viaSocket runs the model). Returns { content, messageId, threadId }. Throws on any failure. */
export async function aiComplete(userId, { threadId, prompt, message, schema }) {
  const reply = await vsUser(userId).ai.send({
    threadId, prompt, message, ...AI_MODEL,
    responseType: 'json_schema', jsonSchema: { name: schema.name, schema: schema.schema, strict: true },
  });
  const content = typeof reply.content === 'string' ? JSON.parse(reply.content) : reply.content;
  return { content, messageId: reply.messageId, threadId: reply.threadId, finishReason: reply.finishReason };
}
