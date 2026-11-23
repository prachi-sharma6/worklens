import { Link } from 'react-router-dom';
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Award, CalendarDays, CheckCircle2, ClipboardCheck, Clock, OctagonAlert, PlayCircle, ShieldCheck, Users } from 'lucide-react';
import { api } from '@/api';
import { Avatar, Badge, Button, Card, EmptyState, ErrorState, MiniBar, PageSkeleton, Stat, cx } from '@/components/ui';
import { DIM_LABEL, DIMS, fmtDate, relTime } from '@/lib/format';
import { useAsync, useDataChanged } from '@/lib/hooks';

const tooltipStyle = { background: 'rgb(var(--surface))', border: '1px solid rgb(var(--border))', borderRadius: 8, fontSize: 12 };
const hoursSince = (v: string | null) => (v ? (Date.now() - new Date(v).getTime()) / 3600000 : 0);
const pctTxt = (v: number | null) => (v == null ? '—' : `${v}%`);

export default function ManagerDashboard() {
  const { data, error, loading, reload } = useAsync(() => api.dashboard.manager(), []);
  useDataChanged(reload);
  if (loading && !data) return <PageSkeleton />;
  if (error || !data) return <ErrorState message={error ?? 'No data'} onRetry={reload} />;

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h1 className="h-page">Team overview</h1>
          <p className="text-xs text-muted mt-0.5">{new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })} · what shipped, what’s stuck, what needs you</p>
        </div>
        <div className="flex gap-2">
          <Link to="/reports/daily"><Button icon={<CalendarDays size={15} />}>Team daily report</Button></Link>
          <Link to="/team"><Button variant="primary" icon={<Users size={15} />}>Team performance</Button></Link>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Stat label="Team size" value={data.team_size} icon={<Users size={14} />} />
        <Stat label="Completed today" value={data.completed_today} tone="success" icon={<CheckCircle2 size={14} />} />
        <Stat label="In progress" value={data.in_progress} icon={<PlayCircle size={14} />} />
        <Stat label="Blocked" value={data.blocked} tone={data.blocked ? 'danger' : undefined} icon={<OctagonAlert size={14} />} />
        <Stat label="Pending reviews" value={data.pending_reviews} tone={data.pending_reviews ? 'accent' : undefined} icon={<ClipboardCheck size={14} />} />
        <Stat label="Team delivery" value={pctTxt(data.delivery_pct)} hint="Due this week & completed" icon={<ShieldCheck size={14} />} />
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <Card title="Weekly delivery" subtitle="Tasks due vs completed, and on-time %" className="lg:col-span-2">
          <div className="h-60">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={data.trend} margin={{ top: 8, right: 0, left: -18, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} />
                <YAxis yAxisId="n" allowDecimals={false} tickLine={false} axisLine={false} />
                <YAxis yAxisId="p" orientation="right" domain={[0, 100]} tickLine={false} axisLine={false} width={30} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'rgb(var(--subtle))' }} />
                <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" iconSize={7} />
                <Bar yAxisId="n" dataKey="planned" name="Due" fill="rgb(var(--border))" radius={[4, 4, 0, 0]} maxBarSize={28} />
                <Bar yAxisId="n" dataKey="completed" name="Completed" fill="rgb(var(--accent))" radius={[4, 4, 0, 0]} maxBarSize={28} />
                <Line yAxisId="p" dataKey="on_time" name="On-time %" stroke="rgb(var(--success))" strokeWidth={2} dot={{ r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card title="Recent achievements" subtitle="Verified work across the team">
          {data.achievements.length === 0 ? <EmptyState icon={<Award size={18} />} title="No verified work yet" body="Verify completed tasks from the review queue." /> : (
            <ul className="space-y-3">
              {data.achievements.map((a) => (
                <li key={a.id} className="flex gap-2.5">
                  <span className={cx('mt-0.5 h-6 w-6 rounded-full flex items-center justify-center shrink-0', a.event_type === 'achievement' ? 'bg-accent-soft text-accent' : 'bg-success-soft text-success')}>{a.event_type === 'achievement' ? <Award size={13} /> : <ShieldCheck size={13} />}</span>
                  <div className="min-w-0">
                    {a.task_id ? <Link to={`/tasks/${a.task_id}`} className="text-[13px] font-medium hover:text-accent line-clamp-1">{a.title}</Link> : <p className="text-[13px] font-medium">{a.title}</p>}
                    <p className="text-[11px] text-faint">{a.user_name} · {relTime(a.occurred_at)}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card title={`Review queue · ${data.review_queue.length}`} subtitle="Completed with evidence, waiting for your decision">
          {data.review_queue.length === 0 ? <EmptyState icon={<ClipboardCheck size={18} />} title="All caught up" body="Nothing is waiting for review." /> : (
            <ul className="divide-y divide-border -mx-4 max-h-80 overflow-y-auto scrollbar-thin">
              {data.review_queue.map((t) => {
                const h = hoursSince(t.completed_at); const old = h > 24;
                return (
                  <li key={t.id}>
                    <Link to={`/tasks/${t.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-subtle">
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-medium truncate">{t.title}</p>
                        <p className="text-[11px] text-faint">{t.user_name} · {t.evidence_count} evidence item{t.evidence_count === 1 ? '' : 's'}</p>
                      </div>
                      <Badge tone={old ? 'warning' : 'neutral'} icon={<Clock size={10} />}>{relTime(t.completed_at)}</Badge>
                      <span className="text-xs text-accent font-medium">Review</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
        <Card title={`Open blockers · ${data.open_blockers.length}`} subtitle="Oldest first needs attention">
          {data.open_blockers.length === 0 ? <EmptyState icon={<OctagonAlert size={18} />} title="No open blockers" /> : (
            <ul className="divide-y divide-border -mx-4 max-h-80 overflow-y-auto scrollbar-thin">
              {[...data.open_blockers].sort((a, b) => a.opened_at.localeCompare(b.opened_at)).map((b) => {
                const h = hoursSince(b.opened_at);
                return (
                  <li key={b.id}>
                    <Link to={`/tasks/${b.task_id}`} className="block px-4 py-2.5 hover:bg-subtle">
                      <div className="flex items-center gap-2">
                        <p className="text-[13px] font-medium truncate flex-1">{b.task_title}</p>
                        {b.is_external && <Badge tone="info">External</Badge>}
                        <Badge tone={h > 48 ? 'danger' : 'neutral'} icon={<Clock size={10} />}>open {relTime(b.opened_at).replace(' ago', '')}</Badge>
                      </div>
                      <p className="text-[11px] text-faint mt-0.5">{b.user_name} · waiting on <span className="text-muted">{b.dependency_name ?? 'unclear dependency'}</span></p>
                      <p className="text-xs text-muted mt-0.5 line-clamp-1">{b.description}</p>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      <Card title="Team members" subtitle="Alphabetical · this week" bodyClass="px-0 pb-0">
        {/* table ≥ md */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-[11px] text-faint border-y border-border bg-subtle/50">
                <th className="font-medium px-4 py-2">Name</th>
                <th className="font-medium px-2 py-2">Current task</th>
                <th className="font-medium px-2 py-2 text-right">Done</th>
                <th className="font-medium px-2 py-2 text-right">On-time</th>
                <th className="font-medium px-2 py-2 text-right">Verified</th>
                <th className="font-medium px-2 py-2">{DIMS.map((d) => DIM_LABEL[d][0]).join(' · ')}</th>
                <th className="font-medium px-2 py-2 text-right">Blockers</th>
                <th className="font-medium px-4 py-2 text-right">Last activity</th>
              </tr>
            </thead>
            <tbody>
              {data.members.map((m) => (
                <tr key={m.user.id} className="border-b border-border last:border-0 hover:bg-subtle/50">
                  <td className="px-4 py-2.5">
                    <Link to={`/people/${m.user.id}`} className="flex items-center gap-2 hover:text-accent">
                      <Avatar name={m.user.name} color={m.user.avatar_color} size={24} />
                      <span className="font-medium whitespace-nowrap">{m.user.name}</span>
                      {m.scores.is_provisional && <Badge tone="warning">Provisional</Badge>}
                    </Link>
                  </td>
                  <td className="px-2 py-2.5 max-w-[220px]">{m.current_task ? <Link to={`/tasks/${m.current_task.id}`} className="truncate block text-muted hover:text-accent">{m.current_task.title}</Link> : <span className="text-faint">—</span>}</td>
                  <td className="px-2 py-2.5 text-right tnum">{m.completed_week}</td>
                  <td className="px-2 py-2.5 text-right tnum">{pctTxt(m.on_time_pct)}</td>
                  <td className="px-2 py-2.5 text-right tnum">{pctTxt(m.verified_pct)}</td>
                  <td className="px-2 py-2.5"><div className="flex gap-1">{DIMS.map((d) => <MiniBar key={d} value={m.scores.dimensions[d].value} label={DIM_LABEL[d]} />)}</div></td>
                  <td className="px-2 py-2.5 text-right">{m.open_blockers ? <Badge tone="danger">{m.open_blockers}</Badge> : <span className="text-faint">0</span>}</td>
                  <td className="px-4 py-2.5 text-right text-xs text-muted whitespace-nowrap">{relTime(m.last_activity)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* cards < md */}
        <div className="md:hidden divide-y divide-border border-t border-border">
          {data.members.map((m) => (
            <Link key={m.user.id} to={`/people/${m.user.id}`} className="block px-4 py-3 hover:bg-subtle">
              <div className="flex items-center gap-2">
                <Avatar name={m.user.name} color={m.user.avatar_color} size={26} />
                <span className="font-medium flex-1">{m.user.name}</span>
                {m.open_blockers > 0 && <Badge tone="danger">{m.open_blockers} blocked</Badge>}
              </div>
              <p className="text-xs text-muted mt-1 truncate">{m.current_task?.title ?? 'No task in progress'}</p>
              <div className="flex gap-3 text-[11px] text-faint mt-1.5 tnum">
                <span>{m.completed_week} done</span><span>On-time {pctTxt(m.on_time_pct)}</span><span>Verified {pctTxt(m.verified_pct)}</span><span className="ml-auto">{relTime(m.last_activity)}</span>
              </div>
              <div className="flex gap-1 mt-2">{DIMS.map((d) => <MiniBar key={d} value={m.scores.dimensions[d].value} label={DIM_LABEL[d]} />)}</div>
            </Link>
          ))}
        </div>
        <p className="px-4 py-2.5 text-[11px] text-faint border-t border-border">Bars: {DIMS.map((d) => DIM_LABEL[d]).join(', ')} for the week of {fmtDate(data.members[0]?.scores.period_start ?? null)}. Grey = not enough data. Sorted by name — WorkLens doesn’t rank people.</p>
      </Card>
    </div>
  );
}
