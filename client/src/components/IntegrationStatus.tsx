// Live status of what's connected (viaSocket AI, Slack, Gmail), shared by the top bar, sidebar, dashboards and pages.
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Bot, ExternalLink, PlugZap } from 'lucide-react';
import { api, type IntegrationStatus } from '@/api';
import { Popover, cx } from '@/components/ui';
import { useDataChanged } from '@/lib/hooks';
import { useAuth } from '@/context';

export const APP_ICONS = {
  slack: 'https://stuff.thingsofbrand.com/slack.com/images/img668216333e_slack.jpg',
  gmail: 'https://stuff.thingsofbrand.com/gmail.com/images/imge_idrA5FDGTH_1763454052978.svg',
};
export const VIASOCKET_URL = 'https://viasocket.com';

interface Ctx { items: IntegrationStatus[] | null; reload: () => void }
const IntegrationsContext = createContext<Ctx>({ items: null, reload: () => {} });

export function IntegrationsProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<IntegrationStatus[] | null>(null);
  const reload = useCallback(() => { api.integrations.status().then(setItems).catch(() => {}); }, []);
  useEffect(() => { reload(); const t = setInterval(reload, 60_000); return () => clearInterval(t); }, [reload]);
  useDataChanged(reload);
  return <IntegrationsContext.Provider value={{ items, reload }}>{children}</IntegrationsContext.Provider>;
}
export const useIntegrationStatus = () => useContext(IntegrationsContext);

export type AppState = 'connected' | 'expired' | 'off' | 'loading';
export function stateOf(s?: IntegrationStatus): AppState {
  if (!s) return 'loading';
  return s.connected ? 'connected' : s.expired ? 'expired' : 'off';
}
export const STATE_LABEL: Record<AppState, string> = { connected: 'Connected', expired: 'Needs reconnect', off: 'Not connected', loading: 'Checking…' };
const DOT: Record<AppState, string> = { connected: 'bg-success', expired: 'bg-warning', off: 'bg-faint/60', loading: 'bg-border' };

export function AppLogo({ app, size = 18 }: { app: 'ai' | 'slack' | 'gmail'; size?: number }) {
  if (app === 'ai') return <span className="inline-flex items-center justify-center rounded bg-accent-soft text-accent shrink-0" style={{ width: size, height: size }}><Bot size={size * 0.7} /></span>;
  return <img src={APP_ICONS[app]} alt="" className="rounded bg-white object-contain shrink-0" style={{ width: size, height: size, padding: size > 20 ? 3 : 1 }} />;
}
export function StateDot({ state, className }: { state: AppState; className?: string }) {
  return <span className={cx('inline-block h-2 w-2 rounded-full ring-2 ring-surface', DOT[state], className)} aria-hidden />;
}
const NAMES = { ai: 'viaSocket AI', slack: 'Slack', gmail: 'Gmail' } as const;

/** One line per app: logo, name, state, and the detail (account / channel) when the viewer may see it. */
export function AppStatusRow({ s, compact }: { s: IntegrationStatus; compact?: boolean }) {
  const st = stateOf(s);
  const c = s.connection;
  const detail = s.app === 'ai'
    ? (s.connected ? 'AI summaries and suggestions — no account needed' : 'viaSocket keys missing on the server')
    : c
      ? [c.label && `Account: ${c.label}`, s.app === 'slack' && (c.settings.channel_name ? `Channel: #${c.settings.channel_name.replace(/^#/, '')}` : 'No channel chosen yet'), s.app === 'gmail' && c.settings.recipients?.length && `Reports to: ${c.settings.recipients.join(', ')}`].filter(Boolean).join(' · ')
      : s.detail;
  return (
    <div className="flex items-center gap-2.5 min-w-0">
      <span className="relative"><AppLogo app={s.app} size={compact ? 20 : 26} /><StateDot state={st} className="absolute -right-0.5 -bottom-0.5" /></span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-[13px] font-medium text-fg">{NAMES[s.app]}<span className={cx('text-[11px] font-normal', st === 'connected' ? 'text-success' : st === 'expired' ? 'text-warning' : 'text-faint')}>{STATE_LABEL[st]}</span></span>
        {!compact && <span className="block text-[11px] text-faint truncate" title={detail}>{detail}</span>}
      </span>
    </div>
  );
}

/** Top bar: logos with live dots; opens a small panel with the details and a link to Integrations. */
export function ConnectedAppsPill() {
  const { items } = useIntegrationStatus();
  const { user } = useAuth();
  const apps = (['ai', 'slack', 'gmail'] as const).map((a) => items?.find((x) => x.app === a));
  const n = apps.filter((s) => s?.connected).length;
  return (
    <Popover align="right" width="w-80" trigger={({ toggle }) => (
      <button onClick={toggle} aria-label={`Connected apps: ${n} of 3 connected`} title="Connected apps"
        className="flex items-center gap-2 h-8 pl-2 pr-2.5 rounded-md border border-border bg-surface hover:bg-subtle transition">
        <span className="flex -space-x-1">{apps.map((s, i) => <span key={i} className="relative"><AppLogo app={(['ai', 'slack', 'gmail'] as const)[i]} size={18} /><StateDot state={stateOf(s)} className="absolute -right-0.5 -bottom-0.5 h-1.5 w-1.5" /></span>)}</span>
        <span className="hidden md:inline text-xs text-muted">{items ? `${n}/3 connected` : 'Apps'}</span>
      </button>
    )}>
      <p className="text-sm font-semibold text-fg">Connected apps</p>
      <p className="text-[11px] text-faint mb-3">Through viaSocket — connected once by {user?.role === 'manager' ? 'you' : 'your manager'}.</p>
      <div className="space-y-3">{items ? items.map((s) => <AppStatusRow key={s.app} s={s} />) : <p className="text-faint">Checking…</p>}</div>
      <Link to="/integrations" className="mt-3 pt-3 border-t border-border flex items-center justify-between text-xs font-medium text-accent hover:underline">
        <span className="flex items-center gap-1.5"><PlugZap size={13} />{user?.role === 'manager' ? 'Manage integrations' : 'What these do for you'}</span><span>→</span>
      </Link>
    </Popover>
  );
}

/** Sidebar footer badge. */
export function PoweredByViasocket({ narrow }: { narrow?: boolean }) {
  const { items } = useIntegrationStatus();
  const n = items?.filter((s) => s.connected).length ?? 0;
  if (narrow) return <Link to="/integrations" title={`Powered by viaSocket · ${n}/3 connected`} className="mx-auto my-2 flex h-8 w-8 items-center justify-center rounded-md bg-accent-soft text-accent"><PlugZap size={15} /></Link>;
  return (
    <div className="mx-3 mb-3 rounded-lg border border-border bg-subtle/60 p-3">
      <a href={VIASOCKET_URL} target="_blank" rel="noreferrer" className="flex items-center justify-between text-[11px] text-faint hover:text-fg">
        <span>Powered by <span className="font-semibold text-fg">viaSocket</span></span><ExternalLink size={11} />
      </a>
      <Link to="/integrations" className="mt-2 flex items-center gap-2">
        <span className="flex -space-x-1">{(['ai', 'slack', 'gmail'] as const).map((a) => <span key={a} className="relative"><AppLogo app={a} size={18} /><StateDot state={stateOf(items?.find((x) => x.app === a))} className="absolute -right-0.5 -bottom-0.5 h-1.5 w-1.5" /></span>)}</span>
        <span className="text-xs text-muted">{items ? `${n} of 3 connected` : 'Checking…'}</span>
      </Link>
    </div>
  );
}
