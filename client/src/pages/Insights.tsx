import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Lightbulb, OctagonAlert, PlugZap, Sparkles, Timer } from 'lucide-react';
import { api } from '@/api';
import { Badge, Button, Card, EmptyState, ErrorState, PageSkeleton, cx } from '@/components/ui';
import { cap, fmtMinutes } from '@/lib/format';
import { useAsync, useDataChanged } from '@/lib/hooks';
import { DailyInsightCard, SuggestionsCard, WeeklyAnalysisCard } from '@/components/AiCards';

const tooltipStyle = { background: 'rgb(var(--surface))', border: '1px solid rgb(var(--border))', borderRadius: 8, fontSize: 12 };

function Source({ n, label = 'records' }: { n: number; label?: string }) {
  return (
    <div className="mt-3 pt-2.5 border-t border-border flex items-center justify-between text-[11px] text-faint">
      <span>Generated from {n} {label} · deterministic, no AI</span>
      <Link to="/tasks" className="text-accent hover:underline">View tasks</Link>
    </div>
  );
}

export default function Insights() {
  const { data, error, loading, reload } = useAsync(() => api.insights.get(), []);
  useDataChanged(reload);
  if (loading && !data) return <PageSkeleton />;
  if (error || !data) return <ErrorState message={error ?? 'No data'} onRetry={reload} />;

  const blockerRecords = data.recurring_blockers.reduce((s, b) => s + b.count, 0);
  const est = data.estimation;
  const avgRatio = est.length ? est.reduce((s, e) => s + e.actual / e.estimated, 0) / est.length : null;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="h-page flex items-center gap-2">AI Insights</h1>
        <p className="text-xs text-muted mt-0.5">Patterns in your own work. AI cards are written by viaSocket AI only from your records and link back to them; the rest is computed directly. AI never changes scores.</p>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <DailyInsightCard data={data} />
        <WeeklyAnalysisCard data={data} />
        <SuggestionsCard data={data} />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card title={<span className="flex items-center gap-2"><OctagonAlert size={15} className="text-danger" />Recurring blockers</span>} subtitle="Grouped by dependency">
          {data.recurring_blockers.length === 0 ? <EmptyState title="No blockers reported" body="Nice — nothing has held you up." /> : (
            <ul className="divide-y divide-border -mx-4">
              {data.recurring_blockers.map((b) => (
                <li key={b.dependency} className="px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-medium flex-1 truncate">{b.dependency}</span>
                    <Badge tone={b.type === 'external' ? 'info' : b.type === 'unclear' ? 'warning' : 'neutral'}>{cap(b.type)}</Badge>
                    <span className="text-xs tnum text-muted">{b.count}×</span>
                    {b.open > 0 && <Badge tone="danger">{b.open} open</Badge>}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-2 text-[11px] text-faint mt-0.5">
                    <span>Avg. time to resolve: {b.avg_hours == null ? '—' : `${b.avg_hours}h`}</span>
                    <span>·</span>
                    {b.task_ids.slice(0, 4).map((id) => <Link key={id} to={`/tasks/${id}`} className="text-accent hover:underline">#{id}</Link>)}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <Source n={blockerRecords} label="blocker records" />
        </Card>

        <Card title="Planned vs. actual" subtitle="Tasks due per week vs tasks completed">
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.planned_vs_actual} margin={{ top: 8, right: 0, left: -18, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} />
                <YAxis allowDecimals={false} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'rgb(var(--subtle))' }} />
                <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" iconSize={7} />
                <Bar dataKey="planned" name="Planned / due" fill="rgb(var(--border))" radius={[4, 4, 0, 0]} maxBarSize={28} />
                <Bar dataKey="completed" name="Completed" fill="rgb(var(--accent))" radius={[4, 4, 0, 0]} maxBarSize={28} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <Source n={data.source_task_ids.length} label="tasks" />
        </Card>
      </div>

      <Card title={<span className="flex items-center gap-2"><Timer size={15} className="text-info" />Estimation accuracy</span>}
        subtitle={avgRatio != null ? `On average your tasks take ${Math.round(avgRatio * 100)}% of the estimate. Hours never affect scores — this is for planning only.` : 'Hours never affect scores — this is for planning only.'}
        bodyClass="px-0 pb-4">
        {est.length === 0 ? <EmptyState title="No time data yet" body="Log actual time when you wrap up a task to see this." /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead><tr className="text-left text-[11px] text-faint border-y border-border bg-subtle/50"><th className="font-medium px-4 py-2">Task</th><th className="font-medium px-2 py-2 text-right">Estimated</th><th className="font-medium px-2 py-2 text-right">Actual</th><th className="font-medium px-4 py-2 text-right">Difference</th></tr></thead>
              <tbody>
                {est.map((e) => {
                  const diff = Math.round(((e.actual - e.estimated) / e.estimated) * 100);
                  return (
                    <tr key={e.task_id} className="border-b border-border last:border-0">
                      <td className="px-4 py-2 max-w-[280px]"><Link to={`/tasks/${e.task_id}`} className="truncate block hover:text-accent">{e.title}</Link></td>
                      <td className="px-2 py-2 text-right tnum text-muted">{fmtMinutes(e.estimated)}</td>
                      <td className="px-2 py-2 text-right tnum">{fmtMinutes(e.actual)}</td>
                      <td className={cx('px-4 py-2 text-right tnum', Math.abs(diff) <= 20 ? 'text-success' : diff > 0 ? 'text-warning' : 'text-info')}>{diff > 0 ? '+' : ''}{diff}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="px-4"><Source n={est.length} label="tasks with logged time" /></div>
      </Card>
    </div>
  );
}
