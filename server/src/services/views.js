// Read-side views (dashboards, performance, reports, insights) computed over a team-scoped snapshot.
// Scores come only from shared/scoring.js.
import { computeScores, computeTrend, computeRolling, isoWeekStart, FORMULAS } from '../../../shared/scoring.js';

const DAY = 86400000;
const PW = { low: 1, medium: 2, high: 3, critical: 4 };
const IMPACT = { low: 1, medium: 3, high: 6 };
export const dk = (d) => { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
const ms = (v) => new Date(v).getTime();
const live = (s) => s.tasks.filter((t) => !t.deleted_at);
const nameOf = (s, id) => s.users.find((u) => u.id === id)?.name ?? 'Unknown';
const fmtDay = (d, o) => new Date(d).toLocaleDateString('en-US', o);

export function meta(s, t) {
  const open = s.blockers.find((b) => b.task_id === t.id && b.status === 'open') ?? null;
  return {
    ...t,
    evidence_count: s.evidence.filter((e) => e.task_id === t.id).length,
    open_blocker: open,
    is_overdue: t.status !== 'completed' && !!t.deadline && ms(t.deadline) < Date.now(),
    user_name: nameOf(s, t.user_id),
  };
}

export function filterTasks(s, userId, f) {
  let out = live(s).filter((t) => t.user_id === userId);
  if (f.q) { const q = f.q.toLowerCase(); out = out.filter((t) => t.title.toLowerCase().includes(q) || (t.description ?? '').toLowerCase().includes(q)); }
  if (f.status) out = out.filter((t) => t.status === f.status);
  if (f.priority) out = out.filter((t) => t.priority === f.priority);
  if (f.category) out = out.filter((t) => t.category === f.category);
  if (f.overdue) out = out.filter((t) => t.status !== 'completed' && t.deadline && ms(t.deadline) < Date.now());
  if (f.sort === 'priority') out.sort((a, b) => PW[b.priority] - PW[a.priority]);
  else if (f.sort === 'created') out.sort((a, b) => b.created_at.localeCompare(a.created_at));
  else out.sort((a, b) => (a.deadline ?? '9').localeCompare(b.deadline ?? '9'));
  return out.map((t) => meta(s, t));
}

export const score = (s, userId, start = isoWeekStart(new Date())) => computeScores(s, userId, start, { now: new Date() });

export function performanceView(s, userId) {
  const now = new Date(); const ws = isoWeekStart(now);
  return {
    current: computeScores(s, userId, ws, { now }),
    previous: computeScores(s, userId, new Date(ws.getTime() - 7 * DAY), { now }),
    rolling: computeRolling(s, userId, now),
    trend: computeTrend(s, userId, 6, now),
    formulas: FORMULAS,
  };
}

export function employeeDashboard(s, userId) {
  const today = dk(new Date());
  const mine = live(s).filter((t) => t.user_id === userId);
  const planned = mine.filter((t) => t.planned_for_date === today || (t.completed_at && dk(t.completed_at) === today));
  const ws = isoWeekStart(new Date());
  const week = Array.from({ length: 7 }, (_, i) => {
    const day = new Date(ws.getTime() + i * DAY); const key = dk(day);
    return { date: key, label: fmtDay(day, { weekday: 'short' }), planned: mine.filter((t) => t.deadline && dk(t.deadline) === key).length, completed: mine.filter((t) => t.completed_at && dk(t.completed_at) === key).length };
  }).filter((x, i) => i < 5 || x.planned || x.completed);
  const plannedDone = planned.filter((t) => t.status === 'completed').length;
  return {
    planned_today: planned.map((t) => meta(s, t)).sort((a, b) => Number(a.status === 'completed') - Number(b.status === 'completed')),
    completed_today: mine.filter((t) => t.completed_at && dk(t.completed_at) === today).length,
    pending: mine.filter((t) => t.status === 'in_progress' || t.status === 'not_started').length,
    blocked: mine.filter((t) => t.status === 'blocked').length,
    planned_count: planned.length,
    completion_pct: planned.length ? Math.round((plannedDone / planned.length) * 100) : null,
    week,
    upcoming: mine.filter((t) => t.status !== 'completed' && t.deadline).sort((a, b) => a.deadline.localeCompare(b.deadline)).slice(0, 6).map((t) => meta(s, t)),
    achievements: s.timeline.filter((e) => e.user_id === userId && (e.event_type === 'achievement' || e.event_type === 'verified')).sort((a, b) => b.occurred_at.localeCompare(a.occurred_at)).slice(0, 5),
    attention: attentionList(s, mine),
  };
}

/** In-app nudges: things only the employee can unblock. Most urgent first. */
function attentionList(s, mine) {
  const out = [];
  const lastNote = (t) => [...s.reviews].reverse().find((r) => r.task_id === t.id)?.note ?? null;
  for (const t of mine) {
    if (t.status === 'completed' && t.verification_status === 'rejected') out.push({ kind: 'rejected', rank: 0, task: meta(s, t), note: lastNote(t) });
    else if (t.status === 'completed' && t.verification_status === 'clarification_requested') out.push({ kind: 'clarification', rank: 1, task: meta(s, t), note: lastNote(t) });
    else if (t.status !== 'completed' && t.deadline && ms(t.deadline) < Date.now() && t.status !== 'blocked') out.push({ kind: 'overdue', rank: 2, task: meta(s, t), note: null });
    else if (t.status === 'completed' && t.verification_status === 'unsubmitted') out.push({ kind: 'no_evidence', rank: 3, task: meta(s, t), note: null });
  }
  return out.sort((a, b) => a.rank - b.rank || (b.task.updated_at ?? '').localeCompare(a.task.updated_at ?? '')).slice(0, 8).map(({ rank, ...x }) => x);
}

export function managerDashboard(s, team) {
  const ids = new Set(team.map((u) => u.id)); const today = dk(new Date());
  const tt = live(s).filter((t) => ids.has(t.user_id));
  const ws = isoWeekStart(new Date());
  const onTimePct = (done) => { const d = done.filter((t) => t.deadline); return d.length ? Math.round((d.filter((t) => t.completed_at <= t.deadline).length / d.length) * 100) : null; };
  const trend = Array.from({ length: 4 }, (_, i) => {
    const st = ws.getTime() - (3 - i) * 7 * DAY, en = st + 7 * DAY;
    const done = tt.filter((t) => t.completed_at && ms(t.completed_at) >= st && ms(t.completed_at) < en);
    const due = tt.filter((t) => t.deadline && ms(t.deadline) >= st && ms(t.deadline) < en);
    return { label: fmtDay(st, { month: 'short', day: 'numeric' }), completed: done.length, planned: due.length, on_time: onTimePct(done) };
  });
  const dueWeek = tt.filter((t) => t.deadline && ms(t.deadline) >= ws.getTime() && ms(t.deadline) < Date.now());
  const members = team.map((u) => {
    const ut = tt.filter((t) => t.user_id === u.id);
    const doneW = ut.filter((t) => t.completed_at && ms(t.completed_at) >= ws.getTime());
    const reviewed = doneW.filter((t) => ['verified', 'clarification_requested', 'rejected'].includes(t.verification_status));
    const last = s.timeline.filter((e) => e.user_id === u.id).reduce((m, e) => (!m || e.occurred_at > m ? e.occurred_at : m), null);
    const { category, ...user } = u;
    return {
      user,
      current_task: ut.filter((t) => t.status === 'in_progress').sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0] ?? null,
      completed_week: doneW.length,
      on_time_pct: onTimePct(doneW),
      verified_pct: reviewed.length ? Math.round((reviewed.filter((t) => t.verification_status === 'verified').length / reviewed.length) * 100) : null,
      scores: score(s, u.id),
      open_blockers: s.blockers.filter((b) => b.user_id === u.id && b.status === 'open').length,
      last_activity: last,
    };
  }).sort((a, b) => a.user.name.localeCompare(b.user.name));
  return {
    team_size: team.length,
    completed_today: tt.filter((t) => t.completed_at && dk(t.completed_at) === today).length,
    in_progress: tt.filter((t) => t.status === 'in_progress').length,
    blocked: tt.filter((t) => t.status === 'blocked').length,
    pending_reviews: tt.filter((t) => t.status === 'completed' && t.verification_status === 'pending').length,
    delivery_pct: dueWeek.length ? Math.round((dueWeek.filter((t) => t.status === 'completed').length / dueWeek.length) * 100) : null,
    trend,
    achievements: s.timeline.filter((e) => ids.has(e.user_id) && (e.event_type === 'achievement' || e.event_type === 'verified')).sort((a, b) => b.occurred_at.localeCompare(a.occurred_at)).slice(0, 6).map((e) => ({ ...e, user_name: nameOf(s, e.user_id) })),
    review_queue: reviewQueue(s, team),
    open_blockers: s.blockers.filter((b) => ids.has(b.user_id) && b.status === 'open').map((b) => ({ ...b, task_title: s.tasks.find((t) => t.id === b.task_id)?.title, user_name: nameOf(s, b.user_id) })),
    members,
  };
}

export function reviewQueue(s, team) {
  const ids = new Set(team.map((u) => u.id));
  return live(s).filter((t) => ids.has(t.user_id) && t.status === 'completed' && t.verification_status === 'pending')
    .map((t) => meta(s, t)).sort((a, b) => (a.completed_at ?? '').localeCompare(b.completed_at ?? ''));
}

export function teamPerformance(s, team) {
  const now = new Date(); const ws = isoWeekStart(now);
  const ids = new Set(team.map((u) => u.id));
  const strip = ({ category, ...u }) => u;
  const members = team.map((u) => ({ user: strip(u), trend: computeTrend(s, u.id, 4, now) }));
  const planned_vs_completed = team.map((u) => {
    const ut = live(s).filter((t) => t.user_id === u.id);
    return { name: u.name.split(' ')[0], planned: ut.filter((t) => t.deadline && ms(t.deadline) >= ws.getTime() && ms(t.deadline) < ws.getTime() + 7 * DAY).length, completed: ut.filter((t) => t.completed_at && ms(t.completed_at) >= ws.getTime()).length };
  });
  const byType = {};
  for (const b of s.blockers.filter((x) => ids.has(x.user_id))) { byType[b.dependency_type] ??= { open: 0, resolved: 0 }; byType[b.dependency_type][b.status]++; }
  return { members, planned_vs_completed, blockers_by_type: Object.entries(byType).map(([type, v]) => ({ type, ...v })) };
}

/** Deterministic daily/weekly report + template summary (Phase 4 persists these; Phase 5 adds the AI summary). */
export function buildReport(s, kind, key, users, label, start, end) {
  const ids = new Set(users.map((u) => u.id));
  const mine = live(s).filter((t) => ids.has(t.user_id));
  const inRange = (v) => !!v && ms(v) >= start && ms(v) < end;
  const m = (t) => meta(s, t);
  const completed = mine.filter((t) => inRange(t.completed_at)).map(m);
  const planned = mine.filter((t) => (kind === 'daily' && t.planned_for_date === key) || inRange(t.deadline) || inRange(t.created_at)).map(m);
  const pending = mine.filter((t) => t.status !== 'completed' && ms(t.created_at) < end && t.status !== 'blocked').map(m);
  const blocked = mine.filter((t) => t.status === 'blocked' || s.blockers.some((b) => b.task_id === t.id && inRange(b.opened_at))).map(m);
  const evidence = s.evidence.filter((e) => inRange(e.submitted_at) && mine.some((t) => t.id === e.task_id)).map((e) => ({ ...e, task_title: mine.find((t) => t.id === e.task_id)?.title }));
  const impact_points = completed.reduce((acc, t) => acc + (t.verification_status === 'verified' ? IMPACT[t.impact_level] : t.verification_status === 'rejected' ? 0 : IMPACT[t.impact_level] / 2), 0);
  const needs = [];
  const overdue = pending.filter((t) => t.is_overdue);
  if (overdue.length) needs.push(`${overdue.length} overdue task${overdue.length > 1 ? 's' : ''}: ${overdue.slice(0, 3).map((t) => t.title).join('; ')}`);
  const noEv = completed.filter((t) => !t.evidence_count);
  if (noEv.length) needs.push(`${noEv.length} completed task${noEv.length > 1 ? 's' : ''} without evidence`);
  const openB = blocked.filter((t) => t.open_blocker);
  if (openB.length) needs.push(`${openB.length} task${openB.length > 1 ? 's' : ''} currently blocked`);
  const next = pending.filter((t) => !t.is_overdue).sort((a, b) => (a.deadline ?? '9').localeCompare(b.deadline ?? '9')).slice(0, 5);
  const single = users.length === 1 ? users[0] : null;
  const data = { user_id: single?.id ?? null, user_name: single?.name ?? null, period_label: label, planned, completed, pending, blocked, impact_points, evidence, needs_attention: needs, next_priorities: next };
  const who = data.user_name ?? 'The team';
  const summary = [
    `${who} completed ${completed.length} task${completed.length === 1 ? '' : 's'} ${kind === 'daily' ? 'on' : 'during'} ${label}${planned.length ? ` against ${planned.length} planned or due` : ''}.`,
    completed.length ? `${completed.filter((t) => t.evidence_count).length} of them have evidence attached and ${completed.filter((t) => t.verification_status === 'verified').length} are verified, for ${impact_points} impact points.` : 'No tasks were completed in this period.',
    blocked.length ? `${blocked.length} task${blocked.length === 1 ? ' was' : 's were'} blocked${openB.length ? `, ${openB.length} still open` : ''}.` : 'No blockers were reported.',
    `${pending.length} task${pending.length === 1 ? ' remains' : 's remain'} open${overdue.length ? `, ${overdue.length} overdue` : ''}.`,
  ].join(' ');
  return { id: `${kind}-${key}-${data.user_id ?? 'team'}`, kind, key, user_id: data.user_id, data, summary_text: summary, summary_source: 'template', generated_at: new Date().toISOString() };
}

export function dailyReport(s, date, users) {
  const start = new Date(date + 'T00:00:00').getTime();
  return buildReport(s, 'daily', date, users, fmtDay(start, { weekday: 'long', month: 'long', day: 'numeric' }), start, start + DAY);
}
export function weeklyReport(s, weekStart, users) {
  const start = isoWeekStart(new Date(weekStart + 'T00:00:00')).getTime();
  const rep = buildReport(s, 'weekly', dk(start), users, `the week of ${fmtDay(start, { month: 'long', day: 'numeric' })}`, start, start + 7 * DAY);
  // Scores come only from the scoring engine; included so reports (and the Phase 5 AI summary) can cite them.
  rep.data.scores = users.map((u) => {
    const sc = computeScores(s, u.id, new Date(start), { now: new Date() });
    return { user_id: u.id, user_name: u.name, overall: sc.overall, is_provisional: sc.is_provisional, dimensions: Object.fromEntries(Object.entries(sc.dimensions).map(([k, v]) => [k, v.value])) };
  });
  return rep;
}

export function insights(s, userIds) {
  const set = new Set(userIds);
  const bl = s.blockers.filter((b) => set.has(b.user_id));
  const groups = new Map();
  for (const b of bl) {
    const key = b.dependency_name ?? 'Unclear dependency';
    const g = groups.get(key) ?? { dependency: key, type: b.dependency_type, count: 0, open: 0, avg_hours: null, task_ids: [] };
    g.count++; if (b.status === 'open') g.open++; g.task_ids.push(b.task_id);
    groups.set(key, g);
  }
  for (const g of groups.values()) {
    const res = bl.filter((b) => (b.dependency_name ?? 'Unclear dependency') === g.dependency && b.resolved_at);
    g.avg_hours = res.length ? Math.round(res.reduce((a, b) => a + (ms(b.resolved_at) - ms(b.opened_at)) / 3600000, 0) / res.length) : null;
  }
  const ws = isoWeekStart(new Date());
  const tt = live(s).filter((t) => set.has(t.user_id));
  const planned_vs_actual = Array.from({ length: 4 }, (_, i) => {
    const st = ws.getTime() - (3 - i) * 7 * DAY, en = st + 7 * DAY;
    return { label: fmtDay(st, { month: 'short', day: 'numeric' }), planned: tt.filter((t) => t.deadline && ms(t.deadline) >= st && ms(t.deadline) < en).length, completed: tt.filter((t) => t.completed_at && ms(t.completed_at) >= st && ms(t.completed_at) < en).length };
  });
  const estimation = tt.filter((t) => t.actual_minutes && t.estimated_minutes).sort((a, b) => (a.completed_at ?? '').localeCompare(b.completed_at ?? '')).slice(-12)
    .map((t) => ({ task_id: t.id, title: t.title, estimated: t.estimated_minutes, actual: t.actual_minutes }));
  return { ai_connected: false, recurring_blockers: [...groups.values()].sort((a, b) => b.count - a.count), planned_vs_actual, estimation, source_task_ids: tt.map((t) => t.id) };
}
