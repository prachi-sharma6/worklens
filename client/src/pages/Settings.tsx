import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Bell, Database, Moon, Palette, PlugZap, RotateCcw, Scale, Sun, User as UserIcon, Users, Clock } from 'lucide-react';
import { api, type Dimension, type NotificationPrefs, type Settings } from '@/api';
import { Avatar, Badge, Button, Card, EmptyState, Field, Modal, Skeleton, Toggle, cx } from '@/components/ui';
import { errMsg, useAuth, useTheme, useToast } from '@/context';
import { DIM_LABEL, DIMS, fmtDateTime } from '@/lib/format';
import { useAsync } from '@/lib/hooks';

const TIMEZONES = ['Asia/Kolkata', 'UTC', 'Europe/London', 'Europe/Berlin', 'America/New_York', 'America/Los_Angeles', 'Asia/Singapore', 'Australia/Sydney'];

type Tab = 'profile' | 'notifications' | 'scoring' | 'team' | 'integrations' | 'demo';
const TABS: { key: Tab; label: string; icon: React.ElementType; manager?: boolean; employee?: boolean }[] = [
  { key: 'profile', label: 'Profile & look', icon: UserIcon },
  { key: 'notifications', label: 'Notifications', icon: Bell, employee: true },
  { key: 'scoring', label: 'Scoring & schedule', icon: Scale, manager: true },
  { key: 'team', label: 'Team', icon: Users, manager: true },
  { key: 'integrations', label: 'Integrations', icon: PlugZap, manager: true },
  { key: 'demo', label: 'Demo data', icon: Database, manager: true },
];

export default function SettingsPage() {
  const { user } = useAuth();
  const isManager = user?.role === 'manager';
  const [params, setParams] = useSearchParams();
  const tabs = TABS.filter((t) => (t.manager ? isManager : t.employee ? !isManager : true));
  const tab = (tabs.find((t) => t.key === params.get('tab'))?.key ?? 'profile') as Tab;
  return (
    <div className="space-y-4 max-w-4xl">
      <div>
        <h1 className="h-page">Settings</h1>
        <p className="text-xs text-muted mt-0.5">{isManager ? 'Your profile, team-wide scoring and schedule, team members and demo data.' : 'Your profile, appearance and notifications.'}</p>
      </div>
      <div className="overflow-x-auto scrollbar-thin -mx-1 px-1">
        <div role="tablist" aria-label="Settings sections" className="inline-flex gap-1 p-1 rounded-lg bg-subtle border border-border">
          {tabs.map(({ key, label, icon: Icon }) => (
            <button key={key} role="tab" aria-selected={tab === key} onClick={() => setParams(key === 'profile' ? {} : { tab: key }, { replace: true })}
              className={cx('inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-medium whitespace-nowrap transition', tab === key ? 'bg-surface text-fg shadow-sm' : 'text-muted hover:text-fg')}>
              <Icon size={14} />{label}
            </button>
          ))}
        </div>
      </div>
      {tab === 'profile' && <><ProfileSection /><AppearanceSection /></>}
      {tab === 'notifications' && <NotificationsSection />}
      {tab === 'scoring' && <><WeightsSection /><ScheduleSection /></>}
      {tab === 'team' && <TeamSection />}
      {tab === 'integrations' && <IntegrationsSection />}
      {tab === 'demo' && <DemoSection />}
    </div>
  );
}

const SectionTitle = ({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) => <span className="flex items-center gap-2"><span className="text-faint">{icon}</span>{children}</span>;

function ProfileSection() {
  const { user, refresh } = useAuth();
  const toast = useToast();
  const [f, setF] = useState({ name: user?.name ?? '', title: user?.title ?? '', timezone: user?.timezone ?? 'Asia/Kolkata' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const dirty = !!user && (f.name !== user.name || f.title !== user.title || f.timezone !== user.timezone);
  const save = async () => {
    setBusy(true); setErr(null);
    try { await api.settings.updateProfile(f); await refresh(); toast('Profile saved'); }
    catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  if (!user) return null;
  return (
    <Card title={<SectionTitle icon={<UserIcon size={15} />}>Profile</SectionTitle>}>
      <div className="flex items-center gap-3 mb-4"><Avatar name={f.name || user.name} color={user.avatar_color} size={40} /><div><p className="text-sm font-medium">{user.email}</p><p className="text-xs text-faint">{user.role === 'manager' ? 'Manager' : 'Employee'}</p></div></div>
      <div className="grid sm:grid-cols-3 gap-3">
        <Field label="Name" error={err}><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Title"><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <Field label="Timezone">
          <select className="input" value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })}>{[...new Set([f.timezone, ...TIMEZONES])].map((t) => <option key={t}>{t}</option>)}</select>
        </Field>
      </div>
      <div className="flex justify-end mt-4"><Button variant="primary" onClick={save} loading={busy} disabled={!dirty}>Save profile</Button></div>
    </Card>
  );
}

function AppearanceSection() {
  const { theme, set } = useTheme();
  return (
    <Card title={<SectionTitle icon={<Palette size={15} />}>Appearance</SectionTitle>}>
      <div className="grid grid-cols-2 gap-3 max-w-md">
        {(['light', 'dark'] as const).map((t) => (
          <button key={t} onClick={() => set(t)} className={cx('rounded-lg border p-3 text-left transition', theme === t ? 'border-accent ring-2 ring-accent/20' : 'border-border hover:bg-subtle')}>
            <div className={cx('h-14 rounded-md border mb-2 flex items-end p-1.5 gap-1', t === 'dark' ? 'bg-[#0B1020] border-[#262f42]' : 'bg-[#FAFAFB] border-[#e5e7eb]')}>
              <span className={cx('h-full w-1/4 rounded', t === 'dark' ? 'bg-[#111827]' : 'bg-white border border-[#e5e7eb]')} />
              <span className="h-2 w-8 rounded bg-[#6366F1]" />
            </div>
            <p className="text-xs font-medium flex items-center gap-1.5">{t === 'dark' ? <Moon size={12} /> : <Sun size={12} />}{t === 'dark' ? 'Dark' : 'Light'}</p>
          </button>
        ))}
      </div>
    </Card>
  );
}

function NotificationsSection() {
  const toast = useToast();
  const { data, setData, loading } = useAsync(() => api.settings.prefs(), []);
  const update = async (patch: Partial<NotificationPrefs>) => {
    if (!data) return;
    const next = { ...data, ...patch }; setData(next);
    try { await api.settings.updatePrefs(next); toast('Notification preferences saved'); } catch (e) { toast(errMsg(e), 'error'); }
  };
  const rows: { key: keyof NotificationPrefs; label: string; hint: string }[] = [
    { key: 'in_app', label: '“Needs your attention” on my dashboard', hint: 'Nudges for rejected or sent-back work, overdue tasks and completed tasks without evidence. Review decisions always show on the task and your timeline.' },
    { key: 'slack_dm', label: 'Slack DM when my work is reviewed', hint: 'Sent through your team’s Slack once your manager has linked your Slack user. Off by default.' },
  ];
  return (
    <Card title={<SectionTitle icon={<Bell size={15} />}>Notifications</SectionTitle>}>
      {loading || !data ? <Skeleton className="h-24" /> : (
        <ul className="divide-y divide-border -my-1">
          {rows.map((r) => (
            <li key={r.key} className="flex items-center gap-4 py-2.5">
              <div className="flex-1"><p className="text-sm font-medium">{r.label}</p><p className="text-xs text-faint">{r.hint}</p></div>
              <Toggle checked={data[r.key]} onChange={(v) => update({ [r.key]: v })} label={r.label} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function WeightsSection() {
  const toast = useToast();
  const { data, loading } = useAsync(() => api.settings.get(), []);
  const [w, setW] = useState<Record<Dimension, number> | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (data) setW({ ...data.score_weights }); }, [data]);
  if (loading || !w || !data) return <Card title={<SectionTitle icon={<Scale size={15} />}>Score weights</SectionTitle>}><Skeleton className="h-20" /></Card>;
  const total = DIMS.reduce((s, d) => s + (Number(w[d]) || 0), 0);
  const dirty = DIMS.some((d) => w[d] !== data.score_weights[d]);
  const save = async () => {
    setBusy(true); setErr(null);
    try { await api.settings.update({ score_weights: w }); toast('Weights saved — scores recalculated'); data.score_weights = { ...w }; }
    catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Card title={<SectionTitle icon={<Scale size={15} />}>Score weights</SectionTitle>} subtitle="How much each dimension counts toward the overall score. Must total 100%.">
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {DIMS.map((d) => (
          <Field key={d} label={DIM_LABEL[d]}>
            <div className="relative"><input type="number" min={0} max={100} className="input pr-7 tnum" value={w[d]} onChange={(e) => { setW({ ...w, [d]: Number(e.target.value) }); setErr(null); }} /><span className="absolute right-2.5 top-2 text-xs text-faint">%</span></div>
          </Field>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3 mt-4">
        <p className={cx('text-sm tnum font-medium', total === 100 ? 'text-success' : 'text-danger')}>Total: {total}%</p>
        {total !== 100 && <p className="text-xs text-danger">Adjust by {100 - total > 0 ? '+' : ''}{100 - total}% to save.</p>}
        {err && <p className="text-xs text-danger">{err}</p>}
        <div className="ml-auto flex gap-2">
          <Button onClick={() => setW({ productivity: 25, quality: 25, impact: 25, consistency: 15, ownership: 10 })}>Reset to defaults</Button>
          <Button variant="primary" onClick={save} loading={busy} disabled={total !== 100 || !dirty}>Save weights</Button>
        </div>
      </div>
    </Card>
  );
}

function ScheduleSection() {
  const toast = useToast();
  const { data, loading } = useAsync(() => api.settings.get(), []);
  const [f, setF] = useState<Pick<Settings, 'workday_end' | 'timezone'> | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (data) setF({ workday_end: data.workday_end, timezone: data.timezone }); }, [data]);
  const save = async () => {
    if (!f) return; setBusy(true);
    try { await api.settings.update(f); toast('Schedule saved'); } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
  };
  return (
    <Card title={<SectionTitle icon={<Clock size={15} />}>Workday & reports</SectionTitle>} subtitle="The daily report is built and sent at workday end (team timezone, weekdays); the weekly analysis on Friday 17:00.">
      {loading || !f ? <Skeleton className="h-16" /> : (
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Workday ends at"><input type="time" className="input w-36" value={f.workday_end} onChange={(e) => setF({ ...f, workday_end: e.target.value })} /></Field>
          <Field label="Team timezone">
            <select className="input w-52" value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })}>{[...new Set([f.timezone, ...TIMEZONES])].map((t) => <option key={t}>{t}</option>)}</select>
          </Field>
          <Button variant="primary" onClick={save} loading={busy}>Save</Button>
        </div>
      )}
    </Card>
  );
}

function TeamSection() {
  const { data, loading } = useAsync(() => api.users.team(), []);
  return (
    <Card title={<SectionTitle icon={<Users size={15} />}>Team members</SectionTitle>} bodyClass="px-0 pb-0">
      {loading || !data ? <div className="px-4 pb-4"><Skeleton className="h-24" /></div> : data.length === 0 ? <EmptyState title="No team members" /> : (
        <ul className="divide-y divide-border border-t border-border">
          {[...data].sort((a, b) => a.name.localeCompare(b.name)).map((u) => (
            <li key={u.id}>
              <Link to={`/people/${u.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-subtle">
                <Avatar name={u.name} color={u.avatar_color} size={28} />
                <div className="flex-1 min-w-0"><p className="text-[13px] font-medium">{u.name}</p><p className="text-[11px] text-faint truncate">{u.title} · {u.email}</p></div>
                <span className="text-xs text-accent">View profile</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function IntegrationsSection() {
  return (
    <Card title={<SectionTitle icon={<PlugZap size={15} />}>Integrations have their own page</SectionTitle>}>
      <p className="text-sm text-muted">Connect Slack and Gmail, choose the alert channel and recipients, switch automations on or off, and see every run — all in one place.</p>
      <Link to="/integrations" className="inline-block mt-3"><Button variant="primary" icon={<PlugZap size={14} />}>Open Integrations</Button></Link>
    </Card>
  );
}

function DemoSection() {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const reset = async () => {
    setBusy(true);
    try { await api.admin.resetDemo(); window.location.reload(); } catch (e) { toast(errMsg(e), 'error'); setBusy(false); }
  };
  return (
    <Card title={<SectionTitle icon={<Database size={15} />}>Demo data</SectionTitle>}>
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <p className="text-xs text-muted flex-1">Restore the seeded team (1 manager, 5 employees, ~3 weeks of history). Your changes in this browser will be lost.</p>
        <Button variant="danger" icon={<RotateCcw size={14} />} onClick={() => setOpen(true)}>Reset demo data</Button>
      </div>
      <Modal open={open} onClose={() => setOpen(false)} title="Reset demo data?"
        footer={<><Button onClick={() => setOpen(false)}>Cancel</Button><Button variant="danger" onClick={reset} loading={busy}>Reset</Button></>}>
        <p className="text-sm text-muted">All tasks, evidence, reviews and score adjustments made in this browser will be replaced with fresh seed data. This can’t be undone.</p>
      </Modal>
    </Card>
  );
}
