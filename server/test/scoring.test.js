// Unit tests for the scoring engine (spec §3) — every fairness rule has a test.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { computeScores, isoWeekStart } from '../src/scoring/index.js';

const WEEK = new Date('2026-11-02T00:00:00'); // Monday (local)
const NOW = new Date('2026-11-09T09:00:00');  // after the week, so the whole week counts
const PREV = (n) => new Date(WEEK.getTime() - n * 7 * 86400000);
const at = (day, hour = 12, base = WEEK) => new Date(base.getTime() + day * 86400000 + hour * 3600000).toISOString();
const DEFAULT_WEIGHTS = { productivity: 25, quality: 25, impact: 25, consistency: 15, ownership: 10 };

let nextId = 1;
/** Build a task: day offsets are relative to `base` (default: WEEK). */
function task(o = {}) {
  const base = o.base ?? WEEK;
  const created = at(o.createdDay ?? 0, 9, base);
  const t = {
    id: nextId++, user_id: 1, title: o.title ?? `T${nextId}`, priority: o.priority ?? 'medium', impact_level: o.impact ?? 'medium',
    status: o.status ?? 'completed', deadline: o.deadlineDay === null ? null : at(o.deadlineDay ?? 2, 18, base),
    created_at: created, started_at: o.status === 'not_started' ? null : at(o.createdDay ?? 0, 10, base),
    completed_at: (o.status ?? 'completed') === 'completed' ? at(o.doneDay ?? 1, 15, base) : null,
    verification_status: o.verification ?? 'unsubmitted', actual_minutes: o.minutes ?? null, estimated_minutes: 60,
    deleted_at: o.deleted_at ?? null,
  };
  return t;
}
function data({ tasks = [], evidence = [], reviews = [], blockers = [], overrides = [], weights = DEFAULT_WEIGHTS, leave = {} } = {}) {
  return { tasks, evidence, reviews, blockers, timeline: [], score_overrides: overrides, settings: { score_weights: weights, leave_days: leave } };
}
const ev = (t) => ({ id: nextId++, task_id: t.id, type: 'document', submitted_at: t.completed_at });
const rv = (t, decision = 'verified', quality_rating = null) => ({ id: nextId++, task_id: t.id, decision, quality_rating, created_at: t.completed_at });
const score = (d, start = WEEK) => computeScores(d, 1, start, { now: NOW });

/** A healthy week: n completed+verified tasks with evidence, one per day. */
function healthyWeek(n = 5, extra = {}) {
  const tasks = Array.from({ length: n }, (_, i) => task({ createdDay: i % 5, doneDay: i % 5, deadlineDay: (i % 5) + 1, verification: 'verified', ...extra }));
  return { tasks, evidence: tasks.map(ev), reviews: tasks.map((t) => rv(t)) };
}

describe('scoring engine', () => {
  test('iso week starts on Monday', () => {
    assert.equal(isoWeekStart(new Date('2026-11-08T23:00:00')).getDay(), 1);
    assert.equal(isoWeekStart(new Date('2026-11-08T23:00:00')).getDate(), 2);
  });

  test('all scores are 0–100 integers or null', () => {
    const r = score(data(healthyWeek(6)));
    for (const v of [r.overall, ...Object.values(r.dimensions).map((d) => d.value)]) assert.ok(v === null || (Number.isInteger(v) && v >= 0 && v <= 100), String(v));
  });

  test('FAIRNESS: hours worked never change any score', () => {
    const a = healthyWeek(5); const b = structuredClone(a);
    b.tasks.forEach((t) => (t.actual_minutes = 900));
    a.tasks.forEach((t) => (t.actual_minutes = 30));
    const ra = score(data(a)), rb = score(data(b));
    assert.equal(ra.overall, rb.overall);
    for (const d of Object.keys(ra.dimensions)) assert.equal(ra.dimensions[d].value, rb.dimensions[d].value, d);
  });

  test('FAIRNESS: splitting one task into several smaller ones does not raise productivity', () => {
    // A: one high-priority task done, one high-priority task open.  B: same open task, the done one split into 3 low tasks.
    const open = () => task({ priority: 'high', status: 'in_progress', deadlineDay: 3 });
    const base = () => [task({ priority: 'medium', doneDay: 1, deadlineDay: 2 }), task({ priority: 'medium', doneDay: 2, deadlineDay: 3 })];
    const A = [...base(), task({ priority: 'high', doneDay: 3, deadlineDay: 4 }), open()];
    const B = [...base(), task({ priority: 'low', doneDay: 3, deadlineDay: 4 }), task({ priority: 'low', doneDay: 3, deadlineDay: 4 }), task({ priority: 'low', doneDay: 3, deadlineDay: 4 }), open()];
    const pa = score(data({ tasks: A })).dimensions.productivity, pb = score(data({ tasks: B })).dimensions.productivity;
    assert.equal(pb.value, pa.value);
    assert.ok(pb.value <= pa.value);
  });

  test('FAIRNESS: task count alone never raises a score (same ratios, double the tasks)', () => {
    const mk = (n) => { const t = []; for (let i = 0; i < n; i++) t.push(task({ doneDay: 1, deadlineDay: 2 }), task({ status: 'in_progress', deadlineDay: 3 })); return t; };
    assert.equal(score(data({ tasks: mk(4) })).dimensions.productivity.value, score(data({ tasks: mk(2) })).dimensions.productivity.value);
  });

  test('FAIRNESS: missing data is "not enough data" (null), never 0, and is dropped from overall', () => {
    const d = data({ tasks: [task({ doneDay: 1, deadlineDay: 2 }), task({ doneDay: 2, deadlineDay: 3 })] });
    const r = score(d);
    assert.equal(r.dimensions.productivity.value, null);
    assert.equal(r.dimensions.quality.value, null);
    assert.ok(r.dropped.includes('productivity'));
    assert.ok(r.overall === null || r.overall > 0, 'overall is re-normalised over the dimensions that have data');
  });

  test('FAIRNESS: an employee with no history gets null everywhere, not zeros', () => {
    const r = score(data());
    assert.equal(r.overall, null);
    for (const d of Object.values(r.dimensions)) assert.equal(d.value, null);
  });

  test('FAIRNESS: overall re-normalises remaining weights when a dimension is dropped', () => {
    const r = score(data(healthyWeek(5)));
    const avail = Object.entries(r.dimensions).filter(([, v]) => v.value != null);
    const w = avail.reduce((a, [k]) => a + r.weights[k], 0);
    const expected = Math.round(avail.reduce((a, [k, v]) => a + v.value * r.weights[k], 0) / w);
    assert.equal(r.overall, expected);
  });

  test('FAIRNESS: externally blocked open tasks are excluded from completion rate', () => {
    const done = [task({ doneDay: 1, deadlineDay: 2 }), task({ doneDay: 2, deadlineDay: 3 }), task({ doneDay: 3, deadlineDay: 4 })];
    const stuck = task({ status: 'blocked', deadlineDay: 3 });
    const ext = { id: 900, task_id: stuck.id, user_id: 1, is_external: true, dependency_type: 'external', dependency_name: 'Vendor', status: 'open', opened_at: at(1), resolved_at: null };
    const internal = { ...ext, is_external: false, dependency_type: 'team' };
    const withExt = score(data({ tasks: [...done, stuck], blockers: [ext] })).dimensions.productivity;
    const withInt = score(data({ tasks: [...done, stuck], blockers: [internal] })).dimensions.productivity;
    assert.equal(withExt.inputs.completion_rate, 100);
    assert.ok(withExt.excluded.some((x) => x.id === stuck.id));
    assert.ok(withInt.inputs.completion_rate < 100, 'internal blockers still count');
  });

  test('FAIRNESS: external blocked time extends the deadline for on-time', () => {
    const late = task({ doneDay: 4, deadlineDay: 2 }); // 2 days late
    const others = [task({ doneDay: 1, deadlineDay: 2 }), task({ doneDay: 1, deadlineDay: 2 })];
    const ext = { id: 901, task_id: late.id, user_id: 1, is_external: true, dependency_type: 'external', dependency_name: 'AWS', status: 'resolved', opened_at: at(1), resolved_at: at(4) };
    assert.equal(score(data({ tasks: [late, ...others] })).dimensions.productivity.inputs.on_time, 2);
    assert.equal(score(data({ tasks: [late, ...others], blockers: [ext] })).dimensions.productivity.inputs.on_time, 3);
  });

  test('FAIRNESS: tasks deleted within 10 minutes of creation are excluded', () => {
    const t = task({ status: 'in_progress', deadlineDay: 2 });
    t.deleted_at = new Date(new Date(t.created_at).getTime() + 5 * 60000).toISOString();
    const r = score(data({ tasks: [...healthyWeek(4).tasks, t] }));
    assert.ok(r.dimensions.productivity.excluded.some((x) => x.id === t.id && /10 minutes/.test(x.reason)));
    assert.equal(r.dimensions.productivity.inputs.eligible, 4);
  });

  test('PROVISIONAL when < 5 eligible tasks or < 2 reviewed', () => {
    const four = healthyWeek(4);
    assert.equal(score(data(four)).is_provisional, true);
    const five = healthyWeek(5);
    assert.equal(score(data(five)).is_provisional, false);
    const unreviewed = healthyWeek(6); unreviewed.reviews = unreviewed.reviews.slice(0, 1);
    const r = score(data(unreviewed));
    assert.equal(r.is_provisional, true);
    assert.ok(r.provisional_reasons.some((x) => /reviewed/.test(x)));
  });

  test('OVERRIDES replace the value and keep the original visible', () => {
    const d = data(healthyWeek(5));
    const before = score(d).dimensions.quality.value;
    d.score_overrides = [{ user_id: 1, period_start: '2026-11-02', dimension: 'quality', new_value: 42, reason: 'Re-scoped work', manager_id: 9, created_at: NOW.toISOString() }];
    const q = score(d).dimensions.quality;
    assert.equal(q.value, 42);
    assert.equal(q.override.original_value, before);
    assert.equal(q.override.reason, 'Re-scoped work');
    // other users / weeks unaffected
    assert.equal(computeScores(d, 1, PREV(1), { now: NOW }).dimensions.quality.override, undefined);
  });

  test('WEIGHTS change the overall, not the dimensions', () => {
    const w = healthyWeek(5); w.tasks[0].status = 'in_progress'; w.tasks[0].completed_at = null; // productivity < 100
    const a = score(data({ ...w }));
    const b = score(data({ ...w, weights: { productivity: 60, quality: 10, impact: 10, consistency: 10, ownership: 10 } }));
    assert.equal(a.dimensions.productivity.value, b.dimensions.productivity.value);
    assert.notEqual(a.overall, b.overall);
  });

  test('QUALITY: clarification counts half, rejection zero, evidence rate and ratings blend in', () => {
    const t = Array.from({ length: 4 }, (_, i) => task({ doneDay: i, deadlineDay: i + 1 }));
    const reviews = [rv(t[0]), rv(t[1]), rv(t[2], 'clarification_requested'), rv(t[3], 'rejected')];
    const q = score(data({ tasks: t, evidence: t.map(ev), reviews })).dimensions.quality;
    // verified rate = (1+1+0.5+0)/4 = 62.5; evidence 100; no ratings → 60/85*62.5 + 25/85*100 = 73.5
    assert.equal(q.value, Math.round((60 * 62.5 + 25 * 100) / 85));
    const withRatings = score(data({ tasks: t, evidence: t.map(ev), reviews: reviews.map((r) => ({ ...r, quality_rating: 5 })) })).dimensions.quality;
    assert.equal(withRatings.value, Math.round(0.6 * 62.5 + 0.25 * 100 + 0.15 * 100));
  });

  test('QUALITY: the latest review decides (resubmitted then verified = verified)', () => {
    const t = Array.from({ length: 3 }, (_, i) => task({ doneDay: i, deadlineDay: i + 1 }));
    const reviews = [rv(t[0], 'clarification_requested'), rv(t[0], 'verified'), rv(t[1]), rv(t[2])];
    assert.equal(score(data({ tasks: t, evidence: t.map(ev), reviews })).dimensions.quality.inputs.verified, 3);
  });

  test('IMPACT: verified full, unverified 50%, rejected 0; vs previous-4-week median; capped at 100', () => {
    // previous 4 weeks: 6 points each (two verified medium tasks)
    const hist = [];
    for (let w = 1; w <= 4; w++) for (let k = 0; k < 2; k++) hist.push(task({ base: PREV(w), doneDay: k, deadlineDay: k + 1, verification: 'verified', impact: 'medium' }));
    const cur = [
      task({ doneDay: 1, deadlineDay: 2, verification: 'verified', impact: 'high' }), // 6
      task({ doneDay: 2, deadlineDay: 3, verification: 'pending', impact: 'medium' }), // 1.5
      task({ doneDay: 3, deadlineDay: 4, verification: 'rejected', impact: 'high' }), // 0
    ];
    const i = score(data({ tasks: [...hist, ...cur] })).dimensions.impact;
    assert.equal(i.inputs.points, 7.5);
    assert.equal(i.inputs.trailing_median, 6);
    assert.equal(i.value, 100, 'capped');
    const small = score(data({ tasks: [...hist, cur[1], cur[2], task({ doneDay: 1, deadlineDay: 2, verification: 'verified', impact: 'low' })] })).dimensions.impact;
    assert.equal(small.inputs.points, 2.5);
    assert.equal(small.value, Math.round((2.5 / 6) * 100));
  });

  test('IMPACT: no previous-week baseline → not enough data (never 0)', () => {
    assert.equal(score(data(healthyWeek(5))).dimensions.impact.value, null);
  });

  test('CONSISTENCY: active days / working days, leave days excluded', () => {
    const t = [0, 1, 2].map((d) => task({ createdDay: d, doneDay: d, deadlineDay: d + 1 }));
    t[0].created_at = at(-7); // has history before the week
    const c = score(data({ tasks: t })).dimensions.consistency;
    assert.equal(c.inputs.working_days, 5);
    assert.equal(c.value, 60);
    const leave = { 1: ['2026-11-05', '2026-11-06'] };
    assert.equal(score(data({ tasks: t, leave })).dimensions.consistency.value, 100);
  });

  test('CONSISTENCY: days before the employee’s first task are not counted', () => {
    const t = [2, 3, 4].map((d) => task({ createdDay: d, doneDay: d, deadlineDay: d + 1 }));
    const c = score(data({ tasks: t })).dimensions.consistency;
    assert.equal(c.inputs.working_days, 3);
    assert.equal(c.value, 100);
  });

  test('OWNERSHIP: prompt, named blockers and no silent overdue', () => {
    const t = [task({ status: 'in_progress', deadlineDay: 1 }), task({ status: 'in_progress', deadlineDay: 2 }), task({ status: 'not_started', deadlineDay: 3 })];
    const b1 = { id: 1, task_id: t[0].id, user_id: 1, is_external: false, dependency_type: 'team', dependency_name: 'Platform', status: 'open', opened_at: at(0, 14), resolved_at: null };
    const b2 = { id: 2, task_id: t[1].id, user_id: 1, is_external: false, dependency_type: 'unclear', dependency_name: null, status: 'open', opened_at: at(4, 9), resolved_at: null };
    const o = score(data({ tasks: t, blockers: [b1, b2] })).dimensions.ownership;
    assert.equal(o.inputs.reported_fast, 1);
    assert.equal(o.inputs.named_dependency, 1);
    assert.equal(o.inputs.deadlines_passed, 3);
    assert.equal(o.inputs.updated_before_deadline, 2, 'the not-started task went silently overdue');
    assert.equal(o.value, Math.round(0.4 * 50 + 0.3 * 50 + 0.3 * (200 / 3)));
  });
});
