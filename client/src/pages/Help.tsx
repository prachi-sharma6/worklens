import { Link } from 'react-router-dom';
import { ChevronRight, GraduationCap, Keyboard, PlugZap, Scale, Sparkles } from 'lucide-react';
import { Card } from '@/components/ui';
import { EMPLOYEE_GROUPS, MANAGER_GROUPS, FOOTER_NAV } from '@/components/layout/nav';
import { ShowGuideButton } from '@/components/Onboarding';
import { VIASOCKET_URL } from '@/components/IntegrationStatus';
import { useAuth } from '@/context';

const QUICKSTART = {
  employee: [
    ['Plan', 'Add tasks with an expected outcome (“p95 under 400 ms”, not “improve speed”). Press Add Task anywhere, or Ctrl K.'],
    ['Work', 'Move tasks to In progress. Stuck? Report a blocker with who you’re waiting on — external waits never count against you.'],
    ['Finish', 'Complete with evidence: a PR, document, screenshot, test result or written explanation. Your manager verifies it.'],
    ['Respond', 'If your manager asks to clarify, reply on the task, add evidence and resubmit. “Needs your attention” on your dashboard lists these.'],
    ['Reflect', 'Performance shows your five scores with the formula and real numbers behind each. Reports are ready to share.'],
  ],
  manager: [
    ['Connect', 'Integrations → connect Slack and Gmail through viaSocket, choose the alert channel and report recipients.'],
    ['Review', 'Manager Dashboard → review queue. Verify, ask to clarify (note required) or reject, with an optional 1–5 quality rating.'],
    ['Unblock', 'Open blockers show who each person is waiting on and for how long. Slack alerts you when something needs you.'],
    ['Understand', 'Team Performance shows distributions and trends — no rankings. Each profile explains every score; you can adjust one with a reason.'],
    ['Report', 'Daily and weekly reports (team digest or one person) are generated, saved, and delivered to Slack and Gmail automatically.'],
  ],
} as const;

const DIMS = [
  ['Productivity', '25%', 'Tasks completed and on time, weighted by priority.'],
  ['Quality', '25%', 'Verified by your manager, with evidence attached.'],
  ['Impact', '25%', 'Impact of verified work vs. your own usual week.'],
  ['Consistency', '15%', 'Days with real progress (leave excluded).'],
  ['Ownership', '10%', 'Blockers reported early and named; no silent overdue.'],
];

const FAQ = [
  ['Do longer hours raise my score?', 'No. Hours are shown only for estimation accuracy; they never change a score. Splitting work into many tiny tasks doesn’t help either.'],
  ['Who can see my scores and tasks?', 'You and your manager. Teammates can’t see each other’s work, and there is no leaderboard.'],
  ['Why does a score say “Not enough data” or “Provisional”?', 'With fewer than 3 data points a dimension is left out instead of counted as zero. The overall is Provisional with fewer than 5 eligible or 2 reviewed tasks.'],
  ['What does the AI see, and can it change my score?', 'Only WorkLens records (task titles, outcomes, evidence, blockers). It never browses the web, never invents facts, and never computes or changes scores. Every AI text says how many records it was written from.'],
  ['What is viaSocket?', 'The service that connects WorkLens to AI, Slack and Gmail. It holds the sign-ins and runs the AI, so WorkLens stores no app passwords or AI keys.'],
  ['My manager changed a score — can I see why?', 'Yes. Adjusted scores show “Adjusted by manager” with the reason, and the original value stays visible.'],
];

export default function HelpPage() {
  const { user } = useAuth();
  const role = user?.role === 'manager' ? 'manager' : 'employee';
  const groups = role === 'manager' ? MANAGER_GROUPS : EMPLOYEE_GROUPS;
  return (
    <div className="space-y-5 max-w-5xl">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h1 className="h-page flex items-center gap-2"><GraduationCap size={20} className="text-accent" />How to use WorkLens</h1>
          <p className="text-sm text-muted mt-0.5">WorkLens measures what you contribute — outcomes with evidence — not how busy you look.</p>
        </div>
        <ShowGuideButton />
      </div>

      <Card title={`Quick start — ${role === 'manager' ? 'for managers' : 'for team members'}`}>
        <ol className="grid gap-3 md:grid-cols-5">
          {QUICKSTART[role].map(([t, b], i) => (
            <li key={t} className="rounded-lg border border-border p-3">
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-accent text-accent-fg text-xs font-semibold">{i + 1}</span>
              <p className="text-sm font-semibold mt-2">{t}</p>
              <p className="text-xs text-muted mt-1 leading-relaxed">{b}</p>
            </li>
          ))}
        </ol>
      </Card>

      <Card title="Every page, in one line">
        <div className="grid gap-4 md:grid-cols-2">
          {[...groups, { title: 'Help & settings', items: FOOTER_NAV }].map((g) => (
            <div key={g.title}>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-faint mb-1.5">{g.title}</p>
              <ul className="space-y-1">
                {g.items.map(({ to, label, hint, icon: Icon }) => (
                  <li key={to}><Link to={to} className="flex items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-subtle">
                    <Icon size={15} className="text-accent shrink-0" /><span className="text-[13px] font-medium w-36 shrink-0">{label}</span><span className="text-xs text-muted flex-1">{hint}</span><ChevronRight size={14} className="text-faint" />
                  </Link></li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card title={<span className="flex items-center gap-1.5"><Scale size={15} className="text-accent" />How work is measured</span>} subtitle="Every score card has “How is this calculated?” with the real numbers.">
          <ul className="divide-y divide-border">
            {DIMS.map(([n, w, d]) => <li key={n} className="py-2 flex gap-3 text-xs"><span className="w-24 font-medium text-[13px]">{n}</span><span className="w-10 text-faint tnum">{w}</span><span className="text-muted flex-1">{d}</span></li>)}
          </ul>
          <Link to={role === 'manager' ? '/team' : '/performance'} className="inline-block mt-3 text-xs text-accent hover:underline">{role === 'manager' ? 'Open Team Performance →' : 'Open my Performance →'}</Link>
        </Card>
        <Card title={<span className="flex items-center gap-1.5"><PlugZap size={15} className="text-accent" />Automations & connected apps</span>} subtitle="Powered by viaSocket">
          <ul className="space-y-1.5 text-xs text-muted list-disc pl-4">
            <li>AI suggests a measurable outcome for new tasks and names who a vague blocker is waiting on.</li>
            <li>Slack: blocker alerts (with a thread update when solved), work ready for review, items needing attention, report digests.</li>
            <li>Gmail: daily report at workday end, weekly analysis on Fridays.</li>
            <li>Everything is logged; nothing is sent twice; failures are shown, never hidden.</li>
          </ul>
          <div className="mt-3 flex gap-3 text-xs">
            <Link to="/integrations" className="text-accent hover:underline">See what’s connected →</Link>
            <a href={VIASOCKET_URL} target="_blank" rel="noreferrer" className="text-muted hover:text-fg">About viaSocket ↗</a>
          </div>
        </Card>
      </div>

      <Card title={<span className="flex items-center gap-1.5"><Sparkles size={15} className="text-accent" />Questions people ask</span>} bodyClass="px-2 pb-2">
        {FAQ.map(([q, a]) => (
          <details key={q} className="group rounded-md px-2 py-2.5 border-b border-border last:border-0 open:bg-subtle/40">
            <summary className="cursor-pointer list-none flex items-center justify-between text-[13px] font-medium">{q}<ChevronRight size={14} className="text-faint transition group-open:rotate-90" /></summary>
            <p className="text-xs text-muted mt-1.5 leading-relaxed">{a}</p>
          </details>
        ))}
      </Card>

      <p className="text-xs text-faint flex items-center gap-1.5"><Keyboard size={13} />Tip: press <kbd className="border border-border rounded px-1">Ctrl K</kbd> anywhere to jump to any page or task.</p>
    </div>
  );
}
