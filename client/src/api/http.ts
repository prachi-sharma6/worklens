// Real API client: same `Api` interface the mock implemented. Session = httpOnly cookie (sent automatically).
import type { Api } from './index';
import type { CompletePayload, NewEvidence } from './types';

export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, credentials: 'same-origin', headers: {} };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) { init.body = JSON.stringify(body); (init.headers as Record<string, string>)['Content-Type'] = 'application/json'; }
  let res: Response;
  try { res = await fetch(`/api${url}`, init); }
  catch { throw new ApiError(0, 'Can’t reach the WorkLens server — is `npm run dev` running?'); }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `Request failed (${res.status})`);
  return data as T;
}
const get = <T,>(u: string) => req<T>('GET', u);
const qs = (o: Record<string, unknown>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};
const evJson = (e: NewEvidence) => ({ type: e.type, url: e.url || null, note: e.note || null });

export const httpApi: Api = {
  auth: {
    login: (email, password) => req('POST', '/auth/login', { email, password }),
    logout: () => req('POST', '/auth/logout'),
    me: async () => (await get<{ user: import('./types').User | null }>('/auth/session')).user,
  },
  users: { team: () => get('/users/team'), get: (id) => get(`/users/${id}`) },
  tasks: {
    list: (f = {}) => get(`/tasks${qs({ ...f, overdue: f.overdue ? 1 : undefined } as Record<string, unknown>)}`),
    get: (id) => get(`/tasks/${id}`),
    create: (t) => req('POST', '/tasks', t),
    update: (id, patch) => req('PATCH', `/tasks/${id}`, patch),
    setStatus: (id, status) => req('POST', `/tasks/${id}/status`, { status }),
    complete: (id, p: CompletePayload) => {
      const payload = { actual_outcome: p.actual_outcome, actual_minutes: p.actual_minutes ?? null, evidence: p.evidence.map(evJson) };
      if (!p.evidence.some((e) => e.file)) return req('POST', `/tasks/${id}/complete`, payload);
      const fd = new FormData();
      fd.set('payload', JSON.stringify(payload));
      p.evidence.forEach((e, i) => e.file && fd.set(`file_${i}`, e.file));
      return req('POST', `/tasks/${id}/complete`, fd);
    },
    remove: (id) => req('DELETE', `/tasks/${id}`),
    resubmit: (id, response) => req('POST', `/tasks/${id}/resubmit`, { response }),
    aiSuggestions: (id, action, fields = []) => req('POST', `/tasks/${id}/ai-suggestions`, { action, fields }),
  },
  evidence: {
    list: (userId) => get(`/evidence${qs({ user_id: userId })}`),
    add: (taskId, e) => {
      if (!e.file) return req('POST', `/tasks/${taskId}/evidence`, evJson(e));
      const fd = new FormData(); fd.set('payload', JSON.stringify(evJson(e))); fd.set('file', e.file);
      return req('POST', `/tasks/${taskId}/evidence`, fd);
    },
    remove: (id) => req('DELETE', `/evidence/${id}`),
  },
  comments: { add: (taskId, body) => req('POST', `/tasks/${taskId}/comments`, { body }) },
  blockers: {
    list: (f = {}) => get(`/blockers${qs(f)}`),
    open: (taskId, p) => req('POST', `/tasks/${taskId}/blockers`, p),
    resolve: (id, note) => req('POST', `/blockers/${id}/resolve`, { note }),
  },
  reviews: { queue: () => get('/reviews/queue'), submit: (taskId, p) => req('POST', `/tasks/${taskId}/reviews`, p) },
  timeline: { list: (userId) => get(`/timeline${qs({ user_id: userId })}`) },
  performance: {
    get: (userId) => get(`/performance${qs({ user_id: userId })}`),
    override: (user_id, period_start, dimension, new_value, reason) => req('POST', '/performance/overrides', { user_id, period_start, dimension, new_value, reason }),
    clearOverride: (user_id, period_start, dimension) => req('DELETE', `/performance/overrides${qs({ user_id, period_start, dimension })}`),
    records: (userId) => get(`/performance/records${qs({ user_id: userId })}`),
    recompute: (userId) => req('POST', '/performance/recompute', userId ? { user_id: userId } : {}),
  },
  dashboard: { employee: () => get('/dashboard/employee'), manager: () => get('/dashboard/manager') },
  team: { performance: () => get('/team/performance') },
  reports: {
    daily: (date, userId) => get(`/reports/daily${qs({ date, user_id: userId === null ? 'team' : userId })}`),
    weekly: (week, userId) => get(`/reports/weekly${qs({ week, user_id: userId === null ? 'team' : userId })}`),
    generate: (kind, key, userId) => req('POST', `/reports/${kind}/generate`, { [kind === 'daily' ? 'date' : 'week']: key, ...(userId === undefined ? {} : { user_id: userId === null ? 'team' : userId }) }),
    history: (kind, userId) => get(`/reports/history${qs({ kind, user_id: userId === null ? 'team' : userId })}`),
    saved: (kind, savedId) => get(`/reports/saved/${kind}/${savedId}`),
  },
  insights: { get: (userId) => get(`/insights${qs({ user_id: userId })}`) },
  search: { query: (q) => get(`/search${qs({ q })}`) },
  settings: {
    get: () => get('/settings'),
    update: (p) => req('PATCH', '/settings', p),
    prefs: () => get('/settings/prefs'),
    updatePrefs: (p) => req('PUT', '/settings/prefs', p),
    updateProfile: (p) => req('PATCH', '/me/profile', p),
  },
  integrations: {
    status: () => get('/integrations/status'),
    events: () => get('/integrations/events'),
    connectInfo: () => get('/integrations/connect-info'),
    connected: (app, authId) => req('POST', `/integrations/${app}/connected`, { authId }),
    slackOptions: (field, search, paginate) => get(`/integrations/slack/options${qs({ field, search, paginate })}`),
    saveSlackChannel: (channel_id, channel_name) => req('PUT', '/integrations/slack/settings', { channel_id, channel_name }),
    mapSlackUser: (user_id, slack_user_id, label) => req('PUT', '/integrations/slack/user-map', { user_id, slack_user_id, label }),
    saveGmailRecipients: (recipients) => req('PUT', '/integrations/gmail/settings', { recipients }),
    disconnect: (app) => req('POST', `/integrations/${app}/disconnect`),
    run: (what, date) => req('POST', `/integrations/run/${what}`, date ? { date } : {}),
    retry: (id) => req('POST', `/integrations/events/${id}/retry`),
  },
  admin: { resetDemo: () => req('POST', '/admin/reset-demo') },
};
