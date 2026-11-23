import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Scale } from 'lucide-react';
import { api } from '@/api';
import { Card, ErrorState, PageSkeleton, Stat } from '@/components/ui';
import { ScoreOverview, ScoreTrend, StoredRecords } from '@/components/ScorePanel';
import { useAsync, useDataChanged } from '@/lib/hooks';
import { fmtDate } from '@/lib/format';

const pctStr = (v: number | null | undefined) => (v == null ? '—' : `${v}%`);
const diff = (a: number | null | undefined, b: number | null | undefined) => (a == null || b == null ? null : a - b);

export default function Performance() {
  const { data, error, loading, reload } = useAsync(() => api.performance.get(), []);
  useDataChanged(reload);
  if (loading && !data) return <PageSkeleton />;
  if (error || !data) return <ErrorState message={error ?? 'No data'} onRetry={reload} />;

  const p = data.current.dimensions.productivity.inputs, q = data.current.dimensions.quality.inputs, im = data.current.dimensions.impact.inputs;
  const pp = data.previous.dimensions.productivity.inputs;
  const wow = diff(data.current.overall, data.previous.overall);
  const impactSeries = data.trend.map((t) => ({ week: fmtDate(t.period_start), points: t.dimensions.impact.inputs.points ?? 0 }));
  const hint = (d: number | null, unit = '') => (d == null ? 'vs last week: —' : `${d >= 0 ? '+' : ''}${d}${unit} vs last week`);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="h-page">Performance</h1>
        <p className="text-sm text-muted mt-0.5">Five dimensions computed from your task records. Every number explains itself — click “How is this calculated?”.</p>
      </div>

      <ScoreOverview view={data} />

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Stat label="Completion rate" value={pctStr(p.completion_rate)} hint={`${p.completed ?? 0} of ${p.eligible ?? 0} tasks · ${hint(diff(p.completion_rate, pp.completion_rate), 'pt')}`} />
        <Stat label="On-time rate" value={pctStr(p.on_time_rate)} hint={`${p.on_time ?? 0} of ${p.with_deadline ?? 0} with deadline`} />
        <Stat label="Verified" value={`${q.verified ?? 0}/${q.reviewed ?? 0}`} hint="Reviewed tasks verified" tone="success" />
        <Stat label="Impact points" value={im.points ?? 0} hint={`Your 4-week median: ${im.trailing_median ?? 0}`} tone="accent" />
        <Stat label="Week over week" value={wow == null ? '—' : `${wow >= 0 ? '+' : ''}${wow}`} hint="Overall score change" tone={wow == null ? undefined : wow >= 0 ? 'success' : 'danger'} />
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <Card className="lg:col-span-2" title="Trend" subtitle="Last 6 weeks. Gaps mean “not enough data”, never zero.">
          <ScoreTrend trend={data.trend} height={260} />
        </Card>
        <Card title="Impact per week" subtitle="Verified tasks at full value, unverified at 50%">
          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={impactSeries} margin={{ top: 8, right: 4, left: -24, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="week" tickLine={false} axisLine={false} />
                <YAxis allowDecimals={false} tickLine={false} axisLine={false} />
                <Tooltip cursor={{ fill: 'rgb(var(--subtle))' }} contentStyle={{ background: 'rgb(var(--surface))', border: '1px solid rgb(var(--border))', borderRadius: 8, fontSize: 12 }} />
                <Bar dataKey="points" name="Impact points" fill="rgb(var(--accent))" radius={[3, 3, 0, 0]} maxBarSize={28} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <StoredRecords />

      <Card title={<span className="flex items-center gap-1.5"><Scale size={14} className="text-accent" />Fairness rules</span>}>
        <ul className="grid sm:grid-cols-2 gap-x-6 gap-y-1.5 text-xs text-muted list-disc pl-4">
          <li>Hours worked never increase any score — actual time is shown only for estimation accuracy.</li>
          <li>Task count alone never increases a score: tasks are priority-weighted and scored as ratios.</li>
          <li>Missing data is never zero: fewer than 3 data points shows “Not enough data” and is dropped.</li>
          <li>Tasks blocked by an external dependency don’t count against completion or on-time rates.</li>
          <li>Scores are Provisional with fewer than 5 eligible or 2 reviewed tasks.</li>
          <li>Manager adjustments need a reason and keep the original visible. <Link to="/settings" className="text-accent hover:underline">Weights</Link> are set by your manager.</li>
        </ul>
      </Card>
    </div>
  );
}
