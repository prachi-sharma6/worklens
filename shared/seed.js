// Deterministic demo-data generator. Pure JS, no deps.
// Used by the client mock API (Phase 1) and by the server seeder (Phase 2).
// All people and companies here are fictional.

const DAY = 86400000;

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const iso = (d) => new Date(d).toISOString();
export const dateKey = (d) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};
const atTime = (d, h, m = 0) => { const x = new Date(d); x.setHours(h, m, 0, 0); return x; };
const isWeekend = (d) => { const g = new Date(d).getDay(); return g === 0 || g === 6; };
function addWorkdays(d, n) {
  let x = new Date(d);
  let left = n;
  while (left > 0) { x = new Date(x.getTime() + DAY); if (!isWeekend(x)) left--; }
  return x;
}

const TEMPLATES = {
  engineering: [
    ['Fix checkout timeout on slow networks', 'Payments API times out for users on 3G; add retry with backoff.', 'Checkout success rate on slow networks back above 98%', 'high'],
    ['Add rate limiting to public API', 'Protect /v1/search from bursts.', 'No single client exceeds 100 req/min; p95 stays under 300ms', 'medium'],
    ['Migrate session store to Redis', 'Move sessions out of the app process.', 'Zero-downtime deploys without logging users out', 'high'],
    ['Write integration tests for invoices module', 'Cover create, void and refund flows.', 'Invoice module coverage from 41% to 80%', 'medium'],
    ['Upgrade Node runtime to 20 LTS', 'Bump runtime and fix deprecations.', 'All services on Node 20 with green CI', 'low'],
    ['Fix flaky e2e test in onboarding suite', 'Test fails ~1 in 8 runs.', 'Onboarding suite passes 50 consecutive runs', 'low'],
    ['Reduce dashboard API latency', 'Aggregate queries are slow for big teams.', 'Dashboard p95 latency under 400ms', 'high'],
    ['Implement CSV export for reports', 'Customers asked to export reports.', 'Export works for 10k-row reports in under 5s', 'medium'],
    ['Patch XSS in comment renderer', 'Sanitize markdown in comments.', 'Security scan shows no XSS findings', 'high'],
    ['Code review: webhook retry logic', 'Review teammate PR on webhook retries.', 'PR merged with agreed changes', 'low'],
    ['Add feature flag for new editor', 'Gate the new editor behind a flag.', 'Editor can be toggled per workspace', 'medium'],
    ['Investigate memory leak in worker', 'Worker RSS grows ~50MB/hour.', 'Root cause found and fix deployed', 'high'],
  ],
  design: [
    ['Redesign onboarding checklist', 'New users drop off at step 3.', 'Prototype tested with 5 users; step-3 drop-off addressed', 'high'],
    ['Create empty states for reports page', 'Reports page is blank for new teams.', 'Empty states for 4 report types handed off', 'low'],
    ['Audit color contrast for accessibility', 'Check WCAG AA on core screens.', 'All core screens meet WCAG AA contrast', 'medium'],
    ['Design billing settings page', 'Self-serve plan changes.', 'Hi-fi mocks approved by PM and eng', 'medium'],
    ['Update icon set to 1.5px stroke', 'Unify icon weights.', '120 icons updated in the design library', 'low'],
    ['User interviews: admin workflows', 'Run 4 interviews with admins.', 'Synthesis doc with top 5 pain points', 'high'],
    ['Mobile layout for task board', 'Board is unusable under 400px.', 'Responsive spec for 375px handed off', 'medium'],
    ['Design system: table component', 'Standardize data tables.', 'Table component with 6 variants in library', 'medium'],
  ],
  support: [
    ['Resolve escalated SSO login issue for Northwind', 'Customer cannot log in via Okta.', 'Customer logged in; root cause documented', 'high'],
    ['Write help article: exporting data', 'Top-10 ticket topic.', 'Article published; linked from in-app help', 'medium'],
    ['Triage weekend ticket backlog', '42 tickets waiting since Saturday.', 'Backlog under 10 by noon', 'medium'],
    ['Create macro for refund requests', 'Speed up refund replies.', 'Refund handle time down 30%', 'low'],
    ['Reproduce PDF export bug for Contoso', 'PDF cuts off long tables.', 'Bug reproduced and filed with steps', 'medium'],
    ['Update status page incident template', 'Clearer incident comms.', 'New template approved and live', 'low'],
    ['Onboard Fabrikam enterprise workspace', 'Assist with SCIM setup.', 'Workspace live with 300 users provisioned', 'high'],
    ['Analyse top ticket drivers for October', 'Monthly ticket analysis.', 'Report with top 5 drivers shared with product', 'medium'],
  ],
  marketing: [
    ['Launch November product update email', 'Monthly update to 18k users.', 'Email sent; open rate above 35%', 'medium'],
    ['Write case study: Tailspin Logistics', 'Customer story for the website.', 'Case study approved by customer and published', 'high'],
    ['Set up UTM tracking for webinar', 'Attribute webinar sign-ups.', 'All webinar links tagged; dashboard shows sources', 'low'],
    ['Refresh pricing page copy', 'Clarify plan differences.', 'New copy live; A/B test running', 'high'],
    ['Plan Q1 content calendar', '12 weeks of blog + social.', 'Calendar approved with owners per piece', 'medium'],
    ['Publish SEO article: time tracking vs. outcomes', 'Target keyword cluster.', 'Article published and indexed', 'medium'],
    ['Prepare webinar slide deck', 'Deck for "Measuring real work" webinar.', 'Deck reviewed and rehearsed', 'medium'],
    ['Compile social proof quotes', 'Collect quotes for landing pages.', '15 approved quotes in shared doc', 'low'],
  ],
};

const EVIDENCE_BY_CAT = {
  engineering: ['github', 'github', 'test_result', 'github', 'explanation'],
  design: ['document', 'screenshot', 'deliverable', 'document'],
  support: ['explanation', 'document', 'deliverable', 'explanation'],
  marketing: ['deliverable', 'document', 'screenshot', 'deliverable'],
};

const EXTERNAL_DEPS = ['Razorpay support', 'AWS support', 'Okta (customer IT)', 'Legal (external counsel)', 'Print vendor'];
const INTERNAL_DEPS = [['team', 'Platform team'], ['person', 'Meera Kapoor'], ['team', 'Data team'], ['tool', 'CI pipeline']];

export const DEFAULT_SETTINGS = {
  score_weights: { productivity: 25, quality: 25, impact: 25, consistency: 15, ownership: 10 },
  workday_end: '18:30',
  timezone: 'Asia/Kolkata',
  slack_channel: null,
  report_recipients: [],
  leave_days: {},
  features: { ai_enrichment: true, ai_blockers: true, ai_reports: true, slack_alerts: true, email_reports: true, employee_dms: true },
};

const ROUND_SUFFIX = ['', ' — follow-up', ' — phase 2', ' — rollout', ' — round 5'];
const fromTpl = (tpl, i, off = 0) => { const [title, ...rest] = tpl[(i + off) % tpl.length]; return [title + ROUND_SUFFIX[Math.min(Math.floor(i / tpl.length), ROUND_SUFFIX.length - 1)], ...rest]; };

export function generateSeed(nowInput = new Date()) {
  const now = new Date(nowInput);
  const rand = mulberry32(20261121);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const chance = (p) => rand() < p;
  const today = atTime(now, 0);

  const teams = [{ id: 1, name: 'Product & Growth' }];
  const users = [
    { id: 1, name: 'Meera Kapoor', email: 'manager@worklens.dev', role: 'manager', team_id: 1, manager_id: null, title: 'Head of Product Delivery', avatar_color: '#6366F1', timezone: 'Asia/Kolkata', category: null },
    { id: 2, name: 'Aarav Sharma', email: 'aarav@worklens.dev', role: 'employee', team_id: 1, manager_id: 1, title: 'Senior Software Engineer', avatar_color: '#0EA5E9', timezone: 'Asia/Kolkata', category: 'engineering' },
    { id: 3, name: 'Priya Nair', email: 'priya@worklens.dev', role: 'employee', team_id: 1, manager_id: 1, title: 'Product Designer', avatar_color: '#EC4899', timezone: 'Asia/Kolkata', category: 'design' },
    { id: 4, name: 'Rohan Mehta', email: 'rohan@worklens.dev', role: 'employee', team_id: 1, manager_id: 1, title: 'Customer Support Engineer', avatar_color: '#F59E0B', timezone: 'Asia/Kolkata', category: 'support' },
    { id: 5, name: 'Zoya Khan', email: 'zoya@worklens.dev', role: 'employee', team_id: 1, manager_id: 1, title: 'Growth Marketer', avatar_color: '#10B981', timezone: 'Asia/Kolkata', category: 'marketing' },
    { id: 6, name: 'Kabir Das', email: 'kabir@worklens.dev', role: 'employee', team_id: 1, manager_id: 1, title: 'Software Engineer (joined this week)', avatar_color: '#8B5CF6', timezone: 'Asia/Kolkata', category: 'engineering' },
  ];

  const tasks = [], evidence = [], comments = [], blockers = [], reviews = [], timeline = [];
  let tid = 1, eid = 1, cid = 1, bid = 1, rid = 1, lid = 1;
  const ev = (user_id, task_id, event_type, title, detail, at) =>
    timeline.push({ id: lid++, user_id, task_id, event_type, title, detail, occurred_at: iso(at), created_at: iso(at) });

  // working days in the last 3 weeks (oldest first), plus next 5 working days
  const pastDays = [];
  for (let i = 21; i >= 0; i--) { const d = new Date(today.getTime() - i * DAY); if (!isWeekend(d)) pastDays.push(d); }
  const lastWorkday = pastDays[pastDays.length - 1];

  for (const u of users.filter((x) => x.role === 'employee')) {
    const isNew = u.id === 6;
    const days = isNew ? pastDays.slice(-3) : pastDays;
    const perDay = isNew ? [1, 1, 2] : null;
    const tpl = TEMPLATES[u.category];
    let tplIdx = 0;
    const tplOffset = Math.floor(rand() * tpl.length);

    days.forEach((day, di) => {
      const n = perDay ? perDay[di] : (chance(0.5) ? 2 : 1) + (chance(0.2) ? 1 : 0);
      for (let k = 0; k < n; k++) {
        const [title, description, expected, impact] = fromTpl(tpl, tplIdx++, tplOffset);
        const created = atTime(day, 9 + Math.floor(rand() * 3), Math.floor(rand() * 60));
        const priority = impact === 'high' ? pick(['high', 'critical', 'high']) : impact === 'medium' ? pick(['medium', 'high', 'medium']) : pick(['low', 'medium']);
        const deadline = atTime(addWorkdays(day, 1 + Math.floor(rand() * 3)), 18, 0);
        const est = pick([30, 60, 90, 120, 180, 240, 360]);
        const t = {
          id: tid++, user_id: u.id, title, description, category: u.category, priority,
          expected_outcome: expected, actual_outcome: null, estimated_minutes: est, actual_minutes: null,
          deadline: iso(deadline), status: 'not_started', impact_level: impact, impact_note: null,
          is_planned_today: false, planned_for_date: null, started_at: null, completed_at: null,
          ai_enriched: false, ai_suggestions_json: null, verification_status: 'unsubmitted',
          deleted_at: null, created_at: iso(created), updated_at: iso(created),
        };
        tasks.push(t);
        ev(u.id, t.id, 'task_created', `Created “${title}”`, null, created);

        const ageDays = (now - created) / DAY;
        const started = new Date(created.getTime() + (30 + rand() * 180) * 60000);
        if (started < now) { t.status = 'in_progress'; t.started_at = iso(started); }

        // blockers (~12%), external ones more common
        let blocker = null;
        if (!isNew && t.started_at && chance(ageDays < 4 ? 0.2 : 0.12)) {
          const external = chance(0.55);
          const [dtype, dname] = external ? ['external', pick(EXTERNAL_DEPS)] : pick(INTERNAL_DEPS);
          const unclear = !external && chance(0.25);
          const opened = new Date(started.getTime() + (chance(0.8) ? 2 + rand() * 20 : 30 + rand() * 20) * 3600000);
          if (opened < now) {
            const resolved = ageDays > 5 && chance(0.9);
            const resolvedAt = resolved ? new Date(opened.getTime() + (6 + rand() * 50) * 3600000) : null;
            blocker = {
              id: bid++, task_id: t.id, user_id: u.id,
              description: external ? `Waiting on ${dname} to respond to our ticket.` : unclear ? 'Stuck — not sure who owns the config for this.' : `Need input from ${dname} before continuing.`,
              dependency_type: unclear ? 'unclear' : dtype, dependency_name: unclear ? null : dname, is_external: external,
              status: resolvedAt && resolvedAt < now ? 'resolved' : 'open',
              opened_at: iso(opened), resolved_at: resolvedAt && resolvedAt < now ? iso(resolvedAt) : null,
              resolution_note: resolvedAt && resolvedAt < now ? pick(['Vendor replied with fix; config updated.', 'Got access, continued.', 'Owner identified and unblocked us.']) : null,
              created_at: iso(opened), updated_at: iso(resolvedAt && resolvedAt < now ? resolvedAt : opened),
            };
            blockers.push(blocker);
            ev(u.id, t.id, 'blocker_opened', `Blocked: ${title}`, blocker.description, opened);
            if (blocker.status === 'open') t.status = 'blocked';
            else ev(u.id, t.id, 'blocker_resolved', `Unblocked: ${title}`, blocker.resolution_note, resolvedAt);
          }
        }

        // completion
        const pastDeadline = new Date(t.deadline) < now;
        const completeP = isNew ? 0.5 : pastDeadline ? 0.93 : ageDays > 1 ? 0.45 : 0.15;
        if (t.status !== 'blocked' && t.started_at && chance(completeP)) {
          const late = chance(0.15);
          const blockedHrs = blocker && blocker.resolved_at ? (new Date(blocker.resolved_at) - new Date(blocker.opened_at)) / 3600000 : 0;
          let doneAt = late
            ? new Date(new Date(t.deadline).getTime() + (4 + rand() * 30) * 3600000)
            : new Date(Math.min(new Date(t.deadline).getTime() - rand() * 20 * 3600000, created.getTime() + (2 + rand() * 40) * 3600000 + blockedHrs * 3600000));
          if (doneAt <= started) doneAt = new Date(started.getTime() + 90 * 60000);
          if (blocker && blocker.resolved_at && doneAt < new Date(blocker.resolved_at)) doneAt = new Date(new Date(blocker.resolved_at).getTime() + 2 * 3600000);
          if (doneAt < now) {
            t.status = 'completed';
            t.completed_at = iso(doneAt);
            t.actual_minutes = chance(0.7) ? Math.round(est * (0.6 + rand() * 0.9)) : null;
            t.actual_outcome = `Done: ${expected.charAt(0).toLowerCase()}${expected.slice(1)}.`;
            t.updated_at = iso(doneAt);
            ev(u.id, t.id, 'task_completed', `Completed “${title}”`, t.actual_outcome, doneAt);

            if (chance(isNew ? 0.6 : 0.82)) {
              const nEv = chance(0.3) ? 2 : 1;
              for (let j = 0; j < nEv; j++) {
                const type = pick(EVIDENCE_BY_CAT[u.category]);
                const at = new Date(doneAt.getTime() + j * 600000);
                const e = { id: eid++, task_id: t.id, type, url: null, file_path: null, note: null, submitted_at: iso(at), created_at: iso(at), updated_at: iso(at) };
                if (type === 'github') e.url = `https://github.com/worklens-demo/app/pull/${1200 + t.id}`;
                else if (type === 'document') e.url = `https://docs.example.com/d/${t.id}-${u.category}`;
                else if (type === 'deliverable') e.url = `https://files.example.com/deliverables/${t.id}`;
                else if (type === 'test_result') { e.note = `CI run #${4000 + t.id}: 214 passed, 0 failed`; e.url = `https://ci.example.com/runs/${4000 + t.id}`; }
                else if (type === 'screenshot') { e.file_path = null; e.url = `https://files.example.com/screens/${t.id}.png`; e.note = 'Before/after screenshot'; }
                else e.note = `Explained what changed and how it was verified: ${expected.toLowerCase()}. Checked with the requester before closing.`;
                evidence.push(e);
                ev(u.id, t.id, 'evidence_submitted', `Evidence added to “${title}”`, type.replace('_', ' '), at);
              }
              t.verification_status = 'pending';
              const reviewAt = new Date(doneAt.getTime() + (3 + rand() * 30) * 3600000);
              if (reviewAt < now && chance(isNew ? 0.4 : 0.8)) {
                const r = rand();
                const decision = r < 0.8 ? 'verified' : r < 0.92 ? 'clarification_requested' : 'rejected';
                const note = decision === 'verified' ? pick(['Looks good — clear evidence.', 'Verified, nice work.', 'Confirmed with the requester.', null])
                  : decision === 'clarification_requested' ? 'Can you add the before/after numbers?' : 'Evidence does not show the outcome; please redo the check.';
                const review = { id: rid++, task_id: t.id, manager_id: 1, decision, note, quality_rating: decision === 'verified' && chance(0.7) ? 3 + Math.floor(rand() * 3) : decision === 'rejected' ? 2 : null, created_at: iso(reviewAt), updated_at: iso(reviewAt) };
                reviews.push(review);
                t.verification_status = decision;
                ev(u.id, t.id, decision === 'verified' ? 'verified' : 'feedback', decision === 'verified' ? `Verified: ${title}` : `Feedback on “${title}”`, note, reviewAt);
                if (decision === 'verified' && impact === 'high') ev(u.id, t.id, 'achievement', `High-impact delivery: ${title}`, expected, new Date(reviewAt.getTime() + 60000));
                if (decision !== 'verified') {
                  comments.push({ id: cid++, task_id: t.id, author_id: 1, body: note, kind: 'clarification', created_at: iso(reviewAt), updated_at: iso(reviewAt) });
                }
              }
            }
          }
        }

        if (chance(0.18)) {
          const at = new Date(created.getTime() + 3600000 * (1 + rand() * 5));
          if (at < now) comments.push({ id: cid++, task_id: t.id, author_id: chance(0.5) ? 1 : u.id, body: pick(['Pushed a first draft, feedback welcome.', 'Scope confirmed with PM.', 'Will pair on this tomorrow morning.', 'Adding notes from the customer call.']), kind: 'comment', created_at: iso(at), updated_at: iso(at) });
        }

        if (dateKey(day) === dateKey(lastWorkday) || (t.status !== 'completed' && new Date(t.deadline) >= today)) {
          t.is_planned_today = true; t.planned_for_date = dateKey(now);
        }
      }
    });

    // tasks planned for the coming days (not started)
    const upcoming = isNew ? 1 : 2;
    for (let k = 0; k < upcoming; k++) {
      const [title, description, expected, impact] = fromTpl(tpl, tplIdx++, tplOffset);
      const created = new Date(now.getTime() - (2 + k) * 3600000);
      tasks.push({
        id: tid++, user_id: u.id, title, description, category: u.category, priority: impact === 'high' ? 'high' : 'medium',
        expected_outcome: expected, actual_outcome: null, estimated_minutes: 120, actual_minutes: null,
        deadline: iso(atTime(addWorkdays(today, 1 + k), 18)), status: 'not_started', impact_level: impact, impact_note: null,
        is_planned_today: k === 0, planned_for_date: k === 0 ? dateKey(now) : null, started_at: null, completed_at: null,
        ai_enriched: false, ai_suggestions_json: null, verification_status: 'unsubmitted', deleted_at: null,
        created_at: iso(created), updated_at: iso(created),
      });
      ev(u.id, tid - 1, 'task_created', `Created “${title}”`, null, created);
    }
  }

  timeline.sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  timeline.forEach((e, i) => (e.id = i + 1));

  return {
    teams, users, tasks, evidence, comments, blockers, reviews, timeline,
    score_overrides: [], settings: structuredClone(DEFAULT_SETTINGS),
    integration_events: [], daily_reports: [], weekly_reports: [],
  };
}
