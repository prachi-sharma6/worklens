// Cards that show real AI output (written by viaSocket AI from WorkLens records), each with its source.
// When nothing has been generated yet they say so — never placeholder text dressed up as AI.
import { Link } from 'react-router-dom';
import { Lightbulb, PlugZap, Sparkles } from 'lucide-react';
import type { AiReportRef, Insights } from '@/api';
import { Badge, Button, Card } from '@/components/ui';
import { fmtDate, fmtDateTime, relTime } from '@/lib/format';

export function AiSource({ r, kind }: { r: AiReportRef; kind: 'daily' | 'weekly' }) {
  return (
    <div className="mt-3 pt-2.5 border-t border-border flex flex-wrap items-center justify-between gap-2 text-[11px] text-faint">
      <span title={`${r.ai?.model ?? ''} · ${fmtDateTime(r.generated_at)}`}>AI-generated from {r.ai?.records ?? r.source_task_ids.length} records · {relTime(r.generated_at)}</span>
      <Link to={`/reports/${kind}?saved=${r.saved_id}`} className="text-accent hover:underline">See the records</Link>
    </div>
  );
}

function Empty({ connected, what }: { connected: boolean; what: string }) {
  return (
    <>
      <p className="text-xs text-muted leading-relaxed">{what}</p>
      {!connected && <Link to="/settings" className="inline-block mt-3"><Button size="sm" icon={<PlugZap size={13} />}>View integrations</Button></Link>}
    </>
  );
}

export function DailyInsightCard({ data, compact }: { data: Insights; compact?: boolean }) {
  const r = data.latest_daily;
  return (
    <Card title={<span className="flex items-center gap-2"><Sparkles size={15} className="text-accent" />AI daily insight</span>}
      action={r ? <Badge tone="accent">{fmtDate(r.key + 'T00:00:00', { weekday: 'short', month: 'short', day: 'numeric' })}</Badge> : <Badge>{data.ai_connected ? 'Nothing yet' : 'Not configured'}</Badge>}>
      {r ? (<><p className={compact ? 'text-xs text-muted leading-relaxed line-clamp-6' : 'text-[13px] text-muted leading-relaxed'}>{r.summary_text}</p><AiSource r={r} kind="daily" /></>)
        : <Empty connected={data.ai_connected} what="Written by viaSocket AI from your day’s tasks, evidence and blockers when the daily report runs at workday end. Nothing has been generated yet." />}
    </Card>
  );
}

export function WeeklyAnalysisCard({ data }: { data: Insights }) {
  const r = data.latest_weekly;
  return (
    <Card title={<span className="flex items-center gap-2"><Sparkles size={15} className="text-accent" />Weekly analysis</span>}
      action={r ? <Badge tone="accent">Week of {fmtDate(r.key + 'T00:00:00')}</Badge> : <Badge>{data.ai_connected ? 'Nothing yet' : 'Not configured'}</Badge>}>
      {r ? (
        <>
          <p className="text-[13px] text-muted leading-relaxed">{r.summary_text}</p>
          {r.analysis && (
            <div className="mt-3 space-y-2 text-xs">
              {r.analysis.achievements.length > 0 && <div><p className="font-medium text-fg">Achievements</p><ul className="list-disc pl-4 text-muted">{r.analysis.achievements.slice(0, 4).map((a, i) => <li key={i}>{a}</li>)}</ul></div>}
              {r.analysis.recurring_problems.length > 0 && <div><p className="font-medium text-fg">Recurring problems</p><ul className="list-disc pl-4 text-muted">{r.analysis.recurring_problems.slice(0, 3).map((p, i) => <li key={i}>{p.dependency} ({p.occurrences}×) — {p.note}</li>)}</ul></div>}
              {r.analysis.planned_vs_actual && <p className="text-muted"><span className="font-medium text-fg">Planned vs actual: </span>{r.analysis.planned_vs_actual}</p>}
            </div>
          )}
          <AiSource r={r} kind="weekly" />
        </>
      ) : <Empty connected={data.ai_connected} what="Achievements, recurring problems and planned vs. actual for the week, written on Friday 17:00 from the week’s records." />}
    </Card>
  );
}

export function SuggestionsCard({ data, manager }: { data: Insights; manager?: boolean }) {
  const weekly = data.latest_weekly?.analysis?.suggestions ?? [];
  const pending = data.pending_suggestions ?? [];
  return (
    <Card title={<span className="flex items-center gap-2"><Lightbulb size={15} className="text-accent" />Suggestions</span>} action={<Badge tone={weekly.length || pending.length ? 'accent' : 'neutral'}>AI</Badge>}>
      {manager && weekly.length > 0 ? (
        <><ul className="list-disc pl-4 text-[13px] text-muted space-y-1">{weekly.map((s, i) => <li key={i}>{s}</li>)}</ul>{data.latest_weekly && <AiSource r={data.latest_weekly} kind="weekly" />}</>
      ) : pending.length > 0 ? (
        <>
          <p className="text-xs text-faint mb-2">AI suggestions on your new tasks, waiting for you to accept or dismiss:</p>
          <ul className="space-y-1.5">{pending.map((p) => (
            <li key={p.task_id}><Link to={`/tasks/${p.task_id}`} className="block rounded-md border border-border px-2.5 py-2 hover:bg-subtle">
              <span className="text-[13px] block truncate">{p.title}</span>
              <span className="text-[11px] text-faint block truncate">Outcome: {p.expected_outcome} · {p.suggested_impact_level} impact</span>
            </Link></li>))}
          </ul>
        </>
      ) : <Empty connected={data.ai_connected} what={manager ? 'The weekly analysis adds 2–3 suggestions grounded in the team’s blockers and delivery.' : 'When you create a task, viaSocket AI suggests a measurable outcome and impact level. Nothing is waiting for you right now.'} />}
    </Card>
  );
}
