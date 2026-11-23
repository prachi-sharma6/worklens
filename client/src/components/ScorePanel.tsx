import { useState } from 'react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AlertCircle, PencilLine, RefreshCw, TrendingDown, TrendingUp } from 'lucide-react';
import { useAsync, useDataChanged } from '@/lib/hooks';
import { api, type Dimension, type PerformanceView, type ScoreResult } from '@/api';
import { Badge, Button, Card, Field, Modal, ScoreInfo, ScoreRing, cx, scoreTone, barColor } from '@/components/ui';
import { errMsg, useToast } from '@/context';
import { DIM_LABEL, DIMS, fmtDate, relTime } from '@/lib/format';

const OVERALL_FORMULA = 'Weighted average of the five dimensions using the weights in Settings. Dimensions with fewer than 3 data points are dropped and the remaining weights re-normalised. Marked Provisional when fewer than 5 eligible tasks or fewer than 2 reviewed tasks exist.';
export const DIM_COLORS: Record<Dimension, string> = { productivity: '#14B8A6', quality: '#22C55E', impact: '#F59E0B', consistency: '#60A5FA', ownership: '#A78BFA' };

/** Overall ring + five dimension cards with formula popovers and (for managers) an override control. */
export function ScoreOverview({ view, canOverride, onChanged }: { view: PerformanceView; canOverride?: boolean; onChanged?: () => void }) {
  const cur = view.current, prev = view.previous;
  const [editing, setEditing] = useState<Dimension | null>(null);
  const delta = cur.overall != null && prev.overall != null ? cur.overall - prev.overall : null;
  return (
    <div className="grid gap-3 lg:grid-cols-[280px_1fr]">
      <div className="card p-4 flex flex-col">
        <div className="flex items-center justify-between"><p className="section-title">Overall · this week</p>{cur.is_provisional && <Badge tone="warning">Provisional</Badge>}</div>
        <div className="flex items-center gap-4 mt-3">
          <ScoreRing value={cur.overall} provisional={cur.is_provisional} />
          <div className="text-xs text-muted space-y-1">
            <p>{fmtDate(cur.period_start)} – {fmtDate(cur.period_end)}</p>
            {delta != null && <p className={cx('flex items-center gap-1 font-medium', delta >= 0 ? 'text-success' : 'text-danger')}>{delta >= 0 ? <TrendingUp size={13} /> : <TrendingDown size={13} />}{delta >= 0 ? '+' : ''}{delta} vs last week</p>}
            <p>4-week rolling: <span className="font-medium text-fg tnum">{view.rolling.overall ?? '—'}</span></p>
          </div>
        </div>
        {cur.is_provisional && <p className="mt-3 text-xs text-warning flex gap-1.5"><AlertCircle size={13} className="shrink-0 mt-0.5" />{cur.provisional_reasons.join('; ')}</p>}
        {cur.dropped.length > 0 && <p className="mt-2 text-xs text-faint">Not enough data: {cur.dropped.map((d) => DIM_LABEL[d]).join(', ')} — dropped from the overall.</p>}
        <div className="mt-auto pt-3"><ScoreInfo dimension="overall" formula={OVERALL_FORMULA} /></div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {DIMS.map((d) => {
          const s = cur.dimensions[d]; const p = prev.dimensions[d].value;
          const dd = s.value != null && p != null ? s.value - p : null;
          return (
            <div key={d} className="card p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium text-muted">{DIM_LABEL[d]} <span className="text-faint">· {cur.weights[d]}%</span></p>
                {canOverride && <Button variant="ghost" size="sm" onClick={() => setEditing(d)} title="Adjust score"><PencilLine size={13} /></Button>}
              </div>
              <div className="flex items-baseline gap-2 mt-1">
                <span className={cx('text-2xl font-semibold tnum', scoreTone(s.value))}>{s.value ?? '—'}</span>
                {s.value == null && <span className="text-xs text-faint">Not enough data</span>}
                {dd != null && dd !== 0 && <span className={cx('text-xs tnum', dd > 0 ? 'text-success' : 'text-danger')}>{dd > 0 ? '+' : ''}{dd}</span>}
              </div>
              <div className="h-1.5 rounded-full bg-subtle mt-2 overflow-hidden"><div className={cx('h-full rounded-full bar-grow', barColor(s.value))} style={{ width: `${s.value ?? 0}%` }} /></div>
              <p className="text-[11px] text-muted mt-2 line-clamp-2 min-h-[2.2em]">{s.explanation[0]}</p>
              {s.override && <Badge tone="accent" className="mt-1.5">Adjusted by manager · was {s.override.original_value ?? '—'}</Badge>}
              <div className="mt-2"><ScoreInfo dimension={d} score={s} formula={view.formulas[d]} /></div>
            </div>
          );
        })}
      </div>
      {canOverride && editing && <OverrideModal userId={cur.user_id} period={cur.period_start} dimension={editing} current={cur.dimensions[editing]} onClose={() => setEditing(null)} onDone={() => { setEditing(null); onChanged?.(); }} />}
    </div>
  );
}

function OverrideModal({ userId, period, dimension, current, onClose, onDone }: { userId: number; period: string; dimension: Dimension; current: ScoreResult['dimensions'][Dimension]; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [value, setValue] = useState<number>(current.value ?? 50);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    if (reason.trim().length < 10) { setErr('Explain the adjustment (at least 10 characters) — it is shown to the employee.'); return; }
    setBusy(true);
    try { await api.performance.override(userId, period, dimension, value, reason); toast('Score adjusted — original value kept in the audit trail'); onDone(); }
    catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  const clear = async () => { setBusy(true); try { await api.performance.clearOverride(userId, period, dimension); toast('Adjustment removed'); onDone(); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); } };
  return (
    <Modal open onClose={onClose} title={`Adjust ${DIM_LABEL[dimension]} · week of ${fmtDate(period)}`}
      footer={<>{current.override && <Button variant="ghost" onClick={clear} disabled={busy} className="mr-auto">Remove adjustment</Button>}<Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save} loading={busy}>Save adjustment</Button></>}>
      <div className="space-y-4">
        <p className="text-xs text-muted">Calculated value: <span className="font-medium text-fg">{current.override ? current.override.original_value ?? '—' : current.value ?? 'Not enough data'}</span>. The original stays visible next to your adjustment.</p>
        <Field label={`New value: ${value}`}><input type="range" min={0} max={100} value={value} onChange={(e) => setValue(Number(e.target.value))} className="w-full accent-[rgb(var(--accent))]" /></Field>
        <Field label="Reason (required)" error={err}><textarea className="input" rows={3} value={reason} onChange={(e) => { setReason(e.target.value); setErr(null); }} placeholder="e.g. Two tasks were re-scoped mid-week at my request; on-time rate understates delivery." /></Field>
      </div>
    </Modal>
  );
}

/** Multi-line trend of the overall + dimension scores. Nulls render as gaps. */
export function ScoreTrend({ trend, height = 240 }: { trend: ScoreResult[]; height?: number }) {
  const data = trend.map((t) => ({ week: fmtDate(t.period_start), overall: t.overall, ...Object.fromEntries(DIMS.map((d) => [d, t.dimensions[d].value])) }));
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="week" tickLine={false} axisLine={false} />
          <YAxis domain={[0, 100]} tickLine={false} axisLine={false} />
          <Tooltip contentStyle={{ background: 'rgb(var(--surface))', border: '1px solid rgb(var(--border))', borderRadius: 8, fontSize: 12 }} />
          <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" iconSize={7} />
          <Line type="monotone" dataKey="overall" name="Overall" stroke="rgb(var(--fg))" strokeWidth={2.2} dot={{ r: 2.5 }} connectNulls={false} />
          {DIMS.map((d) => <Line key={d} type="monotone" dataKey={d} name={DIM_LABEL[d]} stroke={DIM_COLORS[d]} strokeWidth={1.4} dot={false} connectNulls={false} />)}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ProvisionalNote({ s }: { s: ScoreResult }) {
  if (!s.is_provisional) return null;
  return <Card className="border-warning/30 bg-warning-soft/40"><p className="text-xs text-warning flex gap-1.5"><AlertCircle size={13} className="mt-0.5" />Provisional: {s.provisional_reasons.join('; ')}</p></Card>;
}

/** Weekly scores as stored in performance_records (recomputed automatically after changes; "Recompute now" forces it). */
export function StoredRecords({ userId }: { userId?: number }) {
  const toast = useToast();
  const { data, loading, reload, setData } = useAsync(() => api.performance.records(userId), [userId]);
  useDataChanged(() => { setTimeout(reload, 1800); });
  const [busy, setBusy] = useState(false);
  const recompute = async () => {
    setBusy(true);
    try { setData(await api.performance.recompute(userId)); toast('Scores recomputed from current records'); }
    catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
  };
  const last = data?.[0]?.computed_at;
  return (
    <Card title="Stored weekly records" subtitle={last ? `Saved with their inputs · last computed ${relTime(last)} · updates automatically after changes` : 'Saved with their inputs'}
      action={<Button size="sm" icon={<RefreshCw size={13} className={busy ? 'animate-spin' : ''} />} onClick={recompute} disabled={busy}>Recompute now</Button>} bodyClass="px-0 pb-2 overflow-x-auto">
      {loading && !data ? <div className="px-4 text-xs text-faint">Loading…</div> : !data?.length ? <p className="px-4 text-xs text-faint">No stored records yet — click Recompute now.</p> : (
        <table className="w-full text-xs min-w-[640px]">
          <thead><tr className="text-faint text-left"><th className="font-medium px-4 py-1.5">Week of</th><th className="font-medium px-2">Overall</th>{DIMS.map((d) => <th key={d} className="font-medium px-2">{DIM_LABEL[d]}</th>)}<th className="font-medium px-2">Inputs</th></tr></thead>
          <tbody>
            {data.map((r) => {
              const p = r.inputs_json.dimensions.productivity.inputs;
              return (
                <tr key={r.period_start} className="border-t border-border">
                  <td className="px-4 py-2 tnum whitespace-nowrap">{fmtDate(r.period_start + 'T00:00:00')}</td>
                  <td className={cx('px-2 tnum font-semibold', scoreTone(r.overall))}>{r.overall ?? '—'}{r.is_provisional && r.overall != null && <span className="ml-1 text-[10px] text-warning font-normal">prov.</span>}</td>
                  {DIMS.map((d) => <td key={d} className={cx('px-2 tnum', scoreTone(r[d]))}>{r[d] ?? '—'}</td>)}
                  <td className="px-2 text-faint whitespace-nowrap">{p.eligible ?? 0} eligible · {p.completed ?? 0} done · {r.inputs_json.dimensions.quality.inputs.reviewed ?? 0} reviewed</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Card>
  );
}
