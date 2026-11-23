import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Info } from 'lucide-react';
import { api } from '@/api';
import { Avatar, Card, EmptyState, ErrorState, PageSkeleton, cx, scoreTone } from '@/components/ui';
import { cap, DIM_LABEL, DIMS, fmtDate } from '@/lib/format';
import { useAsync, useDataChanged } from '@/lib/hooks';

const tooltipStyle = { background: 'rgb(var(--surface))', border: '1px solid rgb(var(--border))', borderRadius: 8, fontSize: 12 };
const PERSON_COLORS = ['#14B8A6', '#A78BFA', '#F59E0B', '#60A5FA', '#F472B6', '#22C55E', '#F87171'];

export default function TeamPerformance() {
  const { data, error, loading, reload } = useAsync(() => api.team.performance(), []);
  useDataChanged(reload);
  if (loading && !data) return <PageSkeleton />;
  if (error || !data) return <ErrorState message={error ?? 'No data'} onRetry={reload} />;

  const members = data.members;
  const weeks = members[0]?.trend.map((t) => t.period_start) ?? [];
  const trendData = weeks.map((w, i) => ({ week: fmtDate(w), ...Object.fromEntries(members.map((m) => [m.user.name.split(' ')[0], m.trend[i]?.overall ?? null])) }));
  const blockerData = data.blockers_by_type.map((b) => ({ ...b, type: cap(b.type) }));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="h-page">Team performance</h1>
        <p className="text-xs text-muted mt-0.5 flex items-center gap-1.5"><Info size={12} /> WorkLens shows distributions, not rankings. People are listed alphabetically.</p>
      </div>

      <Card title="Dimension distributions · this week" subtitle="Each dot is one person on a 0–100 scale. Hover for the name.">
        {members.length === 0 ? <EmptyState title="No team members yet" /> : (
          <div className="space-y-4">
            {DIMS.map((d) => {
              const missing = members.filter((m) => m.trend[m.trend.length - 1]?.dimensions[d].value == null);
              return (
                <div key={d} className="grid sm:grid-cols-[120px_1fr] gap-x-4 gap-y-1 items-center">
                  <p className="text-xs font-medium text-muted">{DIM_LABEL[d]}</p>
                  <div>
                    <div className="relative h-7 rounded-md bg-subtle">
                      {[25, 50, 75].map((x) => <span key={x} className="absolute top-0 bottom-0 border-l border-dashed border-border" style={{ left: `${x}%` }} />)}
                      {members.map((m, i) => {
                        const v = m.trend[m.trend.length - 1]?.dimensions[d].value;
                        if (v == null) return null;
                        return (
                          <Link key={m.user.id} to={`/people/${m.user.id}`} title={`${m.user.name}: ${v}`}
                            className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 h-4 w-4 rounded-full ring-2 ring-surface hover:scale-125 transition"
                            style={{ left: `${v}%`, background: PERSON_COLORS[i % PERSON_COLORS.length] }} />
                        );
                      })}
                    </div>
                    <div className="flex justify-between text-[10px] text-faint mt-0.5"><span>0</span><span>50</span><span>100</span></div>
                    {missing.length > 0 && <p className="text-[11px] text-faint">Not enough data: {missing.map((m) => m.user.name).join(', ')}</p>}
                  </div>
                </div>
              );
            })}
            <div className="flex flex-wrap gap-3 pt-2 border-t border-border">
              {members.map((m, i) => (
                <Link key={m.user.id} to={`/people/${m.user.id}`} className="flex items-center gap-1.5 text-xs text-muted hover:text-fg">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: PERSON_COLORS[i % PERSON_COLORS.length] }} />{m.user.name}
                </Link>
              ))}
            </div>
          </div>
        )}
      </Card>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card title="Planned vs completed · this week" subtitle="Due this week vs completed this week">
          <div className="h-60">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.planned_vs_completed} margin={{ top: 8, right: 0, left: -18, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" tickLine={false} axisLine={false} />
                <YAxis allowDecimals={false} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'rgb(var(--subtle))' }} />
                <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" iconSize={7} />
                <Bar dataKey="planned" name="Planned / due" fill="rgb(var(--border))" radius={[4, 4, 0, 0]} maxBarSize={26} />
                <Bar dataKey="completed" name="Completed" fill="rgb(var(--accent))" radius={[4, 4, 0, 0]} maxBarSize={26} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card title="Blockers by dependency type" subtitle="All time · open vs resolved">
          {blockerData.length === 0 ? <EmptyState title="No blockers reported" /> : (
            <div className="h-60">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={blockerData} margin={{ top: 8, right: 0, left: -18, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="type" tickLine={false} axisLine={false} />
                  <YAxis allowDecimals={false} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'rgb(var(--subtle))' }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" iconSize={7} />
                  <Bar dataKey="open" name="Open" stackId="a" fill="rgb(var(--danger))" maxBarSize={30} />
                  <Bar dataKey="resolved" name="Resolved" stackId="a" fill="rgb(var(--success))" radius={[4, 4, 0, 0]} maxBarSize={30} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </div>

      <Card title="Overall score trend · 4 weeks" subtitle="Gaps mean not enough data that week">
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={trendData} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="week" tickLine={false} axisLine={false} />
              <YAxis domain={[0, 100]} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" iconSize={7} />
              {members.map((m, i) => <Line key={m.user.id} type="monotone" dataKey={m.user.name.split(' ')[0]} stroke={PERSON_COLORS[i % PERSON_COLORS.length]} strokeWidth={1.8} dot={{ r: 2.5 }} connectNulls={false} />)}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card title="This week at a glance" bodyClass="px-0 pb-0">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead><tr className="text-left text-[11px] text-faint border-y border-border bg-subtle/50"><th className="font-medium px-4 py-2">Name</th>{DIMS.map((d) => <th key={d} className="font-medium px-2 py-2 text-right">{DIM_LABEL[d]}</th>)}<th className="font-medium px-4 py-2 text-right">Overall</th></tr></thead>
            <tbody>
              {members.map((m) => {
                const s = m.trend[m.trend.length - 1];
                return (
                  <tr key={m.user.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-2"><Link to={`/people/${m.user.id}`} className="flex items-center gap-2 hover:text-accent"><Avatar name={m.user.name} color={m.user.avatar_color} size={22} /><span className="whitespace-nowrap">{m.user.name}</span></Link></td>
                    {DIMS.map((d) => <td key={d} className={cx('px-2 py-2 text-right tnum', scoreTone(s?.dimensions[d].value))}>{s?.dimensions[d].value ?? <span className="text-[11px] text-faint">n/a</span>}</td>)}
                    <td className="px-4 py-2 text-right tnum font-medium">{s?.overall ?? '—'}{s?.is_provisional && <span className="ml-1 text-[10px] text-warning">prov.</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
