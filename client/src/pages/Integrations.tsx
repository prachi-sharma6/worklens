import { Link } from 'react-router-dom';
import { ArrowRight, CheckCircle2, CircleDashed, ExternalLink, PlugZap, Sparkles, Workflow } from 'lucide-react';
import { api, type IntegrationEvent, type IntegrationStatus } from '@/api';
import { Badge, Card, Skeleton, Toggle, cx } from '@/components/ui';
import { IntegrationsPanel } from '@/components/Integrations';
import { AppLogo, AppStatusRow, VIASOCKET_URL, stateOf, useIntegrationStatus } from '@/components/IntegrationStatus';
import { errMsg, useAuth, useToast } from '@/context';
import { relTime } from '@/lib/format';
import { useAsync } from '@/lib/hooks';

type App = 'ai' | 'slack' | 'gmail';
const APP_WHAT: Record<App, { title: string; does: string[] }> = {
  ai: { title: 'viaSocket AI', does: ['Suggests a measurable outcome and impact for new tasks', 'Reads unclear blockers to name who you’re waiting on', 'Writes daily and weekly report summaries from your records'] },
  slack: { title: 'Slack', does: ['Alerts the manager about blockers, work ready for review, and items needing attention', 'Posts the daily and weekly team digest', 'Can DM teammates when their work is reviewed (opt-in)'] },
  gmail: { title: 'Gmail', does: ['Emails the daily team report at workday end', 'Emails the weekly analysis on Fridays', 'Sends from the manager’s own Gmail account'] },
};

interface Automation { name: string; when: string; apps: App[]; features: string[]; events: string[] }
const AUTOMATIONS: Automation[] = [
  { name: 'Smart task suggestions', when: 'An employee creates a task', apps: ['ai'], features: ['ai_enrichment'], events: ['task.created'] },
  { name: 'Ready-for-review alert', when: 'A task is completed with evidence', apps: ['slack'], features: ['slack_alerts'], events: ['task.completed', 'task.resubmitted'] },
  { name: 'Blocker alert + thread update', when: 'A blocker is reported, then resolved', apps: ['slack', 'ai'], features: ['slack_alerts'], events: ['blocker.opened', 'blocker.resolved'] },
  { name: 'Daily team report', when: 'Weekdays at workday end', apps: ['ai', 'slack', 'gmail'], features: ['ai_reports', 'slack_alerts', 'email_reports'], events: ['report.daily'] },
  { name: 'Weekly analysis', when: 'Fridays at 17:00', apps: ['ai', 'slack', 'gmail'], features: ['ai_reports', 'slack_alerts', 'email_reports'], events: ['report.weekly'] },
  { name: 'Needs-attention alerts', when: 'Reviews > 24 h, blockers > 48 h, overdue critical work', apps: ['slack'], features: ['slack_alerts'], events: ['intervention'] },
  { name: 'Review decision DM', when: 'A manager verifies, rejects or asks to clarify', apps: ['slack'], features: ['employee_dms'], events: ['review.decided'] },
];

export default function IntegrationsPage() {
  const { user } = useAuth();
  const { items } = useIntegrationStatus();
  const isManager = user?.role === 'manager';
  const settings = useAsync(() => api.settings.get(), []);
  const events = useAsync<IntegrationEvent[]>(() => (isManager ? api.integrations.events() : Promise.resolve([])), [isManager]);
  const by = (a: App) => items?.find((x) => x.app === a);
  const connected = items?.filter((s) => s.connected).length ?? 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h1 className="h-page flex items-center gap-2"><PlugZap size={20} className="text-accent" />Integrations</h1>
          <p className="text-sm text-muted mt-0.5">What WorkLens is connected to, what each connection does, and every automation that uses it.</p>
        </div>
        <Badge tone={connected === 3 ? 'success' : connected ? 'warning' : 'neutral'} className="h-7 px-2.5 text-xs self-start sm:self-auto">{items ? `${connected} of 3 apps connected` : 'Checking…'}</Badge>
      </div>

      <ViasocketHero />

      <div className="grid gap-3 md:grid-cols-3">
        {(['ai', 'slack', 'gmail'] as const).map((a) => <AppCard key={a} app={a} s={by(a)} isManager={isManager} />)}
      </div>

      <Card title={<span className="flex items-center gap-1.5"><Workflow size={15} className="text-accent" />Automations</span>}
        subtitle="Everything that runs by itself. Each one shows which apps it needs and whether it’s switched on." bodyClass="px-0 pb-1 overflow-x-auto">
        <table className="w-full text-[13px] min-w-[680px]">
          <thead><tr className="text-left text-[11px] text-faint border-b border-border"><th className="font-medium px-4 py-2">Automation</th><th className="font-medium px-2">Runs when</th><th className="font-medium px-2">Uses</th><th className="font-medium px-2">Status</th>{isManager && <th className="font-medium px-4 text-right">Last run</th>}</tr></thead>
          <tbody>
            {AUTOMATIONS.map((au) => {
              const on = settings.data ? au.features.some((f) => settings.data!.features?.[f]) : null;
              const appsReady = au.apps.every((a) => by(a)?.connected);
              const last = events.data?.find((e) => au.events.includes(e.event_type));
              return (
                <tr key={au.name} className="border-b border-border last:border-0">
                  <td className="px-4 py-2.5 font-medium">{au.name}</td>
                  <td className="px-2 text-muted">{au.when}</td>
                  <td className="px-2"><span className="flex items-center gap-1">{au.apps.map((a) => <span key={a} title={APP_WHAT[a].title} className={cx(!by(a)?.connected && 'opacity-40 grayscale')}><AppLogo app={a} size={18} /></span>)}</span></td>
                  <td className="px-2">{on === null ? '…' : !on ? <Badge>Off</Badge> : appsReady ? <Badge tone="success" icon={<CheckCircle2 size={10} />}>Active</Badge> : <Badge tone="warning" icon={<CircleDashed size={10} />}>Waiting for {au.apps.filter((a) => !by(a)?.connected).map((a) => APP_WHAT[a].title).join(' + ')}</Badge>}</td>
                  {isManager && <td className="px-4 text-right text-xs text-faint whitespace-nowrap">{last ? <span title={last.status}>{relTime(last.created_at)} · <span className={last.status === 'sent' ? 'text-success' : last.status === 'failed' ? 'text-danger' : ''}>{last.status.replace(/_/g, ' ')}</span></span> : 'Not yet'}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="px-4 pt-2 pb-2 text-[11px] text-faint">{isManager ? 'Switch automations on or off, connect apps and see every run below.' : 'Your manager connects the apps and switches automations on or off.'}</p>
      </Card>

      {isManager ? <div id="manage"><IntegrationsPanel /></div> : <EmployeeSlackOptIn slack={by('slack')} />}
    </div>
  );
}

function ViasocketHero() {
  return (
    <div className="card overflow-hidden">
      <div className="grid md:grid-cols-[1fr_auto] gap-4 p-5 bg-accent-soft/40">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-accent flex items-center gap-1.5"><Sparkles size={12} />Powered by viaSocket</p>
          <h2 className="text-lg font-semibold mt-1 tracking-tight">One connection layer for AI and 2,300+ apps</h2>
          <p className="text-sm text-muted mt-1 max-w-2xl">WorkLens doesn’t store a single Slack or Gmail password and has no AI model account of its own. viaSocket holds the sign-ins, runs the AI, and delivers every alert and email — so WorkLens can focus on measuring real work.</p>
          <ul className="mt-3 grid sm:grid-cols-3 gap-2 text-xs text-muted">
            <li className="flex gap-1.5"><CheckCircle2 size={14} className="text-success shrink-0" />Connect an app in one click — no API keys</li>
            <li className="flex gap-1.5"><CheckCircle2 size={14} className="text-success shrink-0" />AI that reads only your records</li>
            <li className="flex gap-1.5"><CheckCircle2 size={14} className="text-success shrink-0" />Every run logged; nothing sent twice</li>
          </ul>
        </div>
        <a href={VIASOCKET_URL} target="_blank" rel="noreferrer" className="self-start md:self-center inline-flex items-center gap-1.5 h-9 px-3.5 rounded-md bg-accent text-accent-fg text-sm font-medium hover:bg-accent/90 whitespace-nowrap">
          Explore viaSocket <ExternalLink size={14} />
        </a>
      </div>
    </div>
  );
}

function AppCard({ app, s, isManager }: { app: App; s?: IntegrationStatus; isManager: boolean }) {
  const st = stateOf(s);
  return (
    <div className={cx('card p-4 flex flex-col border-t-2', st === 'connected' ? 'border-t-success' : st === 'expired' ? 'border-t-warning' : 'border-t-border')}>
      {s ? <AppStatusRow s={s} /> : <Skeleton className="h-9" />}
      <p className="text-[11px] font-semibold uppercase tracking-wider text-faint mt-4 mb-1.5">What it does here</p>
      <ul className="space-y-1.5 text-xs text-muted flex-1">{APP_WHAT[app].does.map((d) => <li key={d} className="flex gap-1.5"><ArrowRight size={12} className="mt-0.5 shrink-0 text-faint" />{d}</li>)}</ul>
      {app !== 'ai' && st !== 'connected' && (
        isManager
          ? <a href="#manage" className="mt-3 text-xs font-medium text-accent hover:underline">{st === 'expired' ? 'Reconnect below →' : `Connect ${APP_WHAT[app].title} below →`}</a>
          : <p className="mt-3 text-xs text-faint">Ask your manager to connect {APP_WHAT[app].title}.</p>
      )}
    </div>
  );
}

function EmployeeSlackOptIn({ slack }: { slack?: IntegrationStatus }) {
  const toast = useToast();
  const prefs = useAsync(() => api.settings.prefs(), []);
  const set = async (v: boolean) => {
    if (!prefs.data) return;
    const next = { ...prefs.data, slack_dm: v }; prefs.setData(next);
    try { await api.settings.updatePrefs(next); toast(v ? 'You’ll get a Slack DM when your work is reviewed' : 'Slack DMs turned off'); } catch (e) { toast(errMsg(e), 'error'); }
  };
  return (
    <Card title="Your choices">
      <div className="flex items-center gap-4">
        <div className="flex-1">
          <p className="text-sm font-medium">Slack DM when my work is reviewed</p>
          <p className="text-xs text-faint">{slack?.connected ? 'Your manager also needs to link your Slack user once in their Integrations page.' : 'Works once your manager connects Slack.'}</p>
        </div>
        {prefs.data ? <Toggle checked={prefs.data.slack_dm} onChange={set} label="Slack DM when my work is reviewed" /> : <Skeleton className="h-5 w-9" />}
      </div>
      <p className="text-xs text-faint mt-3">More preferences in <Link to="/settings" className="text-accent hover:underline">Settings</Link>.</p>
    </Card>
  );
}
