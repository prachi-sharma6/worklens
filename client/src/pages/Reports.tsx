import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertTriangle, ChevronLeft, ChevronRight, ClipboardCopy, Download, FileText, History, Save, X } from 'lucide-react';
import { api, type Report, type ReportHistoryItem, type TaskWithMeta } from '@/api';
import { Badge, Button, Card, EmptyState, ErrorState, PageSkeleton, PriorityIcon, StatusPill, Stat, VerifyPill, cx, scoreTone } from '@/components/ui';
import { errMsg, useAuth, useToast } from '@/context';
import { DIM_LABEL, DIMS, EVIDENCE_LABEL, dateKey, download, dueLabel, fmtDate, fmtDateTime, relTime, weekStartKey } from '@/lib/format';
import { useAsync, useDataChanged } from '@/lib/hooks';

export function DailyReports() { return <ReportPage kind="daily" />; }
export function WeeklyReports() { return <ReportPage kind="weekly" />; }

const shift = (key: string, days: number) => { const d = new Date(key + 'T00:00:00'); d.setDate(d.getDate() + days); return dateKey(d); };

function ReportPage({ kind }: { kind: 'daily' | 'weekly' }) {
  const { user } = useAuth();
  const toast = useToast();
  const isManager = user?.role === 'manager';
  const [params, setParams] = useSearchParams();
  const [key, setKey] = useState(() => (kind === 'daily' ? dateKey() : weekStartKey()));
  useEffect(() => { setKey(kind === 'daily' ? dateKey() : weekStartKey()); }, [kind]);
  const userParam = params.get('user');
  const target: number | null | undefined = isManager ? (userParam ? Number(userParam) : null) : undefined;

  const team = useAsync(() => (isManager ? api.users.team() : Promise.resolve([])), [isManager]);
  const live = useAsync(() => (kind === 'daily' ? api.reports.daily(key, target) : api.reports.weekly(key, target)), [kind, key, target]);
  const hist = useAsync(() => api.reports.history(kind, isManager ? target : undefined), [kind, target, isManager]);
  const [saved, setSaved] = useState<Report | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { setSaved((s) => (s && s.key === key ? s : null)); }, [kind, key, target]);
  const savedParam = params.get('saved');
  useEffect(() => {
    if (!savedParam) return;
    api.reports.saved(kind, Number(savedParam)).then((r) => { setSaved(r); setKey(r.key); }).catch((e) => toast(errMsg(e), 'error'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedParam, kind]);
  useDataChanged(() => { live.reload(); hist.reload(); });
  const data = saved ?? live.data;
  const { loading, error, reload } = live;
  const save = async () => {
    setSaving(true);
    try { const r = await api.reports.generate(kind, key, target); setSaved(r); hist.reload(); toast('Report generated and saved to history'); }
    catch (e) { toast(errMsg(e), 'error'); } finally { setSaving(false); }
  };
  const openSaved = async (h: ReportHistoryItem) => {
    try { setSaved(await api.reports.saved(kind, h.saved_id)); } catch (e) { toast(errMsg(e), 'error'); }
  };

  const md = useMemo(() => (data ? toMarkdown(data) : ''), [data]);
  const today = kind === 'daily' ? dateKey() : weekStartKey();
  const copy = async () => {
    try { await navigator.clipboard.writeText(md); toast('Report copied as Markdown'); } catch { toast('Clipboard is blocked in this browser — use Download instead', 'error'); }
  };
  const fileName = `worklens-${kind}-${key}${data?.data.user_name ? '-' + data.data.user_name.toLowerCase().replace(/\s+/g, '-') : isManager ? '-team' : ''}.md`;

  return (
    <div className="space-y-4">
      <div className="flex flex-col xl:flex-row xl:items-end justify-between gap-3">
        <div>
          <h1 className="h-page">{kind === 'daily' ? 'Daily Reports' : 'Weekly Reports'}</h1>
          <p className="text-xs text-muted mt-0.5">Built from your task records — nothing typed by hand, nothing invented.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isManager && (
            <select aria-label="Person" className="input h-9 w-auto text-xs" value={userParam ?? ''} onChange={(e) => { const p = new URLSearchParams(params); if (e.target.value) p.set('user', e.target.value); else p.delete('user'); setParams(p, { replace: true }); }}>
              <option value="">Team digest</option>
              {team.data?.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          )}
          <div className="flex items-center">
            <Button size="icon" variant="ghost" aria-label="Previous" onClick={() => setKey((k) => shift(k, kind === 'daily' ? -1 : -7))}><ChevronLeft size={16} /></Button>
            <input type="date" aria-label={kind === 'daily' ? 'Report date' : 'Any day in the week'} className="input h-9 w-[150px] text-xs" value={key} max={kind === 'daily' ? today : undefined}
              onChange={(e) => e.target.value && setKey(kind === 'daily' ? e.target.value : weekStartKey(e.target.value + 'T00:00:00'))} />
            <Button size="icon" variant="ghost" aria-label="Next" disabled={key >= today} onClick={() => setKey((k) => shift(k, kind === 'daily' ? 1 : 7))}><ChevronRight size={16} /></Button>
          </div>
          {key !== today && <Button size="sm" variant="ghost" onClick={() => setKey(today)}>{kind === 'daily' ? 'Today' : 'This week'}</Button>}
          <Button variant="primary" icon={<Save size={14} />} onClick={save} loading={saving}>Generate &amp; save</Button>
          <Button icon={<ClipboardCopy size={14} />} onClick={copy} disabled={!data}>Copy as Markdown</Button>
          <Button icon={<Download size={14} />} onClick={() => download(fileName, md)} disabled={!data}>Download .md</Button>
        </div>
      </div>

      {saved ? (
        <div className="card px-4 py-2.5 flex flex-wrap items-center gap-3 text-xs border-accent/30 bg-accent-soft/40">
          <History size={14} className="text-accent" />
          <span className="flex-1">Viewing the saved version from <b className="font-medium">{fmtDateTime(saved.generated_at)}</b>{saved.delivered_via ? ` · delivered via ${saved.delivered_via}` : ''}.</span>
          <Button size="sm" variant="ghost" icon={<X size={13} />} onClick={() => setSaved(null)}>Back to live preview</Button>
        </div>
      ) : (
        <p className="text-xs text-faint">Live preview, recalculated from current records. Generate &amp; save keeps a copy in history.</p>
      )}

      {error && !saved ? <ErrorState message={error} onRetry={reload} /> : loading && !data ? <PageSkeleton /> : data && <ReportView r={data} kind={kind} />}

      <Card title={<span className="flex items-center gap-1.5"><History size={14} className="text-faint" />Saved reports{hist.data ? ` (${hist.data.length})` : ''}</span>} subtitle="Regenerating the same period replaces the saved copy." bodyClass="px-2 pb-2">
        {!hist.data?.length ? <EmptyState icon={<History size={18} />} title="No saved reports yet" body="Use Generate & save to keep a copy of this report." /> : (
          <ul className="divide-y divide-border">
            {hist.data.map((h) => (
              <li key={h.saved_id}>
                <button onClick={() => openSaved(h)} className={cx('w-full text-left flex items-center gap-3 px-2 py-2.5 rounded-md hover:bg-subtle transition', saved?.saved_id === h.saved_id && 'bg-accent-soft/50')}>
                  <span className="text-xs font-medium tnum w-24 shrink-0">{kind === 'daily' ? fmtDate(h.key + 'T00:00:00', { weekday: 'short', month: 'short', day: 'numeric' }) : `Wk ${fmtDate(h.key + 'T00:00:00')}`}</span>
                  <span className="text-xs w-28 shrink-0 truncate">{h.user_name}</span>
                  <span className="flex-1 min-w-0 text-xs text-muted truncate hidden sm:block">{h.summary_text}</span>
                  <Badge tone={h.summary_source === 'ai' ? 'accent' : 'neutral'}>{h.summary_source === 'ai' ? 'AI' : 'Template'}</Badge>
                  <span className="text-[11px] text-faint w-16 text-right shrink-0" title={fmtDateTime(h.generated_at)}>{relTime(h.generated_at)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function ScoresTable({ scores }: { scores: NonNullable<Report['data']['scores']> }) {
  return (
    <Card title="Scores for this week" subtitle="From the scoring engine. Blank = not enough data. Alphabetical, not a ranking." bodyClass="px-0 pb-2 overflow-x-auto">
      <table className="w-full text-xs min-w-[560px]">
        <thead><tr className="text-faint text-left"><th className="font-medium px-4 py-1.5">Person</th><th className="font-medium px-2">Overall</th>{DIMS.map((d) => <th key={d} className="font-medium px-2">{DIM_LABEL[d]}</th>)}</tr></thead>
        <tbody>
          {[...scores].sort((a, b) => a.user_name.localeCompare(b.user_name)).map((s) => (
            <tr key={s.user_id} className="border-t border-border">
              <td className="px-4 py-2">{s.user_name}{s.is_provisional && <Badge tone="warning" className="ml-2">Provisional</Badge>}</td>
              <td className={cx('px-2 tnum font-semibold', scoreTone(s.overall))}>{s.overall ?? '—'}</td>
              {DIMS.map((d) => <td key={d} className={cx('px-2 tnum', scoreTone(s.dimensions[d]))}>{s.dimensions[d] ?? '—'}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function ReportView({ r, kind }: { r: Report; kind: 'daily' | 'weekly' }) {
  const d = r.data;
  const empty = !d.planned.length && !d.completed.length && !d.pending.length && !d.blocked.length;
  return (
    <div className="space-y-3">
      <Card title={<span className="capitalize">{d.user_name ?? 'Team'} · {d.period_label}</span>}
        action={r.summary_source === 'template' ? <Badge>Template summary — built from the records below</Badge> : <Badge tone="accent" >AI-generated by viaSocket AI from {d.ai?.records ?? d.completed.length + d.pending.length + d.blocked.length} records below</Badge>}>
        <p className="text-[13px] leading-relaxed text-muted">{r.summary_text}</p>
      </Card>
      {d.scores && d.scores.length > 0 && <ScoresTable scores={d.scores} />}
      {empty ? (
        <div className="card"><EmptyState icon={<FileText size={18} />} title={`No records for this ${kind === 'daily' ? 'day' : 'week'}`} body="Pick another date, or add tasks and they will show up here." /></div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <Stat label="Planned / due" value={d.planned.length} />
            <Stat label="Completed" value={d.completed.length} tone="success" />
            <Stat label="Pending" value={d.pending.length} />
            <Stat label="Blocked" value={d.blocked.length} tone={d.blocked.length ? 'danger' : undefined} />
            <Stat label="Impact points" value={d.impact_points} tone="accent" hint="Verified full, unverified ½" />
          </div>
          {d.needs_attention.length > 0 && (
            <Card title={<span className="flex items-center gap-1.5"><AlertTriangle size={14} className="text-warning" />Needs attention</span>}>
              <ul className="space-y-1 text-[13px] text-muted list-disc pl-5">{d.needs_attention.map((n, i) => <li key={i}>{n}</li>)}</ul>
            </Card>
          )}
          <div className="grid gap-3 lg:grid-cols-2">
            <TaskList title="Completed" tasks={d.completed} empty="Nothing completed." showVerify />
            <TaskList title="Planned / due" tasks={d.planned} empty="Nothing planned." />
            <TaskList title="Blocked" tasks={d.blocked} empty="No blockers." showBlocker />
            <TaskList title="Next priorities" tasks={d.next_priorities} empty="No upcoming work." />
          </div>
          <TaskList title="Still pending" tasks={d.pending} empty="Nothing pending." />
          <Card title={`Evidence submitted (${d.evidence.length})`}>
            {d.evidence.length === 0 ? <p className="text-xs text-faint">No evidence submitted in this period.</p> : (
              <ul className="divide-y divide-border">
                {d.evidence.map((e) => (
                  <li key={e.id} className="py-2 text-[13px] flex flex-wrap gap-x-2 items-baseline">
                    <span className="font-medium">{EVIDENCE_LABEL[e.type]}</span>
                    <Link to={`/tasks/${e.task_id}`} className="text-muted hover:text-accent truncate">{e.task_title}</Link>
                    {e.url && <a href={e.url} target="_blank" rel="noreferrer" className="text-xs text-accent hover:underline break-all">{e.url}</a>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

function TaskList({ title, tasks, empty, showVerify, showBlocker }: { title: string; tasks: TaskWithMeta[]; empty: string; showVerify?: boolean; showBlocker?: boolean }) {
  const [all, setAll] = useState(false);
  const shown = all ? tasks : tasks.slice(0, 8);
  return (
    <Card title={`${title} (${tasks.length})`} action={tasks.length > 8 && <Button size="sm" variant="ghost" onClick={() => setAll((a) => !a)}>{all ? 'Show less' : `Show all ${tasks.length}`}</Button>}>
      {tasks.length === 0 ? <p className="text-xs text-faint">{empty}</p> : (
        <ul className="divide-y divide-border">
          {shown.map((t) => (
            <li key={t.id} className="py-2 flex items-center gap-2.5">
              <PriorityIcon priority={t.priority} />
              <div className="min-w-0 flex-1">
                <Link to={`/tasks/${t.id}`} className="block truncate text-[13px] hover:text-accent">{t.title}</Link>
                <p className="text-[11px] text-faint truncate">
                  {t.user_name && <>{t.user_name} · </>}
                  {showBlocker && t.open_blocker ? `Waiting on ${t.open_blocker.dependency_name ?? 'unclear dependency'}` : t.status === 'completed' ? `Done ${fmtDate(t.completed_at)}` : <span className={t.is_overdue ? 'text-danger' : ''}>{dueLabel(t.deadline)}</span>}
                </p>
              </div>
              {showVerify ? <VerifyPill status={t.verification_status} /> : <StatusPill status={t.status} />}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function toMarkdown(r: Report) {
  const d = r.data;
  const line = (t: TaskWithMeta, extra = '') => `- ${t.title}${d.user_id == null && t.user_name ? ` — ${t.user_name}` : ''}${extra}`;
  const sec = (title: string, items: string[], empty: string) => `## ${title}\n${items.length ? items.join('\n') : `_${empty}_`}\n`;
  return [
    `# ${r.kind === 'daily' ? 'Daily' : 'Weekly'} report — ${d.user_name ?? 'Team'} — ${d.period_label}`,
    '',
    `> ${r.summary_text}`,
    `> _${r.summary_source === 'template' ? 'Template summary built from task records' : 'AI-generated from task records'}_`,
    '',
    `**Planned/due:** ${d.planned.length} · **Completed:** ${d.completed.length} · **Pending:** ${d.pending.length} · **Blocked:** ${d.blocked.length} · **Impact points:** ${d.impact_points}`,
    '',
    sec('Completed', d.completed.map((t) => line(t, ` (${t.verification_status.replace('_', ' ')}${t.evidence_count ? `, ${t.evidence_count} evidence` : ', no evidence'})`)), 'Nothing completed'),
    sec('Planned / due', d.planned.map((t) => line(t, ` (${t.status.replace('_', ' ')})`)), 'Nothing planned'),
    sec('Blocked', d.blocked.map((t) => line(t, t.open_blocker ? ` — waiting on ${t.open_blocker.dependency_name ?? 'unclear dependency'}` : ' (resolved)')), 'No blockers'),
    sec('Pending', d.pending.map((t) => line(t, ` — ${dueLabel(t.deadline)}`)), 'Nothing pending'),
    sec('Evidence', d.evidence.map((e) => `- ${EVIDENCE_LABEL[e.type]} — ${e.task_title ?? ''}${e.url ? ` — ${e.url}` : ''}`), 'No evidence submitted'),
    sec('Needs attention', d.needs_attention.map((n) => `- ${n}`), 'Nothing flagged'),
    sec('Next priorities', d.next_priorities.map((t) => line(t, ` — ${dueLabel(t.deadline)}`)), 'No upcoming work'),
    ...(d.scores?.length ? [sec('Scores (scoring engine)', [...d.scores].sort((x, y) => x.user_name.localeCompare(y.user_name)).map((x) => `- ${x.user_name}: overall ${x.overall ?? 'not enough data'}${x.is_provisional ? ' (provisional)' : ''} | ${DIMS.map((k) => `${DIM_LABEL[k]} ${x.dimensions[k] ?? '-'}`).join(', ')}`), '')] : []),
    `_Generated by WorkLens ${new Date(r.generated_at).toLocaleString()}_`,
  ].join('\n');
}
