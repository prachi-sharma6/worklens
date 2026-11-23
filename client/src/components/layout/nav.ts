import { BarChart3, CalendarDays, CalendarRange, FileCheck2, Gauge, LayoutDashboard, ListChecks, Sparkles, Users } from 'lucide-react';

export const EMPLOYEE_NAV = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/tasks', label: 'My Tasks', icon: ListChecks },
  { to: '/evidence', label: 'Work Evidence', icon: FileCheck2 },
  { to: '/performance', label: 'Performance', icon: BarChart3 },
  { to: '/insights', label: 'AI Insights', icon: Sparkles },
  { to: '/reports/daily', label: 'Daily Reports', icon: CalendarDays },
  { to: '/reports/weekly', label: 'Weekly Reports', icon: CalendarRange },
];
export const MANAGER_NAV = [
  { to: '/manager', label: 'Manager Dashboard', icon: Gauge },
  { to: '/team', label: 'Team Performance', icon: Users },
];

