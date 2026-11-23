// The ONLY module that imports viasocket-apps. Every viaSocket call in WorkLens goes through here.
// Skill: viasocket-integrations (skill.md?format=sdk, 2026-11-20.6). Place: the product, for its users.
// Secrets (VIASOCKET_EMBED_SECRET, every auth_id and script_id) never leave the server.
import { ViaSocket, ViaSocketError } from 'viasocket-apps';

export { ViaSocketError };

/** Pinned action keys + versions, copied from https://viasocket.com/docs/slack/send-message.md and /gmail/send-email.md. */
export const APPS = {
  slack: { slug: 'slack', action: 'Send_Message', version: 'v110', actionId: 'row1jrbor', fn: 'sendMessage' },
  gmail: { slug: 'gmail', action: 'Send_Email', version: 'v56', actionId: 'rowogelpy0h6', fn: 'sendEmail' },
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
  const [token, slack, gmail] = await Promise.all([u.token(), u.serviceIdFor('slack'), u.serviceIdFor('gmail')]);
  return { token, serviceIds: { slack, gmail }, actions: { slack: [APPS.slack.actionId], gmail: [APPS.gmail.actionId] } };
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
function parseLabel(l) {
  if (!l) return null;
  const pick = (o) => o.email ?? o.Email ?? o.name ?? o.Name ?? o.team ?? o.Team ?? null;
  if (typeof l !== 'string') return pick(l);
  try { const o = JSON.parse(l); return (o && typeof o === 'object' ? pick(o) : null) ?? l; } catch { return l; }
}

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

/** Creates (or rebuilds) the user's "WorkLens → <app>" flow for this connection. Returns { scriptId }. */
export async function buildFlow(userId, app, authId, existingScriptId = null) {
  const a = APPS[app];
  const u = vsUser(userId);
  const scriptId = existingScriptId ?? (await u.createFlow({ title: app === 'slack' ? 'WorkLens → Slack' : 'WorkLens → Gmail', description: app === 'slack' ? 'Blocker, review and report alerts from WorkLens' : 'Daily and weekly WorkLens reports by email' })).scriptId;
  await u.setTrigger(scriptId, { triggerType: 'webhook' });
  await u.saveSteps(scriptId, [{
    stepname: app === 'slack' ? 'send_slack' : 'send_email',
    code: app === 'slack' ? SLACK_STEP : GMAIL_STEP,
    serviceActionFunctions: [{ name: a.fn, authId, actionId: a.actionId }],
  }]);
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
