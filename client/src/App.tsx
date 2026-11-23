import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { AppShell } from './components/layout/AppShell';
import { useAuth } from './context';
import { PageSkeleton } from './components/ui';
import Login from './pages/Login';
import EmployeeDashboard from './pages/EmployeeDashboard';
import MyTasks from './pages/MyTasks';
import CreateTask from './pages/CreateTask';
import TaskDetails from './pages/TaskDetails';
import Evidence from './pages/Evidence';
import Performance from './pages/Performance';
import Insights from './pages/Insights';
import { DailyReports, WeeklyReports } from './pages/Reports';
import ManagerDashboard from './pages/ManagerDashboard';
import TeamPerformance from './pages/TeamPerformance';
import EmployeeProfile from './pages/EmployeeProfile';
import SettingsPage from './pages/Settings';
import IntegrationsPage from './pages/Integrations';
import HelpPage from './pages/Help';
import NotFound from './pages/NotFound';

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <div className="p-8"><PageSkeleton /></div>;
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  return <>{children}</>;
}
function Only({ role, children }: { role: 'employee' | 'manager'; children: ReactNode }) {
  const { user } = useAuth();
  if (user && user.role !== role) return <Navigate to={user.role === 'manager' ? '/manager' : '/dashboard'} replace />;
  return <>{children}</>;
}
function Home() {
  const { user } = useAuth();
  return <Navigate to={user?.role === 'manager' ? '/manager' : '/dashboard'} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<RequireAuth><AppShell /></RequireAuth>}>
        <Route index element={<Home />} />
        <Route path="dashboard" element={<Only role="employee"><EmployeeDashboard /></Only>} />
        <Route path="tasks" element={<Only role="employee"><MyTasks /></Only>} />
        <Route path="tasks/new" element={<Only role="employee"><CreateTask /></Only>} />
        <Route path="tasks/:id" element={<TaskDetails />} />
        <Route path="evidence" element={<Only role="employee"><Evidence /></Only>} />
        <Route path="performance" element={<Only role="employee"><Performance /></Only>} />
        <Route path="insights" element={<Only role="employee"><Insights /></Only>} />
        <Route path="reports/daily" element={<DailyReports />} />
        <Route path="reports/weekly" element={<WeeklyReports />} />
        <Route path="manager" element={<Only role="manager"><ManagerDashboard /></Only>} />
        <Route path="team" element={<Only role="manager"><TeamPerformance /></Only>} />
        <Route path="people/:id" element={<EmployeeProfile />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="integrations" element={<IntegrationsPage />} />
        <Route path="help" element={<HelpPage />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
