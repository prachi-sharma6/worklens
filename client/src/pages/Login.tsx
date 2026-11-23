import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowRight, Bot, CheckCircle2, ExternalLink, FileCheck2, Gauge, LineChart, ListChecks, Mail, MessageSquare, Moon, PlugZap,
  Scale, ShieldCheck, Sparkles, Sun, Target, UserCheck,
} from 'lucide-react';
import { Avatar, Button, Field, cx } from '@/components/ui';
import { errMsg, useAuth, useTheme } from '@/context';

const VIASOCKET_URL = 'https://viasocket.com';

const DEMO = [
  { email: 'manager@worklens.dev', name: 'Meera Kapoor', role: 'Manager', color: '#5EEAD4', sees: 'Review work, see the team, connect Slack & Gmail via viaSocket' },
  { email: 'aarav@worklens.dev', name: 'Aarav Sharma', role: 'Engineer', color: '#60A5FA', sees: 'Plan tasks, add evidence, see your five scores' },
  { email: 'priya@worklens.dev', name: 'Priya Nair', role: 'Designer', color: '#F472B6', sees: 'A designer’s week, verified deliverables' },
  { email: 'rohan@worklens.dev', name: 'Rohan Mehta', role: 'Support', color: '#FBBF24', sees: 'External blockers that never count against you' },
  { email: 'zoya@worklens.dev', name: 'Zoya Khan', role: 'Marketing', color: '#4ADE80', sees: 'Work waiting for evidence and review' },
  { email: 'kabir@worklens.dev', name: 'Kabir Das', role: 'New joiner', color: '#A78BFA', sees: 'How little data shows as “Provisional”, never zero' },
];

const STEPS = {
  member: [
    [ListChecks, 'Plan an outcome', 'Add a task and say what will be true when it’s done. viaSocket AI suggests a measurable outcome.'],
    [Target, 'Work and flag blockers', 'Move it to In progress. Stuck? Report who you’re waiting on — your manager hears in Slack via viaSocket.'],
    [FileCheck2, 'Finish with evidence', 'Attach a PR, document, screenshot or test result so your manager can verify it.'],
    [LineChart, 'See how you’re measured', 'Five scores, each showing the formula and your real numbers. Your daily report writes itself.'],
  ],
  manager: [
    [PlugZap, 'Connect Slack & Gmail', 'One click each through viaSocket. Alerts go to your channel, reports to your inbox.'],
    [UserCheck, 'Review the evidence', 'Verify, ask to clarify or reject — every decision is recorded and the person is told.'],
    [Gauge, 'Unblock the team', 'See who is waiting on what, for how long. viaSocket alerts you when something needs you.'],
    [Scale, 'Read fair scores', 'Distributions and trends, never rankings. Adjust a score only with a written reason.'],
  ],
} as const;

const POWERED = [
  [Bot, 'viaSocket AI', 'Suggests measurable outcomes, reads unclear blockers and writes daily and weekly summaries — only from WorkLens records.'],
  [MessageSquare, 'Slack via viaSocket', 'Blocker alerts with a thread update when solved, work ready for review, items needing attention, report digests.'],
  [Mail, 'Gmail via viaSocket', 'The daily team report at workday end and the weekly analysis on Fridays, sent from the manager’s own Gmail.'],
  [PlugZap, '2,300+ more apps', 'The same viaSocket connection layer can add Sheets, Jira, Notion and more — no keys stored in WorkLens.'],
] as const;

const DIMS = [
  ['Productivity', 'Done and on time, weighted by priority'],
  ['Quality', 'Verified by your manager, with evidence'],
  ['Impact', 'Verified impact vs. your usual week'],
  ['Consistency', 'Days with real progress'],
  ['Ownership', 'Blockers raised early, nothing silently late'],
];

function Logo() {
  return <div className="h-8 w-8 rounded-lg bg-[#0E1117] ring-1 ring-border flex items-center justify-center shrink-0"><div className="h-4 w-4 rounded-full border-[2.5px] border-[#5EEAD4]" /></div>;
}
function ViasocketBadge({ className }: { className?: string }) {
  return (
    <a href={VIASOCKET_URL} target="_blank" rel="noreferrer" className={cx('inline-flex items-center gap-1.5 h-7 px-3 rounded-full border border-accent/30 bg-accent-soft text-[12px] font-medium text-fg hover:border-accent transition', className)}>
      <Sparkles size={13} className="text-accent" />Built with <span className="font-semibold">viaSocket</span>
    </a>
  );
}

export default function Login() {
  const { user, login } = useAuth();
  const { theme, toggle } = useTheme();
  const nav = useNavigate();
  const loc = useLocation() as { state?: { from?: string } };
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (user) return <Navigate to="/" replace />;

  async function signIn(e: string, p: string, who: string) {
    setBusy(who); setError(null);
    try {
      const u = await login(e, p);
      nav(loc.state?.from && loc.state.from !== '/login' ? loc.state.from : u.role === 'manager' ? '/manager' : '/dashboard', { replace: true });
    } catch (err) { setError(errMsg(err)); } finally { setBusy(null); }
  }

  return (
    <div className="min-h-full bg-bg">
      <header className="sticky top-0 z-20 border-b border-border bg-bg/85 backdrop-blur">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center gap-3">
          <Logo />
          <span className="font-display text-lg font-semibold">WorkLens</span>
          <ViasocketBadge className="hidden sm:inline-flex" />
          <nav aria-label="Sections" className="ml-auto hidden md:flex items-center gap-1 text-sm">
            <a href="#how" className="px-3 h-8 inline-flex items-center rounded-full text-muted hover:text-fg hover:bg-subtle no-underline">How to use</a>
            <a href="#viasocket" className="px-3 h-8 inline-flex items-center rounded-full text-muted hover:text-fg hover:bg-subtle no-underline">Powered by viaSocket</a>
            <a href="#scores" className="px-3 h-8 inline-flex items-center rounded-full text-muted hover:text-fg hover:bg-subtle no-underline">How you’re measured</a>
          </nav>
          <Button variant="ghost" size="icon" onClick={toggle} aria-label="Toggle theme" className="ml-auto md:ml-0">{theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}</Button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6">
        {/* Hero + sign in */}
        <section className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_420px] gap-10 py-10 lg:py-14 items-start">
          <div className="animate-rise min-w-0">
            <ViasocketBadge className="sm:hidden mb-4" />
            <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-accent">The viaSocket challenge · “How can you and your work be measured?”</p>
            <h1 className="font-display text-4xl sm:text-5xl font-semibold tracking-tight leading-[1.08] mt-3">Make every contribution visible.</h1>
            <p className="mt-4 text-base text-muted leading-relaxed max-w-xl">WorkLens measures what you actually deliver — outcomes with evidence, verified by your manager — not how busy you look. Every score explains itself, and <span className="text-fg font-medium">viaSocket</span> connects it to AI, Slack and Gmail so the updates flow by themselves.</p>
            <ul className="mt-6 grid sm:grid-cols-2 gap-3 max-w-xl text-sm">
              {[
                [ShieldCheck, 'Outcomes, verified', 'Evidence on every task, checked by a person'],
                [Scale, 'Fair by design', 'Hours and task counts never raise a score'],
                [Sparkles, 'AI by viaSocket', 'Summaries only from your own records'],
                [PlugZap, 'Connected by viaSocket', 'Slack alerts and Gmail reports, no keys stored'],
              ].map(([Icon, t, d]) => {
                const I = Icon as React.ElementType;
                return (
                  <li key={t as string} className="flex gap-3 rounded-2xl border border-border bg-surface p-3.5">
                    <span className="h-8 w-8 rounded-full bg-accent-soft flex items-center justify-center shrink-0"><I size={15} className="text-accent" /></span>
                    <span><span className="font-medium">{t as string}</span><span className="block text-muted text-xs mt-0.5">{d as string}</span></span>
                  </li>
                );
              })}
            </ul>
            <a href="#how" className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-accent no-underline hover:underline">How to use WorkLens <ArrowRight size={14} /></a>
          </div>

          <div id="signin" className="card p-6 lg:sticky lg:top-20">
            <h2 className="font-display text-xl font-semibold tracking-tight">Try it in one click</h2>
            <p className="text-sm text-muted mt-1">Pick a demo person — you’re signed in straight away. Everyone here is fictional.</p>
            <ul className="mt-4 space-y-2" aria-label="Demo accounts">
              {DEMO.map((d) => (
                <li key={d.email}>
                  <button type="button" disabled={!!busy} onClick={() => signIn(d.email, 'demo1234', d.email)}
                    className={cx('w-full flex items-center gap-3 p-2.5 rounded-xl border border-border bg-bg/40 hover:border-accent/60 hover:bg-accent-soft/40 transition text-left disabled:opacity-60', d.role === 'Manager' && 'border-accent/40')}>
                    <Avatar name={d.name} color={d.color} size={32} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2 text-[13px] font-medium">{d.name}<span className={cx('text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full', d.role === 'Manager' ? 'bg-accent text-accent-fg' : 'bg-subtle text-muted')}>{d.role}</span></span>
                      <span className="block text-[11px] text-faint truncate">{d.sees}</span>
                    </span>
                    {busy === d.email ? <span className="h-4 w-4 rounded-full border-2 border-accent border-r-transparent animate-spin" /> : <ArrowRight size={15} className="text-faint" />}
                  </button>
                </li>
              ))}
            </ul>
            <details className="mt-4 group" open>
              <summary className="cursor-pointer text-xs font-medium text-muted hover:text-fg list-none">Or sign in with email and password ›</summary>
              <form onSubmit={(e) => { e.preventDefault(); signIn(email, password, 'form'); }} className="mt-3 space-y-3">
                <Field label="Email"><input className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@worklens.dev" required /></Field>
                <Field label="Password" hint="Demo password: demo1234"><input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
                <Button type="submit" variant="primary" className="w-full h-10" loading={busy === 'form'}>Sign in</Button>
              </form>
            </details>
            {error && <p className="mt-3 text-xs text-danger" role="alert">{error}</p>}
          </div>
        </section>

        {/* How to use */}
        <section id="how" className="py-10 border-t border-border scroll-mt-16">
          <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-accent">How to use WorkLens</p>
          <h2 className="font-display text-3xl font-semibold tracking-tight mt-2">Four steps, whichever side you’re on</h2>
          <div className="grid md:grid-cols-2 gap-5 mt-6">
            {([['For team members', 'member'], ['For managers', 'manager']] as const).map(([title, key]) => (
              <div key={key} className="card p-5">
                <h3 className="font-semibold">{title}</h3>
                <ol className="mt-4 space-y-4">
                  {STEPS[key].map(([Icon, t, d], i) => {
                    const I = Icon as React.ElementType;
                    return (
                      <li key={t} className="flex gap-3">
                        <span className="relative h-9 w-9 rounded-full bg-accent-soft flex items-center justify-center shrink-0"><I size={16} className="text-accent" /><span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-accent text-accent-fg text-[10px] font-bold flex items-center justify-center">{i + 1}</span></span>
                        <span><span className="block text-sm font-medium">{t}</span><span className="block text-xs text-muted mt-0.5 leading-relaxed">{d}</span></span>
                      </li>
                    );
                  })}
                </ol>
              </div>
            ))}
          </div>
          <p className="mt-4 text-xs text-faint">Inside the app: the dashboard shows a “How to use WorkLens” checklist, and “How to use” in the sidebar explains every page. Press Ctrl K anywhere to jump.</p>
        </section>

        {/* viaSocket */}
        <section id="viasocket" className="py-10 border-t border-border scroll-mt-16">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div>
              <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-accent">Powered by viaSocket</p>
              <h2 className="font-display text-3xl font-semibold tracking-tight mt-2">The connection layer behind WorkLens</h2>
              <p className="text-sm text-muted mt-2 max-w-2xl">viaSocket holds every sign-in, runs the AI and delivers every alert and email. WorkLens stores no Slack or Gmail passwords and has no AI model account of its own — that’s viaSocket’s job.</p>
            </div>
            <a href={VIASOCKET_URL} target="_blank" rel="noreferrer" className="no-underline"><Button variant="primary" icon={<ExternalLink size={14} />}>Visit viaSocket</Button></a>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
            {POWERED.map(([Icon, t, d]) => {
              const I = Icon as React.ElementType;
              return (
                <div key={t} className="card p-5">
                  <span className="h-10 w-10 rounded-xl bg-accent-soft flex items-center justify-center"><I size={18} className="text-accent" /></span>
                  <h3 className="font-semibold mt-3">{t}</h3>
                  <p className="text-xs text-muted mt-1 leading-relaxed">{d}</p>
                </div>
              );
            })}
          </div>
        </section>

        {/* Scores */}
        <section id="scores" className="py-10 border-t border-border scroll-mt-16">
          <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-accent">How you’re measured</p>
          <h2 className="font-display text-3xl font-semibold tracking-tight mt-2">Five scores, every one explained</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3 mt-6">
            {DIMS.map(([n, d]) => (
              <div key={n} className="card p-4"><p className="font-display font-semibold">{n}</p><p className="text-xs text-muted mt-1">{d}</p></div>
            ))}
          </div>
          <ul className="mt-5 grid sm:grid-cols-2 gap-2 text-sm text-muted">
            {['Hours worked never raise a score', 'Splitting work into tiny tasks gains nothing', 'Too little data shows “Not enough data”, never zero', 'No leaderboards — teams are shown alphabetically'].map((x) => (
              <li key={x} className="flex gap-2"><CheckCircle2 size={16} className="text-success shrink-0 mt-0.5" />{x}</li>
            ))}
          </ul>
          <a href="#signin" className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-accent no-underline hover:underline">Try it now <ArrowRight size={14} /></a>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 flex flex-col sm:flex-row gap-2 sm:items-center justify-between text-xs text-faint">
          <span>WorkLens — built for the <span className="text-fg font-medium">viaSocket</span> challenge “How can you and your work be measured?”</span>
          <a href={VIASOCKET_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-muted hover:text-fg no-underline">Powered by viaSocket <ExternalLink size={12} /></a>
        </div>
      </footer>
    </div>
  );
}
