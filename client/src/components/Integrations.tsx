// Settings → Integrations (manager). Real viaSocket connection status, Connect / Reconnect through viaSocket's
// popup, once-after-Connect choices (Slack channel, teammate map, report recipients), feature toggles, test sends
// and the outbox with manual Retry. The browser only ever holds the per-user embed token from our server.
import { useEffect, useRef, useState } from 'react';
import { connect, loadConnectScript } from 'viasocket-apps/browser';
import { Bot, Mail, MessageSquare, PlugZap, RotateCcw, Send, Sparkles, Unplug } from 'lucide-react';
import { api, type ConnectInfo, type IntegrationEvent, type IntegrationStatus, type Settings, type User } from '@/api';
import { Badge, Button, Card, Field, Modal, Skeleton, Toggle, cx } from '@/components/ui';
import { errMsg, useToast } from '@/context';
import { dateKey, fmtDateTime, relTime, weekStartKey } from '@/lib/format';
import { useAsync } from '@/lib/hooks';

const ICONS = {
  slack: 'https://stuff.thingsofbrand.com/slack.com/images/img668216333e_slack.jpg',
  gmail: 'https://stuff.thingsofbrand.com/gmail.com/images/imge_idrA5FDGTH_1763454052978.svg',
};
const STATUS_TONE = { queued: 'neutral', sent: 'success', failed: 'danger', skipped_not_connected: 'warning' } as const;
const EVENT_LABEL: Record<string, string> = {
  'task.created': 'AI task suggestions', 'task.completed': 'Completion → review alert', 'task.resubmitted': 'Resubmitted → Slack',
  'blocker.opened': 'Blocker alert (+AI)', 'blocker.resolved': 'Blocker resolved → thread', 'review.decided': 'Decision → employee',
  'intervention': 'Needs intervention', 'report.daily': 'Daily report', 'report.weekly': 'Weekly analysis', 'slack.test': 'Slack test', 'gmail.test': 'Gmail test',
};

export function IntegrationsPanel() {
  const toast = useToast();
  const status = useAsync(() => api.integrations.status(), []);
  const [info, setInfo] = useState<ConnectInfo | null>(null);
  const [infoErr, setInfoErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Token on page load, not in the click: the popup must open straight from the click.
  const loadInfo = () => api.integrations.connectInfo().then((i) => { setInfo(i); setInfoErr(null); }).catch((e) => setInfoErr(errMsg(e)));
  const configured = !!status.data?.find((x) => x.app === 'ai')?.connected; // the server has viaSocket keys
  useEffect(() => {
    if (!configured) return;
    loadInfo(); loadConnectScript().catch(() => {});
    const t = setInterval(loadInfo, 45 * 60 * 1000); // refresh before the hour is up
    return () => clearInterval(t);
  }, [configured]);

  const doConnect = async (app: 'slack' | 'gmail', reconnect: boolean) => {
    if (!info) return toast(infoErr ?? 'Still loading — try again in a second', 'error');
    const save = async (authId: string) => {
      setBusy(app);
      try { await api.integrations.connected(app, authId); toast(`${app === 'slack' ? 'Slack' : 'Gmail'} connected`); status.reload(); loadInfo(); }
      catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(null); }
    };
    try {
      const { authId } = await connect({
        embedToken: info.token, serviceId: info.serviceIds[app], actions: info.actions[app], skipActionSelection: true,
        ...(reconnect && info.reconnect[app] ? { authId: info.reconnect[app] } : {}),
        onLateSuccess: ({ authId: late }) => save(late),
      });
      await save(authId);
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code !== 'closed') toast(errMsg(e), 'error');
    }
  };

  const by = (app: string) => status.data?.find((s) => s.app === app);
  return (
    <Card title={<span className="flex items-center gap-2"><span className="text-faint"><PlugZap size={15} /></span>Integrations · viaSocket</span>}
      subtitle="Slack alerts, Gmail reports and AI summaries run through viaSocket. Connect once; WorkLens fills every message from its own records.">
      {status.loading && !status.data ? <Skeleton className="h-40" /> : (
        <div className="space-y-4">
          <AiCard s={by('ai')} />
          <AppCard app="slack" s={by('slack')} busy={busy === 'slack'} ready={!!info} onConnect={doConnect} onChanged={status.reload} />
          <AppCard app="gmail" s={by('gmail')} busy={busy === 'gmail'} ready={!!info} onConnect={doConnect} onChanged={status.reload} />
          {!configured && <p className="text-xs text-warning">viaSocket isn’t configured on this server (keys missing in .env, or switched off), so Connect is unavailable and nothing is sent.</p>}
          {infoErr && <p className="text-xs text-danger">Couldn’t prepare the Connect button: {infoErr}</p>}
          <FeatureToggles />
          <Outbox />
        </div>
      )}
    </Card>
  );
}

function StatusBadge({ s }: { s?: IntegrationStatus }) {
  if (!s) return null;
  if (s.app === 'ai') return <Badge tone={s.connected ? 'success' : 'neutral'}>{s.connected ? 'Ready' : 'Not configured'}</Badge>;
  return <Badge tone={s.connected ? 'success' : s.expired ? 'warning' : 'neutral'}>{s.connected ? 'Connected' : s.expired ? 'Expired' : 'Not connected'}</Badge>;
}

function AiCard({ s }: { s?: IntegrationStatus }) {
  return (
    <div className="rounded-lg border border-border p-3.5 flex items-start gap-3">
      <span className="h-9 w-9 rounded-md bg-accent-soft text-accent flex items-center justify-center shrink-0"><Bot size={18} /></span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2"><p className="text-sm font-medium">viaSocket AI</p><StatusBadge s={s} /></div>
        <p className="text-xs text-faint mt-0.5">{s?.detail}. No model account needed. AI reads only WorkLens records and never changes scores.</p>
      </div>
    </div>
  );
}

function AppCard({ app, s, busy, ready, onConnect, onChanged }: { app: 'slack' | 'gmail'; s?: IntegrationStatus; busy: boolean; ready: boolean; onConnect: (a: 'slack' | 'gmail', reconnect: boolean) => void; onChanged: () => void }) {
  const toast = useToast();
  const c = s?.connection;
  const [confirm, setConfirm] = useState(false);
  const name = app === 'slack' ? 'Slack' : 'Gmail';
  const test = async () => {
    try { await api.integrations.run(app === 'slack' ? 'slack-test' : 'gmail-test'); toast(`Test queued — watch the outbox below`, 'info'); }
    catch (e) { toast(errMsg(e), 'error'); }
  };
  const disconnect = async () => {
    try { await api.integrations.disconnect(app); toast(`${name} disconnected`); setConfirm(false); onChanged(); } catch (e) { toast(errMsg(e), 'error'); }
  };
  return (
    <div className="rounded-lg border border-border p-3.5">
      <div className="flex flex-wrap items-start gap-3">
        <img src={ICONS[app]} alt="" className="h-9 w-9 rounded-md object-contain bg-white border border-border p-1 shrink-0" />
        <div className="flex-1 min-w-[180px]">
          <div className="flex items-center gap-2"><p className="text-sm font-medium">{name}</p><StatusBadge s={s} /></div>
          <p className="text-xs text-faint mt-0.5">
            {c ? <>Account: <span className="text-muted">{c.label ?? 'connected account'}</span> · since {fmtDateTime(c.connected_at)}</> : app === 'slack' ? 'Blocker, review, intervention and report alerts in one channel.' : 'Daily (workday end) and weekly (Friday 17:00) report emails.'}
          </p>
        </div>
        <div className="flex gap-2">
          {!c && <Button variant="primary" size="sm" loading={busy} disabled={!ready} onClick={() => onConnect(app, false)} icon={app === 'slack' ? <MessageSquare size={13} /> : <Mail size={13} />}>Connect {name}</Button>}
          {c && s?.expired && <Button variant="primary" size="sm" loading={busy} disabled={!ready} onClick={() => onConnect(app, true)}>Reconnect</Button>}
          {c && s?.connected && <Button size="sm" icon={<Send size={13} />} onClick={test}>Send test</Button>}
          {c && <Button size="sm" variant="ghost" icon={<Unplug size={13} />} onClick={() => setConfirm(true)}>Disconnect</Button>}
        </div>
      </div>
      {c && app === 'slack' && <SlackSetup channel={c.settings.channel_name ?? null} userMap={c.settings.user_map ?? {}} onSaved={onChanged} />}
      {c && app === 'gmail' && <GmailSetup recipients={c.settings.recipients ?? []} onSaved={onChanged} />}
      <Modal open={confirm} onClose={() => setConfirm(false)} title={`Disconnect ${name}?`}
        footer={<><Button onClick={() => setConfirm(false)}>Cancel</Button><Button variant="danger" onClick={disconnect}>Disconnect</Button></>}>
        <p className="text-sm text-muted">WorkLens pauses its {name} workflow and revokes the connection on viaSocket. Alerts/emails stop until you connect again. Nothing in {name} is deleted.</p>
      </Modal>
    </div>
  );
}

/** Searchable list of options from the user's own Slack (listOptions), with "load more". */
function SlackPicker({ field, value, onPick, placeholder }: { field: 'channel' | 'user'; value: string | null; onPick: (v: { value: string; label: string } | null) => void; placeholder: string }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [opts, setOpts] = useState<{ label: string; value: string }[]>([]);
  const [page, setPage] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const load = async (search: string, paginate: string | null) => {
    setLoading(true);
    try {
      const r = await api.integrations.slackOptions(field, search || undefined, paginate);
      setOpts((o) => (paginate ? [...o, ...r.options] : r.options)); setPage(r.paginate); setMore(r.hasMore); setMsg(r.message);
    } catch (e) { setMsg(errMsg(e)); } finally { setLoading(false); }
  };
  useEffect(() => { if (!open) return; const t = setTimeout(() => load(q, null), 300); return () => clearTimeout(t); }, [q, open]);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h);
  }, []);
  const shown = q ? opts.filter((o) => o.label.toLowerCase().includes(q.toLowerCase())) : opts; // fields that don't search server-side
  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen((o) => !o)} className="input h-8 text-xs text-left truncate">{value ?? <span className="text-faint">{placeholder}</span>}</button>
      {open && (
        <div className="absolute z-30 mt-1 w-full min-w-[240px] card shadow-pop p-2">
          <input autoFocus className="input h-8 text-xs mb-2" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
          <ul className="max-h-56 overflow-y-auto scrollbar-thin text-xs">
            {field === 'user' && value && <li><button className="w-full text-left px-2 py-1.5 rounded hover:bg-subtle text-danger" onClick={() => { onPick(null); setOpen(false); }}>Remove mapping</button></li>}
            {shown.map((o) => <li key={o.value}><button className="w-full text-left px-2 py-1.5 rounded hover:bg-subtle truncate" onClick={() => { onPick(o); setOpen(false); }}>{o.label}</button></li>)}
            {!loading && !shown.length && <li className="px-2 py-2 text-faint">{msg ?? 'Nothing found'}</li>}
            {loading && <li className="px-2 py-2 text-faint">Loading…</li>}
          </ul>
          {more && !loading && <Button size="sm" variant="ghost" className="w-full mt-1" onClick={() => load(q, page)}>Load more</Button>}
        </div>
      )}
    </div>
  );
}

function SlackSetup({ channel, userMap, onSaved }: { channel: string | null; userMap: Record<string, { id: string; label: string | null }>; onSaved: () => void }) {
  const toast = useToast();
  const team = useAsync(() => api.users.team(), []);
  const pickChannel = async (o: { value: string; label: string } | null) => {
    if (!o) return;
    try { await api.integrations.saveSlackChannel(o.value, o.label); toast(`Alerts will go to ${o.label}`); onSaved(); } catch (e) { toast(errMsg(e), 'error'); }
  };
  const map = async (u: User, o: { value: string; label: string } | null) => {
    try { await api.integrations.mapSlackUser(u.id, o?.value ?? null, o?.label ?? null); toast(o ? `${u.name} → ${o.label}` : `Removed ${u.name}’s Slack mapping`); onSaved(); } catch (e) { toast(errMsg(e), 'error'); }
  };
  return (
    <div className="mt-3 pt-3 border-t border-border grid gap-4 md:grid-cols-2">
      <div>
        <p className="label">Alert channel (chosen once)</p>
        <SlackPicker field="channel" value={channel} onPick={pickChannel} placeholder="Choose a channel from your Slack…" />
        {!channel && <p className="text-[11px] text-warning mt-1">Pick a channel — alerts are skipped until you do.</p>}
      </div>
      <div>
        <p className="label">Teammates’ Slack users (optional, for decision DMs)</p>
        <ul className="space-y-1.5">
          {(team.data ?? []).map((u) => (
            <li key={u.id} className="grid grid-cols-[110px_1fr] items-center gap-2 text-xs">
              <span className="truncate">{u.name}</span>
              <SlackPicker field="user" value={userMap[u.id]?.label ?? null} onPick={(o) => map(u, o)} placeholder="Not mapped — in-app only" />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function GmailSetup({ recipients, onSaved }: { recipients: string[]; onSaved: () => void }) {
  const toast = useToast();
  const [v, setV] = useState(recipients.join(', '));
  const [busy, setBusy] = useState(false);
  useEffect(() => setV(recipients.join(', ')), [recipients.join(',')]);
  const save = async () => {
    setBusy(true);
    try { await api.integrations.saveGmailRecipients(v.split(/[,\s]+/).filter(Boolean)); toast('Report recipients saved'); onSaved(); } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
  };
  return (
    <div className="mt-3 pt-3 border-t border-border flex flex-wrap items-end gap-2">
      <Field label="Report recipients (chosen once)" hint="Comma-separated. Emails are sent from the connected Gmail account." className="flex-1 min-w-[240px]">
        <input className="input h-8 text-xs" value={v} onChange={(e) => setV(e.target.value)} />
      </Field>
      <Button size="sm" onClick={save} loading={busy}>Save</Button>
    </div>
  );
}

const TOGGLES: { key: string; label: string; hint: string; ai?: boolean }[] = [
  { key: 'ai_enrichment', label: 'AI task suggestions', hint: 'One AI call per new task.', ai: true },
  { key: 'ai_blockers', label: 'AI reads unclear blockers', hint: 'One AI call per blocker without a named dependency.', ai: true },
  { key: 'ai_reports', label: 'AI report summaries', hint: 'One AI call per daily report and per weekly analysis (whole team).', ai: true },
  { key: 'slack_alerts', label: 'Slack alerts', hint: 'Blockers, reviews, interventions, report digests.' },
  { key: 'email_reports', label: 'Report emails', hint: 'Daily and weekly, via Gmail.' },
  { key: 'employee_dms', label: 'Decision DMs to employees', hint: 'Only for teammates mapped to a Slack user.' },
];
function FeatureToggles() {
  const toast = useToast();
  const { data, setData } = useAsync(() => api.settings.get(), []);
  const set = async (k: string, v: boolean) => {
    if (!data) return;
    const features = { ...data.features, [k]: v };
    setData({ ...data, features } as Settings);
    try { await api.settings.update({ features }); } catch (e) { toast(errMsg(e), 'error'); }
  };
  if (!data) return <Skeleton className="h-24" />;
  return (
    <div className="rounded-lg border border-border p-3.5">
      <p className="text-sm font-medium mb-2 flex items-center gap-1.5"><Sparkles size={14} className="text-accent" />What runs automatically</p>
      <ul className="grid sm:grid-cols-2 gap-x-6 gap-y-2.5">
        {TOGGLES.map((t) => (
          <li key={t.key} className="flex items-start justify-between gap-3">
            <span><span className="text-[13px]">{t.label}</span>{t.ai && <Badge tone="accent" className="ml-1.5">uses AI credits</Badge>}<span className="block text-[11px] text-faint">{t.hint}</span></span>
            <Toggle checked={!!data.features?.[t.key]} onChange={(v) => set(t.key, v)} label={t.label} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function summarise(e: IntegrationEvent) {
  if (e.last_error) return e.last_error;
  const r = e.result_json as Record<string, unknown> | null;
  if (!r) return '';
  return Object.entries(r).filter(([, v]) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean').map(([k, v]) => `${k}: ${v}`).join(' · ');
}
function Outbox() {
  const toast = useToast();
  const events = useAsync(() => api.integrations.events(), []);
  useEffect(() => { const t = setInterval(events.reload, 5000); return () => clearInterval(t); }, []);
  const retry = async (id: number) => { try { await api.integrations.retry(id); toast('Queued again', 'info'); events.reload(); } catch (e) { toast(errMsg(e), 'error'); } };
  const [day, setDay] = useState(dateKey());
  const run = async (what: 'daily' | 'weekly') => { try { await api.integrations.run(what, day); toast(`${what === 'daily' ? 'Daily report' : 'Weekly analysis'} for ${what === 'daily' ? day : 'the week of ' + weekStartKey(day + 'T00:00:00')} queued`, 'info'); events.reload(); } catch (e) { toast(errMsg(e), 'error'); } };
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <p className="text-sm font-medium">Outbox · last 20 events</p>
        <div className="flex gap-1.5">
          <input type="date" aria-label="Report date" className="input h-7 w-[140px] text-xs" value={day} max={dateKey()} onChange={(e) => e.target.value && setDay(e.target.value)} />
          <Button size="sm" onClick={() => run('daily')}>Send daily report now</Button>
          <Button size="sm" onClick={() => run('weekly')}>Send weekly analysis now</Button>
          <Button size="sm" variant="ghost" icon={<RotateCcw size={12} />} onClick={events.reload}>Refresh</Button>
        </div>
      </div>
      <p className="text-xs text-faint mb-2">Every automation is written here first, then run once by the worker. Failed sends are never retried automatically — use Retry.</p>
      {!events.data ? <Skeleton className="h-20" /> : events.data.length === 0 ? (
        <div className="rounded-md border border-dashed border-border py-6 text-center text-xs text-faint">No events yet.</div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-[13px] min-w-[640px]">
            <thead><tr className="text-left text-[11px] text-faint bg-subtle/50 border-b border-border"><th className="font-medium px-3 py-2">Workflow</th><th className="font-medium px-3 py-2">Status</th><th className="font-medium px-3 py-2">Result</th><th className="font-medium px-3 py-2 text-right">When</th><th className="px-3 py-2" /></tr></thead>
            <tbody>
              {events.data.map((e) => (
                <tr key={e.id} className="border-b border-border last:border-0 align-top">
                  <td className="px-3 py-2 whitespace-nowrap">{EVENT_LABEL[e.event_type] ?? e.event_type}</td>
                  <td className="px-3 py-2"><Badge tone={STATUS_TONE[e.status]}>{e.status.replace(/_/g, ' ')}</Badge></td>
                  <td className={cx('px-3 py-2 text-xs max-w-[340px]', e.status === 'failed' ? 'text-danger' : 'text-muted')}><span className="line-clamp-2" title={summarise(e)}>{summarise(e) || '—'}</span></td>
                  <td className="px-3 py-2 text-right text-xs text-muted whitespace-nowrap" title={fmtDateTime(e.created_at)}>{relTime(e.created_at)}</td>
                  <td className="px-3 py-2 text-right">{e.status === 'failed' && <Button size="sm" onClick={() => retry(e.id)}>Retry</Button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
