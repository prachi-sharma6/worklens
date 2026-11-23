import { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  BarChart3, CalendarDays, CalendarRange, ChevronsLeft, ChevronsRight, FileCheck2, LayoutDashboard, ListChecks, LogOut, Menu,
  Moon, Plus, Search, Settings, Sparkles, Sun, Users, Gauge, X, CircleUser,
} from 'lucide-react';
import { Avatar, Badge, Button, Popover, SlideOver, cx } from '@/components/ui';
import { TaskForm } from '@/components/TaskForm';
import { CommandPalette } from './CommandPalette';
import { EMPLOYEE_GROUPS, MANAGER_GROUPS, FOOTER_NAV, type NavItem } from './nav';
import { ConnectedAppsPill, IntegrationsProvider, PoweredByViasocket } from '@/components/IntegrationStatus';
import { markVisited } from '@/components/Onboarding';
import { useAuth, useTheme, useUI } from '@/context';
import { useMediaQuery } from '@/lib/hooks';
import { Info } from 'lucide-react';

export function AppShell() {
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const ui = useUI();
  const nav = useNavigate();
  const loc = useLocation();
  const isMobile = useMediaQuery('(max-width: 1023px)');
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem('wl-sidebar') === '1'; } catch { return false; } });
  const [drawer, setDrawer] = useState(false);
  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => { try { localStorage.setItem('wl-sidebar', collapsed ? '1' : '0'); } catch { /* ignore */ } }, [collapsed]);
  useEffect(() => { setDrawer(false); mainRef.current?.scrollTo(0, 0); markVisited(loc.pathname); }, [loc.pathname]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); ui.setPaletteOpen(true); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [ui]);

  const groups = useMemo(() => (user?.role === 'manager' ? MANAGER_GROUPS : EMPLOYEE_GROUPS), [user]);
  if (!user) return null;
  const narrow = collapsed && !isMobile;

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className={cx('flex items-center h-14 px-4 gap-2 border-b border-border', narrow && 'justify-center px-0')}>
        <div className="h-7 w-7 rounded-lg bg-[#0E1117] ring-1 ring-border flex items-center justify-center shrink-0"><div className="h-3.5 w-3.5 rounded-full border-[2.5px] border-[#5EEAD4]" /></div>
        {!narrow && <div className="min-w-0"><p className="font-semibold leading-tight">WorkLens</p><p className="text-[10px] text-faint leading-tight truncate">Powered by <span className="text-accent font-semibold">viaSocket</span></p></div>}
        {isMobile && <Button variant="ghost" size="icon" className="ml-auto" onClick={() => setDrawer(false)} aria-label="Close menu"><X size={16} /></Button>}
      </div>
      {user.role === 'employee' && (
        <div className={cx('px-3 pt-3', narrow && 'px-2')}>
          <Button variant="primary" className="w-full" onClick={ui.openComposer} icon={<Plus size={15} />} title="Add task">{!narrow && 'Add Task'}</Button>
        </div>
      )}
      <nav className={cx('flex-1 overflow-y-auto px-3 py-3 scrollbar-thin', narrow && 'px-2')} aria-label="Main">
        {groups.map((g) => (
          <div key={g.title} className="mb-3">
            {!narrow && <p className="px-2.5 mb-1 text-[10px] font-semibold uppercase tracking-wider text-faint">{g.title}</p>}
            <div className="space-y-0.5">{g.items.map((it) => <SideLink key={it.to} it={it} narrow={narrow} />)}</div>
          </div>
        ))}
        <div className="pt-3 mt-1 border-t border-border space-y-0.5">
          {FOOTER_NAV.map((it) => <SideLink key={it.to} it={it} narrow={narrow} />)}
        </div>
      </nav>
      <PoweredByViasocket narrow={narrow} />
      {!isMobile && (
        <button onClick={() => setCollapsed((c) => !c)} className="h-10 border-t border-border flex items-center justify-center gap-2 text-xs text-faint hover:text-fg" aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
          {collapsed ? <ChevronsRight size={15} /> : <><ChevronsLeft size={15} /> Collapse</>}
        </button>
      )}
    </div>
  );

  return (
    <IntegrationsProvider>
    <div className="flex h-full">
      {!isMobile && <aside className={cx('shrink-0 border-r border-border bg-surface transition-[width] duration-200', collapsed ? 'w-[60px]' : 'w-60')}>{sidebar}</aside>}
      {isMobile && drawer && (
        <div className="fixed inset-0 z-40">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDrawer(false)} />
          <aside className="absolute left-0 top-0 h-full w-64 bg-surface border-r border-border shadow-pop">{sidebar}</aside>
        </div>
      )}

      <div className="flex-1 min-w-0 flex flex-col">
        <header className="h-14 shrink-0 border-b border-border bg-surface/80 backdrop-blur flex items-center gap-2 px-4 lg:px-6">
          {isMobile && <Button variant="ghost" size="icon" onClick={() => setDrawer(true)} aria-label="Open menu"><Menu size={18} /></Button>}
          <button onClick={() => ui.setPaletteOpen(true)} className="flex items-center gap-2 h-8 px-2.5 rounded-md border border-border bg-bg text-faint text-xs hover:text-muted hover:border-faint/50 transition w-full max-w-xs">
            <Search size={14} /> <span className="flex-1 text-left">Search pages and tasks…</span>
            <kbd className="hidden sm:inline text-[10px] border border-border rounded px-1 py-0.5">Ctrl K</kbd>
          </button>
          <div className="ml-auto flex items-center gap-1.5">
            <ConnectedAppsPill />
            <Button variant="ghost" size="icon" onClick={toggle} aria-label="Toggle theme" title="Toggle theme">{theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}</Button>
            <Popover align="right" width="w-60" trigger={({ toggle: t }) => (
              <button onClick={t} className="flex items-center gap-2 rounded-md p-1 hover:bg-subtle" aria-label="User menu"><Avatar name={user.name} color={user.avatar_color} size={28} /></button>
            )}>
              <div className="pb-2 mb-2 border-b border-border">
                <p className="text-sm font-medium text-fg">{user.name}</p>
                <p className="text-faint">{user.email}</p>
                <Badge tone="accent" className="mt-1.5">{user.role === 'manager' ? 'Manager' : 'Employee'}</Badge>
              </div>
              {user.role === 'employee' && <MenuBtn icon={<CircleUser size={14} />} onClick={() => nav(`/people/${user.id}`)}>My profile & timeline</MenuBtn>}
              <MenuBtn icon={<Settings size={14} />} onClick={() => nav('/settings')}>Settings</MenuBtn>
              <MenuBtn icon={theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />} onClick={toggle}>{theme === 'dark' ? 'Light theme' : 'Dark theme'}</MenuBtn>
              <MenuBtn icon={<LogOut size={14} />} onClick={async () => { await logout(); nav('/login'); }}>Sign out</MenuBtn>
            </Popover>
          </div>
        </header>
        <main ref={mainRef} className="flex-1 overflow-y-auto scrollbar-thin">
          <div className="mx-auto max-w-[1280px] px-4 py-5 lg:px-6 lg:py-6">
            <PageGuide path={loc.pathname} role={user.role} />
            <Outlet />
          </div>
          <footer className="mx-auto max-w-[1280px] px-4 lg:px-6 pb-6">
            <div className="border-t border-border pt-4 flex flex-col sm:flex-row gap-2 sm:items-center justify-between text-[11px] text-faint">
              <span>WorkLens · <span className="text-muted">AI, Slack and Gmail</span> powered by <a href="https://viasocket.com" target="_blank" rel="noreferrer" className="text-accent font-semibold hover:underline">viaSocket</a> · built for the viaSocket challenge</span>
              <span className="flex gap-3"><NavLink to="/help" className="hover:text-fg">How to use</NavLink><NavLink to="/integrations" className="hover:text-fg">Connected apps</NavLink></span>
            </div>
          </footer>
        </main>
      </div>

      <SlideOver open={ui.composerOpen} onClose={ui.closeComposer} title="New task">
        <TaskForm defaultExpanded onCreated={(t) => { ui.closeComposer(); nav(`/tasks/${t.id}`); }} />
      </SlideOver>
      <CommandPalette />
    </div>
    </IntegrationsProvider>
  );
}

function MenuBtn({ icon, children, onClick }: { icon: React.ReactNode; children: React.ReactNode; onClick: () => void }) {
  return <button onClick={onClick} className="w-full flex items-center gap-2 h-8 px-2 rounded text-[13px] text-muted hover:bg-subtle hover:text-fg">{icon}{children}</button>;
}

function SideLink({ it, narrow }: { it: NavItem; narrow: boolean }) {
  const Icon = it.icon;
  return (
    <NavLink to={it.to} title={`${it.label} — ${it.hint}`}
      className={({ isActive }) => cx('flex items-center gap-2.5 h-8 rounded-md px-2.5 text-[13px] font-medium transition', narrow && 'justify-center px-0',
        isActive ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-subtle hover:text-fg')}>
      <Icon size={16} className="shrink-0" />{!narrow && it.label}
    </NavLink>
  );
}

/** One line under the top bar on every page: what this page is for, plus a link to the guide. */
const EXTRA_PAGES: { test: RegExp; label: string; hint: string }[] = [
  { test: /^\/tasks\/new$/, label: 'Create task', hint: 'Write the outcome you’re aiming for; viaSocket AI can suggest how to measure it' },
  { test: /^\/tasks\/\d+/, label: 'Task details', hint: 'Everything about one task: status, evidence, blockers, comments, review and its history' },
  { test: /^\/people\/\d+/, label: 'Profile', hint: 'One person’s work timeline, scores (with explanations), tasks, evidence and reviews' },
];
function PageGuide({ path, role }: { path: string; role: 'employee' | 'manager' }) {
  const all = [...(role === 'manager' ? MANAGER_GROUPS : EMPLOYEE_GROUPS).flatMap((g) => g.items), ...FOOTER_NAV];
  const extra = EXTRA_PAGES.find((p) => p.test.test(path));
  const item = extra ?? all.find((i) => path === i.to) ?? all.find((i) => path.startsWith(i.to + '/'));
  if (!item) return null;
  return (
    <p className="mb-4 flex items-start gap-1.5 text-xs text-faint">
      <Info size={13} className="mt-px shrink-0 text-accent" />
      <span><span className="text-muted font-medium">{item.label}:</span> {item.hint}. {path !== '/help' && <NavLink to="/help" className="text-accent hover:underline">How to use →</NavLink>}</span>
    </p>
  );
}
