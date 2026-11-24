import { BarChart3, CalendarDays, CalendarRange, FileCheck2, Gauge, HelpCircle, LayoutDashboard, ListChecks, PlugZap, Settings, Sparkles, Users } from 'lucide-react';

export interface NavItem { to: string; label: string; icon: React.ElementType; hint: string }
export interface NavGroup { title: string; items: NavItem[] }

const INTEGRATIONS: NavItem = { to: '/integrations', label: 'Integrations', icon: PlugZap, hint: 'Which apps are connected (viaSocket AI, Slack, Gmail, M91 phone alerts) and what they do' };
const HELP: NavItem = { to: '/help', label: 'How to use', icon: HelpCircle, hint: 'A guide to every page, score and automation' };
const SETTINGS: NavItem = { to: '/settings', label: 'Settings', icon: Settings, hint: 'Profile, theme, notifications' };

export const EMPLOYEE_GROUPS: NavGroup[] = [
  { title: 'My work', items: [
    { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, hint: 'Today’s plan, what needs you, and your week' },
    { to: '/tasks', label: 'My Tasks', icon: ListChecks, hint: 'Create, track, block and complete tasks' },
    { to: '/evidence', label: 'Work Evidence', icon: FileCheck2, hint: 'Links, files and notes that prove your outcomes' },
  ] },
  { title: 'Insights', items: [
    { to: '/performance', label: 'Performance', icon: BarChart3, hint: 'Your five scores and how each is calculated' },
    { to: '/insights', label: 'AI Insights', icon: Sparkles, hint: 'AI summaries, blockers and estimates from your records' },
  ] },
  { title: 'Reports', items: [
    { to: '/reports/daily', label: 'Daily Reports', icon: CalendarDays, hint: 'One day of your work, ready to share' },
    { to: '/reports/weekly', label: 'Weekly Reports', icon: CalendarRange, hint: 'Your week, with scores' },
  ] },
  { title: 'Connected apps', items: [INTEGRATIONS] },
];

export const MANAGER_GROUPS: NavGroup[] = [
  { title: 'Team', items: [
    { to: '/manager', label: 'Manager Dashboard', icon: Gauge, hint: 'The 30-second view: reviews, blockers, team table' },
    { to: '/team', label: 'Team Performance', icon: Users, hint: 'Score distributions and trends — no rankings' },
  ] },
  { title: 'Reports', items: [
    { to: '/reports/daily', label: 'Daily Reports', icon: CalendarDays, hint: 'Team digest or any person, any day' },
    { to: '/reports/weekly', label: 'Weekly Reports', icon: CalendarRange, hint: 'Weekly analysis with scores' },
  ] },
  { title: 'Connected apps', items: [INTEGRATIONS] },
];

export const FOOTER_NAV: NavItem[] = [HELP, SETTINGS];

/** Flat lists (command palette). */
export const EMPLOYEE_NAV: NavItem[] = [...EMPLOYEE_GROUPS.flatMap((g) => g.items), ...FOOTER_NAV];
export const MANAGER_NAV: NavItem[] = [...MANAGER_GROUPS.flatMap((g) => g.items), ...FOOTER_NAV];
