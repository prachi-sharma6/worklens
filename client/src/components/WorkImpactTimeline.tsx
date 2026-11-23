import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Area, AreaChart, ResponsiveContainer, Tooltip } from 'recharts';
import { Award, CheckCircle2, FileCheck2, MessageSquare, OctagonAlert, PlusCircle, ShieldCheck, Unlock, History } from 'lucide-react';
import type { TimelineEvent, TimelineEventType } from '@/api/types';
import { EmptyState, cx } from '@/components/ui';
import { fmtDate, fmtDateTime } from '@/lib/format';

const META: Record<TimelineEventType, { label: string; icon: React.ElementType; cls: string }> = {
  task_completed: { label: 'Completed', icon: CheckCircle2, cls: 'text-success bg-success-soft' },
  achievement: { label: 'Achievement', icon: Award, cls: 'text-accent bg-accent-soft' },
  evidence_submitted: { label: 'Deliverable', icon: FileCheck2, cls: 'text-info bg-info-soft' },
  verified: { label: 'Verified', icon: ShieldCheck, cls: 'text-success bg-success-soft' },
  blocker_resolved: { label: 'Problem solved', icon: Unlock, cls: 'text-warning bg-warning-soft' },
  blocker_opened: { label: 'Blocker', icon: OctagonAlert, cls: 'text-danger bg-danger-soft' },
  feedback: { label: 'Manager feedback', icon: MessageSquare, cls: 'text-muted bg-subtle' },
  task_created: { label: 'Created', icon: PlusCircle, cls: 'text-faint bg-subtle' },
};

const FILTERS: { key: string; label: string; types: TimelineEventType[] }[] = [
  { key: 'impact', label: 'Impact', types: ['task_completed', 'achievement', 'evidence_submitted', 'verified', 'blocker_resolved', 'feedback'] },
  { key: 'completed', label: 'Completed', types: ['task_completed'] },
  { key: 'achievement', label: 'Achievements', types: ['achievement', 'verified'] },
  { key: 'deliverable', label: 'Deliverables', types: ['evidence_submitted'] },
  { key: 'solved', label: 'Problems solved', types: ['blocker_resolved'] },
  { key: 'feedback', label: 'Feedback', types: ['feedback'] },
  { key: 'all', label: 'Everything', types: Object.keys(META) as TimelineEventType[] },
];

const weekOf = (iso: string) => { const d = new Date(iso); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.getTime(); };
const POINTS: Partial<Record<TimelineEventType, number>> = { task_completed: 1, verified: 2, achievement: 4, blocker_resolved: 1, evidence_submitted: 0.5 };

/** Vertical, week-grouped feed of real timeline events with filter chips and a cumulative-impact sparkline. */
export function WorkImpactTimeline({ events, limitWeeks }: { events: TimelineEvent[]; limitWeeks?: number }) {
  const [filter, setFilter] = useState('impact');
  const types = new Set(FILTERS.find((f) => f.key === filter)!.types);
  const shown = events.filter((e) => types.has(e.event_type));

  const groups = useMemo(() => {
    const m = new Map<number, TimelineEvent[]>();
    for (const e of shown) { const k = weekOf(e.occurred_at); m.set(k, [...(m.get(k) ?? []), e]); }
    const arr = [...m.entries()].sort((a, b) => b[0] - a[0]);
    return limitWeeks ? arr.slice(0, limitWeeks) : arr;
  }, [shown, limitWeeks]);

  const spark = useMemo(() => {
    const byDay = new Map<string, number>();
    for (const e of [...events].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at))) {
      const k = e.occurred_at.slice(0, 10);
      byDay.set(k, (byDay.get(k) ?? 0) + (POINTS[e.event_type] ?? 0));
    }
    let acc = 0;
    return [...byDay.entries()].map(([day, v]) => ({ day, value: (acc += v) }));
  }, [events]);

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-end gap-3 justify-between mb-4">
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              className={cx('h-7 px-2.5 rounded-full border text-xs font-medium transition', filter === f.key ? 'bg-accent text-accent-fg border-accent' : 'border-border text-muted hover:text-fg hover:bg-subtle')}>
              {f.label}
            </button>
          ))}
        </div>
        {spark.length > 1 && (
          <div className="w-full sm:w-56">
            <p className="text-[11px] text-faint mb-0.5">Cumulative impact · {Math.round(spark[spark.length - 1].value)} pts</p>
            <div className="h-10">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={spark} margin={{ top: 2, bottom: 0, left: 0, right: 0 }}>
                  <defs><linearGradient id="wl-spark" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="rgb(var(--accent))" stopOpacity={0.35} /><stop offset="100%" stopColor="rgb(var(--accent))" stopOpacity={0} /></linearGradient></defs>
                  <Tooltip cursor={false} contentStyle={{ background: 'rgb(var(--surface))', border: '1px solid rgb(var(--border))', borderRadius: 8, fontSize: 11 }} labelFormatter={(_, p) => (p?.[0] ? fmtDate(p[0].payload.day) : '')} formatter={(v: number) => [Math.round(v), 'Impact pts']} />
                  <Area type="monotone" dataKey="value" stroke="rgb(var(--accent))" strokeWidth={1.5} fill="url(#wl-spark)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>

      {groups.length === 0 ? (
        <EmptyState icon={<History size={18} />} title="Nothing here yet" body="Complete a task or add evidence and it will appear on this timeline." />
      ) : (
        <div className="space-y-6">
          {groups.map(([wk, list]) => (
            <div key={wk}>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-faint mb-2">Week of {fmtDate(new Date(wk).toISOString(), { month: 'long', day: 'numeric' })} · {list.length} event{list.length === 1 ? '' : 's'}</p>
              <ol className="relative ml-3.5 border-l border-border">
                {list.map((e) => {
                  const m = META[e.event_type]; const Icon = m.icon;
                  return (
                    <li key={e.id} className="relative pl-6 pb-4 last:pb-0">
                      <span className={cx('absolute -left-3.5 top-0 h-7 w-7 rounded-full flex items-center justify-center ring-4 ring-surface', m.cls)}><Icon size={14} /></span>
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        {e.task_id ? <Link to={`/tasks/${e.task_id}`} className="text-[13px] font-medium hover:text-accent">{e.title}</Link> : <span className="text-[13px] font-medium">{e.title}</span>}
                        <span className="text-[11px] text-faint">{m.label} · {fmtDateTime(e.occurred_at)}</span>
                      </div>
                      {e.detail && <p className="text-xs text-muted mt-0.5 line-clamp-2">{e.detail}</p>}
                    </li>
                  );
                })}
              </ol>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
