// Dashboard guidance: a role-aware "How to use WorkLens" checklist (ticked from real data / pages visited)
// and the "Powered by viaSocket" card with live app status.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Circle, ExternalLink, GraduationCap, PlugZap, X } from 'lucide-react';
import { api } from '@/api';
import { Button, Card, cx } from '@/components/ui';
import { AppStatusRow, VIASOCKET_URL, useIntegrationStatus } from '@/components/IntegrationStatus';
import { useAuth } from '@/context';
import { useAsync } from '@/lib/hooks';

// ---- pages visited (for steps that are "go and look") ----
const VISITED = 'wl-visited';
export function markVisited(path: string) {
  try { const v = new Set<string>(JSON.parse(localStorage.getItem(VISITED) || '[]')); v.add(path); localStorage.setItem(VISITED, JSON.stringify([...v])); } catch { /* ignore */ }
}
const visited = (path: string) => { try { return (JSON.parse(localStorage.getItem(VISITED) || '[]') as string[]).includes(path); } catch { return false; } };

const HIDE = 'wl-guide-hidden';
export const guideHidden = () => { try { return localStorage.getItem(HIDE) === '1'; } catch { return false; } };
export const setGuideHidden = (v: boolean) => { try { v ? localStorage.setItem(HIDE, '1') : localStorage.removeItem(HIDE); } catch { /* ignore */ } };

interface Step { title: string; body: string; to: string; cta: string; done: boolean }

function useSteps(): Step[] | null {
  const { user } = useAuth();
  const { items } = useIntegrationStatus();
  const isManager = user?.role === 'manager';
  const tasks = useAsync(() => (isManager ? Promise.resolve([]) : api.tasks.list()), [isManager]);
  const evidence = useAsync(() => (isManager ? Promise.resolve([]) : api.evidence.list()), [isManager]);
  const mgr = useAsync(() => (isManager ? api.dashboard.manager() : Promise.resolve(null)), [isManager]);
  const slack = items?.find((s) => s.app === 'slack');
  const gmail = items?.find((s) => s.app === 'gmail');
  if (isManager) {
    if (!items || !mgr.data) return null;
    return [
      { title: 'Connect Slack and Gmail', body: 'One click each through viaSocket. Alerts go to Slack, reports to your inbox.', to: '/integrations', cta: 'Connect', done: !!(slack?.connected && gmail?.connected) },
      { title: 'Choose the alert channel', body: 'Pick the Slack channel for blocker, review and report alerts.', to: '/integrations#manage', cta: 'Choose', done: !!slack?.connection?.settings.channel_name },
      { title: 'Review work waiting for you', body: `Verify, ask to clarify or reject — with evidence in front of you.${mgr.data.pending_reviews ? ` ${mgr.data.pending_reviews} waiting.` : ''}`, to: '/manager', cta: 'Review', done: mgr.data.pending_reviews === 0 },
      { title: 'See how the team is doing', body: 'Score distributions and trends — explained, never ranked.', to: '/team', cta: 'Open', done: visited('/team') },
      { title: 'Share the team report', body: 'Daily and weekly reports, ready to copy, download or email.', to: '/reports/daily', cta: 'Open', done: visited('/reports/daily') || visited('/reports/weekly') },
    ];
  }
  if (!tasks.data || !evidence.data) return null;
  return [
    { title: 'Plan a task around an outcome', body: 'Say what will be true when it’s done — AI can suggest a measurable outcome.', to: '/tasks/new', cta: 'Add task', done: tasks.data.some((t) => !!t.expected_outcome) },
    { title: 'Keep its status current', body: 'Start it, and report a blocker early with who you’re waiting on.', to: '/tasks', cta: 'My tasks', done: tasks.data.some((t) => t.status !== 'not_started') },
    { title: 'Finish with evidence', body: 'A PR, doc, screenshot or test result — so your manager can verify it.', to: '/evidence', cta: 'Evidence', done: evidence.data.length > 0 },
    { title: 'See how you’re measured', body: 'Five scores, each with the formula and your real numbers.', to: '/performance', cta: 'Open', done: visited('/performance') },
    { title: 'Share your daily report', body: 'Built from your records — copy it as Markdown in one click.', to: '/reports/daily', cta: 'Open', done: visited('/reports/daily') },
  ];
}

export function GettingStarted() {
  const steps = useSteps();
  const [hidden, setHidden] = useState(guideHidden());
  if (hidden) return null;
  const done = steps?.filter((s) => s.done).length ?? 0;
  return (
    <Card className="lg:col-span-2"
      title={<span className="flex items-center gap-1.5"><GraduationCap size={15} className="text-accent" />How to use WorkLens</span>}
      subtitle={steps ? `${done} of ${steps.length} done · steps tick themselves off as you go` : 'Loading…'}
      action={<div className="flex items-center gap-1"><Link to="/help" className="text-xs text-accent hover:underline px-1">Full guide</Link><Button size="icon" variant="ghost" aria-label="Hide the guide" title="Hide (bring it back from How to use)" onClick={() => { setGuideHidden(true); setHidden(true); }}><X size={14} /></Button></div>}
      bodyClass="px-2 pb-2">
      {steps && <div className="mx-2 mb-2 h-1.5 rounded-full bg-subtle overflow-hidden"><div className="h-full bg-accent rounded-full bar-grow" style={{ width: `${(done / steps.length) * 100}%` }} /></div>}
      <ol className="divide-y divide-border">
        {(steps ?? []).map((s, i) => (
          <li key={s.title} className="flex items-center gap-3 px-2 py-2.5">
            {s.done ? <CheckCircle2 size={18} className="text-success shrink-0" /> : <span className="relative shrink-0"><Circle size={18} className="text-faint" /><span className="absolute inset-0 flex items-center justify-center text-[10px] font-semibold text-muted">{i + 1}</span></span>}
            <span className="flex-1 min-w-0">
              <span className={cx('block text-[13px] font-medium', s.done && 'text-muted')}>{s.title}</span>
              <span className="block text-[11px] text-faint">{s.body}</span>
            </span>
            <Link to={s.to} className={cx('shrink-0 text-xs font-medium hover:underline', s.done ? 'text-faint' : 'text-accent')}>{s.done ? 'Done' : `${s.cta} →`}</Link>
          </li>
        ))}
      </ol>
    </Card>
  );
}

export function ViasocketCard() {
  const { items } = useIntegrationStatus();
  const { user } = useAuth();
  return (
    <Card title={<span className="flex items-center gap-1.5"><PlugZap size={15} className="text-accent" />Powered by viaSocket</span>}
      subtitle="AI, Slack and Gmail — connected once, no keys in WorkLens"
      action={<a href={VIASOCKET_URL} target="_blank" rel="noreferrer" className="text-faint hover:text-accent" aria-label="viaSocket website"><ExternalLink size={14} /></a>}>
      <div className="space-y-3">{items ? items.map((s) => <AppStatusRow key={s.app} s={s} />) : <p className="text-xs text-faint">Checking…</p>}</div>
      <Link to="/integrations" className="mt-4 flex items-center justify-center h-8 rounded-md border border-border text-xs font-medium hover:bg-subtle">
        {user?.role === 'manager' ? 'Manage integrations' : 'What these do for you'} →
      </Link>
    </Card>
  );
}

/** Re-show the guide (Help page). */
export function ShowGuideButton() {
  const [hidden, setHidden] = useState(false);
  useEffect(() => setHidden(guideHidden()), []);
  if (!hidden) return null;
  return <Button size="sm" onClick={() => { setGuideHidden(false); setHidden(false); }}>Show the guide on my dashboard again</Button>;
}
