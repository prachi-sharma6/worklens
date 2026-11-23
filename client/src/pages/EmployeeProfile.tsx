import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CalendarDays, CalendarRange, ExternalLink, FileCheck2, ListChecks, UserX } from 'lucide-react';
import { api } from '@/api';
import { Avatar, Badge, Button, Card, EmptyState, ErrorState, PageSkeleton, PriorityIcon, ScoreRing, Segmented, StatusPill, VerifyPill } from '@/components/ui';
import { ScoreOverview, ScoreTrend, StoredRecords } from '@/components/ScorePanel';
import { WorkImpactTimeline } from '@/components/WorkImpactTimeline';
import { useAuth } from '@/context';
import { cap, dueLabel, EVIDENCE_LABEL, fmtDate, relTime } from '@/lib/format';
import { useAsync, useDataChanged } from '@/lib/hooks';

type Tab = 'timeline' | 'scores' | 'tasks' | 'evidence' | 'reviews';

export default function EmployeeProfile() {
  const { id: idParam } = useParams();
  const id = Number(idParam);
  const { user: viewer } = useAuth();
  const [tab, setTab] = useState<Tab>('timeline');

  const profile = useAsync(async () => {
    const [user, perf, timeline, tasks, evidence] = await Promise.all([
      api.users.get(id), api.performance.get(id), api.timeline.list(id), api.tasks.list({ user_id: id, sort: 'created' }), api.evidence.list(id),
    ]);
    return { user, perf, timeline, tasks, evidence };
  }, [id]);
  useDataChanged(profile.reload);

  if (!Number.isFinite(id)) return <div className="card"><EmptyState icon={<UserX size={18} />} title="Person not found" /></div>;
  if (profile.loading && !profile.data) return <PageSkeleton />;
  if (profile.error) {
    if (/not found|forbidden/i.test(profile.error)) return <div className="card"><EmptyState icon={<UserX size={18} />} title="You can’t view this profile" body="Managers can view their team members; employees can view only their own profile." action={<Link to="/"><Button variant="primary">Go home</Button></Link>} /></div>;
    return <ErrorState message={profile.error} onRetry={profile.reload} />;
  }
  const { user, perf, timeline, tasks, evidence } = profile.data!;
  const isManagerView = viewer?.role === 'manager' && viewer.id !== user.id;
  const completed = tasks.filter((t) => t.status === 'completed');

  return (
    <div className="space-y-5">
      <div className="card p-4 sm:p-5 flex flex-col sm:flex-row gap-4 sm:items-center">
        <div className="flex items-center gap-3.5 flex-1 min-w-0">
          <Avatar name={user.name} color={user.avatar_color} size={52} />
          <div className="min-w-0">
            <h1 className="h-page truncate">{user.name}</h1>
            <p className="text-xs text-muted">{user.title}</p>
            <p className="text-xs text-faint">{user.email}</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right text-xs text-muted space-y-0.5">
            <p>Overall · this week</p>
            {perf.current.is_provisional && <Badge tone="warning">Provisional</Badge>}
            <p className="text-faint">4-week: <span className="tnum text-fg">{perf.rolling.overall ?? '—'}</span></p>
          </div>
          <ScoreRing value={perf.current.overall} provisional={perf.current.is_provisional} size={76} />
        </div>
      </div>

      {viewer?.role === 'manager' && (
        <div className="flex flex-wrap gap-2">
          <Link to={`/reports/daily?user=${user.id}`}><Button size="sm" icon={<CalendarDays size={14} />}>Daily report</Button></Link>
          <Link to={`/reports/weekly?user=${user.id}`}><Button size="sm" icon={<CalendarRange size={14} />}>Weekly report</Button></Link>
        </div>
      )}

      <div className="overflow-x-auto">
        <Segmented<Tab> value={tab} onChange={setTab} options={[
          { value: 'timeline', label: 'Timeline' }, { value: 'scores', label: 'Scores' }, { value: 'tasks', label: `Tasks · ${tasks.length}` },
          { value: 'evidence', label: `Evidence · ${evidence.length}` }, { value: 'reviews', label: 'Reviews' },
        ]} />
      </div>

      {tab === 'timeline' && <Card title="Work Impact Timeline" subtitle="What was delivered, verified and solved — week by week"><WorkImpactTimeline events={timeline} /></Card>}

      {tab === 'scores' && (
        <div className="space-y-3">
          <ScoreOverview view={perf} canOverride={isManagerView} onChanged={profile.reload} />
          <Card title="Trend" subtitle="Last 6 weeks"><ScoreTrend trend={perf.trend} /></Card>
          <StoredRecords userId={perf.current.user_id} />
        </div>
      )}

      {tab === 'tasks' && (
        <Card bodyClass="px-0 pb-0 pt-0">
          {tasks.length === 0 ? <EmptyState icon={<ListChecks size={18} />} title="No tasks yet" /> : (
            <ul className="divide-y divide-border">
              {tasks.map((t) => (
                <li key={t.id}>
                  <Link to={`/tasks/${t.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 hover:bg-subtle">
                    <PriorityIcon priority={t.priority} />
                    <span className="text-[13px] font-medium flex-1 min-w-[180px] truncate">{t.title}</span>
                    <span className="text-[11px] text-faint">{cap(t.category)}</span>
                    <span className={t.is_overdue ? 'text-[11px] text-danger' : 'text-[11px] text-faint'}>{t.status === 'completed' ? `Done ${fmtDate(t.completed_at)}` : dueLabel(t.deadline)}</span>
                    <StatusPill status={t.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {tab === 'evidence' && (
        <Card bodyClass="px-0 pb-0 pt-0">
          {evidence.length === 0 ? <EmptyState icon={<FileCheck2 size={18} />} title="No evidence submitted yet" /> : (
            <ul className="divide-y divide-border">
              {evidence.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
                  <Badge tone="info">{EVIDENCE_LABEL[e.type]}</Badge>
                  <Link to={`/tasks/${e.task_id}`} className="text-[13px] font-medium flex-1 min-w-[160px] truncate hover:text-accent">{e.task_title}</Link>
                  {e.url && <a href={e.url} target="_blank" rel="noreferrer" className="text-xs text-accent inline-flex items-center gap-1">Open <ExternalLink size={11} /></a>}
                  {e.verification_status && <VerifyPill status={e.verification_status} />}
                  <span className="text-[11px] text-faint">{relTime(e.submitted_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {tab === 'reviews' && (
        <Card bodyClass="px-0 pb-0 pt-0">
          {completed.length === 0 ? <EmptyState title="No completed tasks yet" /> : (
            <ul className="divide-y divide-border">
              {completed.map((t) => (
                <li key={t.id}>
                  <Link to={`/tasks/${t.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 hover:bg-subtle">
                    <span className="text-[13px] font-medium flex-1 min-w-[180px] truncate">{t.title}</span>
                    <span className="text-[11px] text-faint">{t.evidence_count} evidence</span>
                    <span className="text-[11px] text-faint">Completed {fmtDate(t.completed_at)}</span>
                    <VerifyPill status={t.verification_status} />
                    {isManagerView && t.verification_status === 'pending' && <span className="text-xs text-accent font-medium">Review</span>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
}
