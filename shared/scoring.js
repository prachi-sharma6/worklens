// WorkLens scoring engine — pure functions, no I/O.
// Implements section 3 of the spec. Every score 0–100, null = "Not enough data".
// Used by the client mock API in Phase 1; Phase 4 moves the server onto it and adds unit tests.

const DAY = 86400000;
export const PRIORITY_WEIGHT = { low: 1, medium: 2, high: 3, critical: 4 };
export const IMPACT_POINTS = { low: 1, medium: 3, high: 6 };
export const DIMENSIONS = ['productivity', 'quality', 'impact', 'consistency', 'ownership'];
export const MIN_POINTS = 3;

export const FORMULAS = {
  productivity: '50% × completion rate + 50% × on-time rate. Each task weighted by priority (low 1, medium 2, high 3, critical 4).',
  quality: '60% × verified rate (clarification = ½, rejected = 0) + 25% × evidence rate + 15% × avg quality rating (×20). Missing parts are re-weighted.',
  impact: 'Impact points (low 1, medium 3, high 6) for verified tasks, unverified at 50%, rejected 0 — ÷ your own median weekly points over the previous 4 weeks, ×100, capped at 100.',
  consistency: 'Share of working days (excluding leave) with ≥1 meaningful update: task completed, evidence submitted or status change.',
  ownership: '40% × blockers reported within 1 working day of stalling + 30% × blockers with a named dependency + 30% × tasks updated before their deadline passed.',
};

const t = (v) => (v ? new Date(v).getTime() : null);
const pct = (n, d) => (d > 0 ? (n / d) * 100 : null);
const round = (v) => (v == null ? null : Math.round(v));
const dk = (ms) => { const x = new Date(ms); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };

export function isoWeekStart(d) {
  const x = new Date(d); x.setHours(0, 0, 0, 0);
  const day = (x.getDay() + 6) % 7; // Mon=0
  return new Date(x.getTime() - day * DAY);
}

function workingDays(startMs, endMs) {
  const out = [];
  for (let m = startMs; m < endMs; m += DAY) { const g = new Date(m).getDay(); if (g !== 0 && g !== 6) out.push(dk(m)); }
  return out;
}

/** Combine weighted parts, ignoring null parts and re-normalising the remaining weights. */
function blend(parts) {
  const ok = parts.filter((p) => p.value != null);
  const w = ok.reduce((s, p) => s + p.weight, 0);
  if (!w) return null;
  return ok.reduce((s, p) => s + p.value * p.weight, 0) / w;
}

function externalBlockedMs(blockers, taskId, untilMs) {
  return blockers
    .filter((b) => b.task_id === taskId && b.is_external)
    .reduce((s, b) => s + Math.max(0, (t(b.resolved_at) ?? untilMs) - t(b.opened_at)), 0);
}

function eligibleTasks(data, userId, startMs, endMs, nowMs) {
  const excluded = [];
  const list = data.tasks.filter((x) => {
    if (x.user_id !== userId) return false;
    const dl = t(x.deadline), done = t(x.completed_at);
    const inPeriod = (dl != null && dl >= startMs && dl < endMs) || (done != null && done >= startMs && done < endMs);
    if (!inPeriod) return false;
    if (x.deleted_at && t(x.deleted_at) - t(x.created_at) <= 10 * 60000) { excluded.push({ id: x.id, title: x.title, reason: 'Deleted within 10 minutes of creation' }); return false; }
    if (x.deleted_at) return false;
    return true;
  });
  return { list, excluded };
}

function weeklyImpactPoints(data, userId, startMs, endMs) {
  return data.tasks
    .filter((x) => x.user_id === userId && x.status === 'completed' && !x.deleted_at && t(x.completed_at) >= startMs && t(x.completed_at) < endMs)
    .reduce((s, x) => {
      const pts = IMPACT_POINTS[x.impact_level] ?? 0;
      if (x.verification_status === 'verified') return s + pts;
      if (x.verification_status === 'rejected') return s;
      return s + pts * 0.5;
    }, 0);
}

/**
 * @param data { tasks, evidence, reviews, blockers, timeline, score_overrides, settings }
 * @param userId number
 * @param periodStart Date|string — Monday 00:00 of the ISO week
 * @param opts { now?: Date, days?: number }
 */
export function computeScores(data, userId, periodStart, opts = {}) {
  const nowMs = t(opts.now ?? new Date());
  const startMs = t(periodStart);
  const endMs = startMs + (opts.days ?? 7) * DAY;
  const effEnd = Math.min(endMs, nowMs);
  const { list: tasks, excluded } = eligibleTasks(data, userId, startMs, endMs, nowMs);
  const evByTask = new Map();
  for (const e of data.evidence) evByTask.set(e.task_id, (evByTask.get(e.task_id) ?? 0) + 1);
  const reviewsByTask = new Map();
  for (const r of data.reviews) { const a = reviewsByTask.get(r.task_id) ?? []; a.push(r); reviewsByTask.set(r.task_id, a); }
  const w = (x) => PRIORITY_WEIGHT[x.priority] ?? 1;

  // ---------- Productivity ----------
  const extExcluded = [];
  const prodTasks = tasks.filter((x) => {
    if (x.status !== 'completed' && data.blockers.some((b) => b.task_id === x.id && b.is_external && (b.status === 'open' || t(b.resolved_at) >= startMs))) {
      extExcluded.push({ id: x.id, title: x.title, reason: 'Blocked by an external dependency — not counted against completion' });
      return false;
    }
    return true;
  });
  const completed = prodTasks.filter((x) => x.status === 'completed');
  const withDl = completed.filter((x) => x.deadline);
  const onTime = withDl.filter((x) => t(x.completed_at) <= t(x.deadline) + externalBlockedMs(data.blockers, x.id, nowMs));
  const sumW = (a) => a.reduce((s, x) => s + w(x), 0);
  const completionRate = pct(sumW(completed), sumW(prodTasks));
  const onTimeRate = pct(sumW(onTime), sumW(withDl));
  const productivity = {
    value: prodTasks.length >= MIN_POINTS ? round(blend([{ value: completionRate, weight: 50 }, { value: onTimeRate, weight: 50 }])) : null,
    data_points: prodTasks.length,
    inputs: { eligible: prodTasks.length, completed: completed.length, on_time: onTime.length, with_deadline: withDl.length, completion_rate: round(completionRate), on_time_rate: round(onTimeRate), weighted_completed: sumW(completed), weighted_eligible: sumW(prodTasks) },
    explanation: [`${completed.length} of ${prodTasks.length} eligible tasks completed (priority-weighted ${sumW(completed)}/${sumW(prodTasks)})`, `${onTime.length} of ${withDl.length} completed tasks on or before deadline`],
    excluded: [...excluded, ...extExcluded],
  };

  // ---------- Quality ----------
  const allCompleted = tasks.filter((x) => x.status === 'completed');
  const reviewed = allCompleted.filter((x) => (reviewsByTask.get(x.id) ?? []).length);
  const latest = (x) => { const a = reviewsByTask.get(x.id) ?? []; return a[a.length - 1]; };
  const vScore = reviewed.reduce((s, x) => { const d = latest(x).decision; return s + (d === 'verified' ? 1 : d === 'clarification_requested' ? 0.5 : 0); }, 0);
  const verifiedCount = reviewed.filter((x) => latest(x).decision === 'verified').length;
  const withEvidence = allCompleted.filter((x) => evByTask.get(x.id));
  const ratings = reviewed.map((x) => latest(x).quality_rating).filter((r) => r != null);
  const avgRating = ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null;
  const quality = {
    value: allCompleted.length >= MIN_POINTS ? round(blend([{ value: pct(vScore, reviewed.length), weight: 60 }, { value: pct(withEvidence.length, allCompleted.length), weight: 25 }, { value: avgRating != null ? avgRating * 20 : null, weight: 15 }])) : null,
    data_points: allCompleted.length,
    inputs: { completed: allCompleted.length, reviewed: reviewed.length, verified: verifiedCount, verified_score: vScore, with_evidence: withEvidence.length, ratings: ratings.length, avg_rating: avgRating != null ? +avgRating.toFixed(1) : null },
    explanation: [`${verifiedCount} of ${reviewed.length} reviewed tasks verified (clarifications count ½)`, `${withEvidence.length} of ${allCompleted.length} completed tasks have evidence`, avgRating != null ? `Average manager rating ${avgRating.toFixed(1)}/5 from ${ratings.length} ratings` : 'No quality ratings yet — weight re-distributed'],
    excluded: reviewed.length ? [] : [{ reason: 'No reviewed tasks yet — verified-rate part re-weighted' }],
  };

  // ---------- Impact ----------
  const pts = weeklyImpactPoints(data, userId, startMs, endMs);
  // Baseline = median weekly points over the 4 weeks *before* this period (weeks with no completions are skipped).
  const trailing = [1, 2, 3, 4].map((i) => weeklyImpactPoints(data, userId, startMs - i * 7 * DAY, startMs - i * 7 * DAY + 7 * DAY)).filter((p) => p > 0);
  trailing.sort((a, b) => a - b);
  const median = trailing.length ? (trailing.length % 2 ? trailing[(trailing.length - 1) / 2] : (trailing[trailing.length / 2 - 1] + trailing[trailing.length / 2]) / 2) : 0;
  const verifiedDone = allCompleted.filter((x) => x.verification_status === 'verified');
  const impact = {
    value: allCompleted.length >= MIN_POINTS && median > 0 ? Math.min(100, round((pts / median) * 100)) : null,
    data_points: allCompleted.length,
    inputs: { points: pts, trailing_median: median, baseline_weeks: trailing.length, verified_tasks: verifiedDone.length, completed: allCompleted.length },
    explanation: [`${pts} impact points this period (${verifiedDone.length} verified tasks at full value, others at 50%)`, median > 0 ? `Your median over the previous 4 weeks: ${median} points per week (${trailing.length} week${trailing.length === 1 ? '' : 's'} with completions)` : 'No baseline yet — needs completed work in at least one of the previous 4 weeks'],
    excluded: allCompleted.filter((x) => x.verification_status === 'rejected').map((x) => ({ id: x.id, title: x.title, reason: 'Rejected in review — no impact points' })),
  };

  // ---------- Consistency ----------
  const leave = new Set(data.settings?.leave_days?.[userId] ?? []);
  const firstSeen = Math.min(...data.tasks.filter((x) => x.user_id === userId).map((x) => t(x.created_at)), Infinity);
  const firstDay = firstSeen === Infinity ? null : dk(firstSeen);
  const days = firstDay ? workingDays(startMs, effEnd).filter((d) => !leave.has(d) && d >= firstDay) : [];
  const meaningful = new Set();
  const userTasks = new Set(data.tasks.filter((x) => x.user_id === userId).map((x) => x.id));
  for (const x of data.tasks) if (x.user_id === userId) { if (x.completed_at) meaningful.add(dk(t(x.completed_at))); if (x.started_at) meaningful.add(dk(t(x.started_at))); }
  for (const e of data.evidence) if (userTasks.has(e.task_id)) meaningful.add(dk(t(e.submitted_at)));
  for (const b of data.blockers) if (b.user_id === userId) { meaningful.add(dk(t(b.opened_at))); if (b.resolved_at) meaningful.add(dk(t(b.resolved_at))); }
  const active = days.filter((d) => meaningful.has(d));
  const consistency = {
    value: days.length >= MIN_POINTS ? round(pct(active.length, days.length)) : null,
    data_points: days.length,
    inputs: { working_days: days.length, active_days: active.length, leave_days: leave.size },
    explanation: [`Meaningful updates on ${active.length} of ${days.length} working days so far`, leave.size ? `${leave.size} leave day(s) excluded` : 'No leave days recorded'],
    excluded: [],
  };

  // ---------- Ownership ----------
  const userBlockers = data.blockers.filter((b) => b.user_id === userId && t(b.opened_at) >= startMs && t(b.opened_at) < endMs);
  const fast = userBlockers.filter((b) => { const task = data.tasks.find((x) => x.id === b.task_id); const ref = t(task?.started_at) ?? t(task?.created_at); return t(b.opened_at) - ref <= 1.5 * DAY; });
  const named = userBlockers.filter((b) => b.dependency_type !== 'unclear' && b.dependency_name);
  const due = data.tasks.filter((x) => x.user_id === userId && !x.deleted_at && x.deadline && t(x.deadline) >= startMs && t(x.deadline) < effEnd);
  const updatedBefore = due.filter((x) => {
    const dl = t(x.deadline);
    if (x.completed_at && t(x.completed_at) <= dl) return true;
    if (x.started_at && t(x.started_at) <= dl && x.status !== 'not_started') return true;
    return data.blockers.some((b) => b.task_id === x.id && t(b.opened_at) <= dl);
  });
  const ownership = {
    value: userBlockers.length + due.length >= MIN_POINTS ? round(blend([{ value: pct(fast.length, userBlockers.length), weight: 40 }, { value: pct(named.length, userBlockers.length), weight: 30 }, { value: pct(updatedBefore.length, due.length), weight: 30 }])) : null,
    data_points: userBlockers.length + due.length,
    inputs: { blockers: userBlockers.length, reported_fast: fast.length, named_dependency: named.length, deadlines_passed: due.length, updated_before_deadline: updatedBefore.length },
    explanation: userBlockers.length
      ? [`${fast.length} of ${userBlockers.length} blockers reported within 1 working day`, `${named.length} of ${userBlockers.length} blockers named a dependency`, `${updatedBefore.length} of ${due.length} due tasks updated before the deadline`]
      : ['No blockers this period — blocker parts re-weighted', `${updatedBefore.length} of ${due.length} due tasks updated before the deadline`],
    excluded: [],
  };

  const dims = { productivity, quality, impact, consistency, ownership };

  // overrides
  const periodKey = dk(startMs);
  for (const o of data.score_overrides ?? []) {
    if (o.user_id === userId && o.period_start === periodKey && dims[o.dimension]) {
      dims[o.dimension].override = { original_value: dims[o.dimension].value, new_value: o.new_value, reason: o.reason, manager_id: o.manager_id, created_at: o.created_at };
      dims[o.dimension].value = o.new_value;
    }
  }

  const weights = data.settings?.score_weights ?? { productivity: 25, quality: 25, impact: 25, consistency: 15, ownership: 10 };
  const overall = blend(DIMENSIONS.map((d) => ({ value: dims[d].value, weight: weights[d] })));
  const reasons = [];
  if (tasks.length < 5) reasons.push(`Only ${tasks.length} eligible task${tasks.length === 1 ? '' : 's'} (needs 5)`);
  if (reviewed.length < 2) reasons.push(`Only ${reviewed.length} reviewed task${reviewed.length === 1 ? '' : 's'} (needs 2)`);

  return {
    user_id: userId,
    period_start: periodKey,
    period_end: dk(endMs - DAY),
    dimensions: dims,
    overall: round(overall),
    is_provisional: reasons.length > 0,
    provisional_reasons: reasons,
    weights,
    dropped: DIMENSIONS.filter((d) => dims[d].value == null),
  };
}

/** Rolling multi-week view: list of weekly results, oldest first. */
export function computeTrend(data, userId, weeks = 8, now = new Date()) {
  const thisWeek = isoWeekStart(now);
  const out = [];
  for (let i = weeks - 1; i >= 0; i--) out.push(computeScores(data, userId, new Date(thisWeek.getTime() - i * 7 * DAY), { now }));
  return out;
}

/** Rolling 4-week window score (28 days ending at the end of this week). */
export function computeRolling(data, userId, now = new Date()) {
  const start = new Date(isoWeekStart(now).getTime() - 21 * DAY);
  return computeScores(data, userId, start, { now, days: 28 });
}
