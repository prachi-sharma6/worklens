import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend } from 'recharts';
import { Award, BellRing, CalendarClock, CheckCircle2, CircleDot, ListTodo, OctagonAlert, Plus, ShieldCheck, Sparkles, ArrowRight } from 'lucide-react';
import { api, type DashboardSummary, type TaskWithMeta } from '@/api';
import { Badge, Button, Card, EmptyState, ErrorState, PageSkeleton, PriorityIcon, Stat, StatusPill, cx } from '@/components/ui';
import { useAuth, useUI } from '@/context';
import { DailyInsightCard } from '@/components/AiCards';
import { useAsync, useDataChanged } from '@/lib/hooks';
import { dueLabel, fmtDateTime, greeting, relTime } from '@/lib/format';

const ATTENTION: Record<DashboardSummary['attention'][number]['kind'], { label: string; tone: 'danger' | 'warning'; action: string; hint: (t: TaskWithMeta) => string }> = {
  rejected: { label: 'Rejected', tone: 'danger', action: 'Respond', hint: () => 'Your manager rejected this' },
  clarification: { label: 'Clarify', tone: 'warning', action: 'Respond', hint: () => 'Your manager asked for clarification' },
  overdue: { label: 'Overdue', tone: 'danger', action: 'Update', hint: (t) => `${dueLabel(t.deadline)} — update status or report a blocker` },
  no_evidence: { label: 'No evidence', tone: 'warning', action: 'Add evidence', hint: () => 'Completed but not reviewable until evidence is added' },
};

export default function EmployeeDashboard() {
  const { user } = useAuth();
  const { openComposer } = useUI();
  const [showAll, setShowAll] = useState(false);
  const insights = useAsync(() => api.insights.get(), []);
  const { data, error, loading, reload } = useAsync(() => api.dashboard.employee(), []);
  useDataChanged(reload);

  if (loading && !data) return <PageSkeleton />;
  if (error || !data) return <ErrorState message={error ?? 'No data'} onRetry={reload} />;

  const first = user!.name.split(' ')[0];
  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  const nowDoing = data.planned_today.filter((t) => t.status === 'in_progress');
  const isWeekend = [0, 6].includes(new Date().getDay());

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <p className="text-xs text-faint">{today}</p>
          <h1 className="h-page mt-0.5">{greeting()}, {first}</h1>
          <p className="text-sm text-muted mt-0.5">
            {nowDoing.length ? <>You’re working on <span className="text-fg font-medium">{nowDoing[0].title}</span>{nowDoing.length > 1 && ` and ${nowDoing.length - 1} more`}.</> : isWeekend ? 'It’s the weekend — here’s where things stand.' : 'Nothing in progress yet — pick something from today’s plan.'}
          </p>
        </div>
        <Button variant="primary" className="h-10 px-4" onClick={openComposer} icon={<Plus size={16} />}>Add Task</Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Stat label="Planned today" value={data.planned_count} icon={<ListTodo size={15} />} />
        <Stat label="Completed today" value={data.completed_today} tone="success" icon={<CheckCircle2 size={15} />} />
        <Stat label="Open" value={data.pending} hint="Not started + in progress" icon={<CircleDot size={15} />} />
        <Stat label="Blocked" value={data.blocked} tone={data.blocked ? 'danger' : undefined} icon={<OctagonAlert size={15} />} />
        <div className="card p-4 col-span-2 lg:col-span-1">
          <div className="flex items-center justify-between text-xs text-muted"><span>Today’s plan done</span></div>
          <div className="mt-1.5 text-2xl font-semibold tnum">{data.completion_pct == null ? '—' : `${data.completion_pct}%`}</div>
          <div className="h-1.5 rounded-full bg-subtle mt-2 overflow-hidden"><div className="h-full bg-accent rounded-full transition-all" style={{ width: `${data.completion_pct ?? 0}%` }} /></div>
        </div>
      </div>

      {data.attention.length > 0 && (
        <Card title={<span className="flex items-center gap-1.5"><BellRing size={14} className="text-warning" />Needs your attention · {data.attention.length}</span>} subtitle="Things only you can move forward" bodyClass="px-2 pb-2"
          action={data.attention.length > 4 && <Button size="sm" variant="ghost" onClick={() => setShowAll((v) => !v)}>{showAll ? 'Show less' : `Show all ${data.attention.length}`}</Button>}>
          <ul className="divide-y divide-border">
            {(showAll ? data.attention : data.attention.slice(0, 4)).map((a) => {
              const m = ATTENTION[a.kind];
              return (
                <li key={`${a.kind}-${a.task.id}`}>
                  <Link to={`/tasks/${a.task.id}`} className="flex items-center gap-3 px-2 py-2.5 rounded-md hover:bg-subtle transition">
                    <Badge tone={m.tone}>{m.label}</Badge>
                    <span className="flex-1 min-w-0">
                      <span className="block text-[13px] truncate">{a.task.title}</span>
                      <span className="block text-[11px] text-faint truncate">{a.note ? `“${a.note}”` : m.hint(a.task)}</span>
                    </span>
                    <span className="text-xs text-accent whitespace-nowrap">{m.action} →</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <div className="grid gap-3 lg:grid-cols-3">
        <Card className="lg:col-span-2" title="Today’s plan" subtitle="What am I working on?" action={<Link to="/tasks" className="text-xs text-accent hover:underline flex items-center gap-1">All tasks <ArrowRight size={12} /></Link>} bodyClass="px-2 pb-2">
          {data.planned_today.length === 0 ? (
            <EmptyState icon={<ListTodo size={18} />} title="Nothing planned for today" body="Add the outcomes you’re aiming for today." action={<Button variant="primary" size="sm" onClick={openComposer} icon={<Plus size={14} />}>Add Task</Button>} />
          ) : (
            <ul className="divide-y divide-border">
              {data.planned_today.map((t) => (
                <li key={t.id}>
                  <Link to={`/tasks/${t.id}`} className="flex items-center gap-3 px-2 py-2.5 rounded-md hover:bg-subtle transition">
                    <PriorityIcon priority={t.priority} />
                    <span className={cx('flex-1 min-w-0 truncate text-[13px]', t.status === 'completed' && 'text-muted line-through decoration-faint')}>{t.title}</span>
                    {t.open_blocker && <Badge tone="danger" className="hidden sm:inline-flex">{t.open_blocker.dependency_name ?? 'Blocked'}</Badge>}
                    <span className={cx('text-xs hidden sm:inline tnum', t.is_overdue ? 'text-danger' : 'text-faint')}>{t.status === 'completed' ? 'Done' : dueLabel(t.deadline)}</span>
                    <StatusPill status={t.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {insights.data ? <DailyInsightCard data={insights.data} compact /> : <Card title="AI daily insight"><p className="text-xs text-faint">Loading…</p></Card>}
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <Card className="lg:col-span-2" title="This week" subtitle="What have I done? Due vs completed per day">
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.week} margin={{ top: 8, right: 4, left: -24, bottom: 0 }} barGap={2}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} />
                <YAxis allowDecimals={false} tickLine={false} axisLine={false} />
                <Tooltip cursor={{ fill: 'rgb(var(--subtle))' }} contentStyle={{ background: 'rgb(var(--surface))', border: '1px solid rgb(var(--border))', borderRadius: 8, fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" iconSize={7} />
                <Bar dataKey="planned" name="Due" fill="rgb(var(--border))" radius={[3, 3, 0, 0]} maxBarSize={22} />
                <Bar dataKey="completed" name="Completed" fill="rgb(var(--accent))" radius={[3, 3, 0, 0]} maxBarSize={22} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="Upcoming deadlines" subtitle="What’s next?" bodyClass="px-2 pb-2">
          {data.upcoming.length === 0 ? <EmptyState icon={<CalendarClock size={18} />} title="No open deadlines" /> : (
            <ul className="divide-y divide-border">
              {data.upcoming.map((t) => (
                <li key={t.id}>
                  <Link to={`/tasks/${t.id}`} className="block px-2 py-2 rounded-md hover:bg-subtle">
                    <p className="text-[13px] truncate">{t.title}</p>
                    <p className={cx('text-[11px] mt-0.5 flex items-center gap-1.5', t.is_overdue ? 'text-danger' : 'text-faint')}><PriorityIcon priority={t.priority} />{dueLabel(t.deadline)}{t.status === 'blocked' && ' · blocked'}</p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title="Recent achievements" subtitle="Verified work and high-impact deliveries" action={<Link to={`/people/${user!.id}`} className="text-xs text-accent hover:underline flex items-center gap-1">Full timeline <ArrowRight size={12} /></Link>}>
        {data.achievements.length === 0 ? <EmptyState icon={<Award size={18} />} title="No verified work yet" body="Complete a task with evidence; once your manager verifies it, it shows up here." /> : (
          <ul className="grid sm:grid-cols-2 gap-2">
            {data.achievements.map((e) => (
              <li key={e.id}>
                <Link to={e.task_id ? `/tasks/${e.task_id}` : '#'} className="flex gap-2.5 p-2.5 rounded-md border border-border hover:bg-subtle transition">
                  <span className={cx('h-7 w-7 rounded-full flex items-center justify-center shrink-0', e.event_type === 'achievement' ? 'bg-accent-soft text-accent' : 'bg-success-soft text-success')}>{e.event_type === 'achievement' ? <Award size={14} /> : <ShieldCheck size={14} />}</span>
                  <span className="min-w-0"><span className="block text-[13px] truncate">{e.title}</span><span className="block text-[11px] text-faint" title={fmtDateTime(e.occurred_at)}>{relTime(e.occurred_at)}</span></span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
