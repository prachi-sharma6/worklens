// Settings → Integrations (manager). Real viaSocket connection status, Connect / Reconnect through viaSocket's
// popup, once-after-Connect choices (Slack channel, teammate map, report recipients), feature toggles, test sends
// and the outbox with manual Retry. The browser only ever holds the per-user embed token from our server.
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { connect, loadConnectScript } from 'viasocket-apps/browser';
import { BellRing, Bot, Mail, MessageSquare, PlugZap, RotateCcw, Send, Sparkles, Unplug } from 'lucide-react';
import { api, type ConnectApp, type ConnectInfo, type IntegrationEvent, type IntegrationStatus, type Settings, type User } from '@/api';
import { Badge, Button, Card, Field, Modal, Skeleton, Toggle, cx } from '@/components/ui';
import { errMsg, useToast } from '@/context';
import { dateKey, fmtDateTime, relTime, weekStartKey } from '@/lib/format';
import { emitDataChanged, useAsync } from '@/lib/hooks';

const ICONS = {
  slack: 'https://stuff.thingsofbrand.com/slack.com/images/img668216333e_slack.jpg',
  gmail: 'https://stuff.thingsofbrand.com/gmail.com/images/imge_idrA5FDGTH_1763454052978.svg',
  // From viaSocket's app page for M91 (https://viasocket.com/docs/m91.md).
  m91: 'https://play-lh.googleusercontent.com/QODTxSSZQOvzmE05wWrqVrXTXom_k-wRerP9wNQC5MOOJT01IL7DKh1aqmSAfpoyAF--iBqJpqrgs4YwVRwb4w=w240-h480-rw',
};
const APP_NAME: Record<ConnectApp, string> = { slack: 'Slack', gmail: 'Gmail', m91: 'M91' };
const STATUS_TONE = { queued: 'neutral', sent: 'success', failed: 'danger', skipped_not_connected: 'warning' } as const;
const EVENT_LABEL: Record<string, string> = {
  'task.created': 'AI task suggestions', 'task.completed': 'Completion → review alert', 'task.resubmitted': 'Resubmitted → Slack',
  'blocker.opened': 'Blocker alert (+AI)', 'blocker.resolved': 'Blocker resolved → thread', 'review.decided': 'Decision → employee',
  'intervention': 'Needs intervention', 'report.daily': 'Daily report', 'report.weekly': 'Weekly analysis', 'slack.test': 'Slack test', 'gmail.test': 'Gmail test',
  'm91.alert': 'M91 phone alert', 'm91.close': 'M91 alert closed', 'm91.test': 'M91 test alert',
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

  // One connect at a time per app: the button stays busy from the click until the popup answers and the save is
  // done, so a second click can't open a second popup. (The server also runs one save per user and app at a time.)
  const inFlight = useRef<Partial<Record<ConnectApp, boolean>>>({});
  const doConnect = async (app: ConnectApp, reconnect: boolean) => {
    if (!info) return toast(infoErr ?? 'Still loading — try again in a second', 'error');
    if (inFlight.current[app]) return;
    inFlight.current[app] = true; setBusy(app);
    const done = () => { inFlight.current[app] = false; setBusy((b) => (b === app ? null : b)); };
    const save = async (authId: string) => {
      inFlight.current[app] = true; setBusy(app); // also for a late success after "closed"
      toast(`Finishing the ${APP_NAME[app]} connection…`, 'info'); // building the flow takes a few seconds
      try {
        await api.integrations.connected(app, authId);
        toast(`${APP_NAME[app]} connected`);
        status.reload(); loadInfo();
        emitDataChanged(); // the page's app cards and the top-bar status refresh too
      } catch (e) { toast(errMsg(e), 'error'); } finally { done(); }
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
      done();
      // viaSocket only guesses "closed" while you're on the app's sign-in page; a success can still arrive later
      // (onLateSuccess → save). Not an error: say so, and the server makes a second save harmless.
      if (code === 'closed') toast(`If you finished signing in to ${APP_NAME[app]}, WorkLens will finish connecting by itself.`, 'info');
      else toast(errMsg(e), 'error');
    }
  };

  const by = (app: string) => status.data?.find((s) => s.app === app);
  return (
    <Card title={<span className="flex items-center gap-2"><span className="text-faint"><PlugZap size={15} /></span>Manage connections & automations</span>}
      subtitle="Connect or reconnect apps, choose where alerts and reports go, switch automations on or off, and see every run.">
      {status.loading && !status.data ? <Skeleton className="h-40" /> : (
        <div className="space-y-4">
          <AiCard s={by('ai')} />
          <AppCard app="slack" s={by('slack')} busy={busy === 'slack'} ready={!!info} onConnect={doConnect} onChanged={status.reload} />
          <AppCard app="gmail" s={by('gmail')} busy={busy === 'gmail'} ready={!!info} onConnect={doConnect} onChanged={status.reload} />
          <M91Card s={by('m91')} busy={busy === 'm91'} ready={!!info} onConnect={doConnect} onChanged={status.reload} />
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

function AppCard({ app, s, busy, ready, onConnect, onChanged }: { app: 'slack' | 'gmail'; s?: IntegrationStatus; busy: boolean; ready: boolean; onConnect: (a: ConnectApp, reconnect: boolean) => void; onChanged: () => void }) {
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

// ---------------------------------------------------------------- M91 phone alerts
/** The moments that ring, in plain words (server: integrations/m91.js). */
export const M91_MOMENTS: { kind: string; text: string; urgent: boolean; stops: string }[] = [
  { kind: 'critical_overdue', text: 'A critical task passes its deadline unfinished', urgent: true, stops: 'when it’s done, deleted or the deadline moves' },
  { kind: 'critical_blocked', text: 'A critical task gets blocked', urgent: true, stops: 'when the blocker is resolved' },
  { kind: 'blocker_stuck', text: 'Anyone has been blocked for more than 2 days', urgent: false, stops: 'when the blocker is resolved' },
  { kind: 'delivery_failing', text: 'Slack/Gmail alerts and reports keep failing to send', urgent: false, stops: 'when the next send works' },
];
export const M91_ONE_LINER = 'M91 rings your phone at full volume — even on silent or Do Not Disturb — until someone answers. WorkLens uses it only for work that can’t wait.';

function M91Card({ s, busy, ready, onConnect, onChanged }: { s?: IntegrationStatus; busy: boolean; ready: boolean; onConnect: (a: ConnectApp, reconnect: boolean) => void; onChanged: () => void }) {
  const toast = useToast();
  const c = s?.connection;
  const [confirm, setConfirm] = useState(false);
  const [channels, setChannels] = useState<{ id: string; name: string }[] | null>(null);
  const [loadingCh, setLoadingCh] = useState(false);
  const alerts = useAsync(() => (c ? api.integrations.m91Alerts() : Promise.resolve(null)), [c?.connected_at]);
  const channel = c?.settings.channel_name ?? null;
  const loadChannels = async () => {
    setLoadingCh(true);
    try { setChannels((await api.integrations.m91Channels()).channels); } catch (e) { toast(errMsg(e), 'error'); } finally { setLoadingCh(false); }
  };
  const pick = async (id: string) => {
    const ch = channels?.find((x) => x.id === id);
    if (!ch) return;
    try { await api.integrations.saveM91Channel(ch.id, ch.name); toast(`M91 will ring the “${ch.name}” channel`); setChannels(null); onChanged(); } catch (e) { toast(errMsg(e), 'error'); }
  };
  const test = async () => {
    try { await api.integrations.run('m91-test'); toast('Test alert queued — the outbox shows how many phones it reached', 'info'); } catch (e) { toast(errMsg(e), 'error'); }
  };
  const disconnect = async () => {
    try { await api.integrations.disconnect('m91'); toast('M91 disconnected'); setConfirm(false); onChanged(); } catch (e) { toast(errMsg(e), 'error'); }
  };
  const ringing = (alerts.data?.recent ?? []).filter((a) => a.status === 'open' && a.kind !== 'test');
  return (
    <div className="rounded-lg border border-border p-3.5">
      <div className="flex flex-wrap items-start gap-3">
        <img src={ICONS.m91} alt="" className="h-9 w-9 rounded-md object-contain bg-white border border-border p-0.5 shrink-0" />
        <div className="flex-1 min-w-[180px]">
          <div className="flex flex-wrap items-center gap-2"><p className="text-sm font-medium">M91 phone alerts</p><Badge tone="neutral">by MSG91</Badge><StatusBadge s={s} /></div>
          <p className="text-xs text-faint mt-0.5">
            {c ? <>Account: <span className="text-muted">{c.label ?? 'connected account'}</span> · since {fmtDateTime(c.connected_at)}{channel && <> · rings <span className="text-muted">“{channel}”</span></>}</> : M91_ONE_LINER}
          </p>
        </div>
        <div className="flex gap-2">
          {!c && <Button variant="primary" size="sm" loading={busy} disabled={!ready} onClick={() => onConnect('m91', false)} icon={<BellRing size={13} />}>Connect M91</Button>}
          {c && s?.expired && <Button variant="primary" size="sm" loading={busy} disabled={!ready} onClick={() => onConnect('m91', true)}>Reconnect</Button>}
          {c && s?.connected && channel && <Button size="sm" icon={<Send size={13} />} onClick={test}>Send test alert</Button>}
          {c && <Button size="sm" variant="ghost" icon={<Unplug size={13} />} onClick={() => setConfirm(true)}>Disconnect</Button>}
        </div>
      </div>

      <div className="mt-3 pt-3 border-t border-border grid gap-4 md:grid-cols-2">
        <div className="space-y-3">
          {!c ? (
            <div>
              <p className="label">Set up in three steps</p>
              <ol className="list-decimal pl-4 space-y-1 text-xs text-muted">
                <li>Install <b>M91</b> from the App Store or Google Play and sign in with your phone number.</li>
                <li>In M91, create a channel (e.g. “WorkLens on-call”) and add the people who should be woken.</li>
                <li>Click <b>Connect M91</b> above, then pick that channel here.</li>
              </ol>
            </div>
          ) : (
            <div>
              <p className="label">Channel to ring (chosen once)</p>
              {channels ? (
                <select className="input h-8 text-xs" defaultValue="" onChange={(e) => pick(e.target.value)} aria-label="M91 channel">
                  <option value="" disabled>{channels.length ? 'Choose a channel from your M91…' : 'No channels — create one in the M91 app first'}</option>
                  {channels.map((ch) => <option key={ch.id} value={ch.id}>{ch.name}</option>)}
                </select>
              ) : (
                <Button size="sm" loading={loadingCh} onClick={loadChannels}>{channel ? `Change channel (now “${channel}”)` : 'Choose a channel'}</Button>
              )}
              {!channel && <p className="text-[11px] text-warning mt-1">Pick a channel — nothing rings until you do.</p>}
            </div>
          )}
          <p className="text-[11px] text-faint leading-relaxed">
            Everyone in the channel must install M91 and accept the invite, or their phone stays silent even though the send succeeds.
            Every alert also stays visible in WorkLens and Slack — M91 is the wake-up call, not the only record.
          </p>
        </div>
        <div>
          <p className="label">You’ll be rung when…</p>
          <ul className="space-y-1.5 text-xs">
            {M91_MOMENTS.map((m) => (
              <li key={m.kind} className="flex items-start gap-2">
                <Badge tone={m.urgent ? 'danger' : 'warning'} className="shrink-0">{m.urgent ? 'Urgent' : 'Soon'}</Badge>
                <span className="text-muted">{m.text}<span className="block text-[11px] text-faint">Stops {m.stops}.</span></span>
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-faint mt-2">Urgent alerts phone you if nobody answers within a few minutes. Reviews waiting and daily reports never ring — they stay in Slack.</p>
        </div>
      </div>

      {c && (
        <div className="mt-3 pt-3 border-t border-border">
          <p className="label">Ringing now</p>
          {!alerts.data ? <Skeleton className="h-8" /> : ringing.length === 0 ? (
            <p className="text-xs text-faint">{alerts.data.holding_now.length ? `${alerts.data.holding_now.length} condition${alerts.data.holding_now.length === 1 ? '' : 's'} will ring on the next check.` : 'Nothing — all quiet.'}</p>
          ) : (
            <ul className="space-y-1 text-xs">
              {ringing.map((a) => (
                <li key={a.title + a.opened_at} className="flex flex-wrap items-center gap-2">
                  <Badge tone={a.severity === 'HIGH' ? 'danger' : 'warning'}>{a.severity === 'HIGH' ? 'Urgent' : 'Soon'}</Badge>
                  {a.path ? <Link className="text-accent hover:underline" to={a.path}>{a.title}</Link> : <span>{a.title}</span>}
                  {a.opened_at && <span className="text-faint">since {relTime(a.opened_at)}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <Modal open={confirm} onClose={() => setConfirm(false)} title="Disconnect M91?"
        footer={<><Button onClick={() => setConfirm(false)}>Cancel</Button><Button variant="danger" onClick={disconnect}>Disconnect</Button></>}>
        <p className="text-sm text-muted">WorkLens closes the alerts it still has open, pauses its M91 workflow and revokes the connection on viaSocket. Phones stop ringing for WorkLens until you connect again. Your M91 channels are not touched.</p>
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
  { key: 'm91_alerts', label: 'M91 phone alerts', hint: 'Only for work that can’t wait (see the M91 card). One viaSocket run per alert.' },
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
