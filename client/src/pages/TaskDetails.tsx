import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, CheckCircle2, ExternalLink, FileText, FlaskConical, Github, Image, MessageSquare, OctagonAlert, Package, PencilLine,
  Plus, Send, ShieldCheck, Star, Trash2, Unlock, FileSearch, Sparkles,
} from 'lucide-react';
import { api, type Blocker, type Evidence, type EvidenceType, type NewEvidence, type Priority, type ImpactLevel, type Review, type TaskWithMeta } from '@/api';
import { Avatar, Badge, Button, Card, EmptyState, ErrorState, Field, Modal, PageSkeleton, PriorityIcon, StatusPill, VerifyPill, cx } from '@/components/ui';
import { BlockerModal, DueText, EvidenceForm, StatusControl, WrapUpDialog, validateEvidence } from '@/components/tasks';
import { errMsg, useAuth, useToast } from '@/context';
import { EVIDENCE_LABEL, IMPACT_LABEL, PRIORITY_LABEL, cap, fmtDateTime, fmtMinutes, relTime } from '@/lib/format';
import { emitDataChanged, useAsync, useDataChanged } from '@/lib/hooks';

export const EVIDENCE_ICON: Record<EvidenceType, React.ElementType> = { github: Github, document: FileText, screenshot: Image, test_result: FlaskConical, deliverable: Package, explanation: MessageSquare };

export default function TaskDetails() {
  const { id } = useParams();
  const taskId = Number(id);
  const { user } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const { data, loading, error, reload } = useAsync(() => api.tasks.get(taskId), [taskId]);
  useDataChanged(reload);
  const [wrap, setWrap] = useState(false);
  const [block, setBlock] = useState(false);
  const [addEv, setAddEv] = useState(false);
  const [edit, setEdit] = useState(false);
  const [del, setDel] = useState(false);

  if (loading && !data) return <PageSkeleton />;
  if (error || !data) {
    if (error && /not found|forbidden/i.test(error)) return <div className="card"><EmptyState icon={<FileSearch size={18} />} title="Task not found" body="It may have been deleted, or it belongs to someone outside your team." action={<Button onClick={() => nav(-1)}>Go back</Button>} /></div>;
    return <ErrorState message={error ?? 'Unknown error'} onRetry={reload} />;
  }
  const { task, owner, evidence, comments, blockers, reviews, timeline } = data;
  const isOwner = user?.id === task.user_id;
  const isManager = user?.role === 'manager';
  const openBlocker = blockers.find((b) => b.status === 'open');

  const remove = async () => {
    try { await api.tasks.remove(task.id); toast('Task deleted'); emitDataChanged(); nav('/tasks'); } catch (e) { toast(errMsg(e), 'error'); }
  };

  return (
    <div className="space-y-4">
      <button onClick={() => nav(-1)} className="inline-flex items-center gap-1 text-xs text-muted hover:text-fg"><ArrowLeft size={13} /> Back</button>

      <div className="flex flex-col lg:flex-row lg:items-start gap-3 justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1.5">
            <StatusPill status={task.status} />
            {task.status === 'completed' && <VerifyPill status={task.verification_status} />}
            <PriorityIcon priority={task.priority} showLabel />
            <Badge>{cap(task.category)}</Badge>
            <DueText task={task} />
          </div>
          <h1 className="h-page break-words">{task.title}</h1>
          {isManager && !isOwner && (
            <Link to={`/people/${owner.id}`} className="mt-1.5 inline-flex items-center gap-1.5 text-xs text-muted hover:text-accent"><Avatar name={owner.name} color={owner.avatar_color} size={18} />{owner.name} · {owner.title}</Link>
          )}
        </div>
        {isOwner && (
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {task.status !== 'completed' && <StatusControl task={task} size="md" onChanged={reload} />}
            {task.status !== 'completed' && !openBlocker && <Button icon={<OctagonAlert size={14} />} onClick={() => setBlock(true)}>Report blocker</Button>}
            {task.status !== 'completed' && task.status !== 'blocked' && <Button variant="primary" icon={<CheckCircle2 size={14} />} onClick={() => setWrap(true)}>Complete</Button>}
            <Button variant="ghost" size="icon" title="Edit task" onClick={() => setEdit(true)}><PencilLine size={15} /></Button>
            <Button variant="ghost" size="icon" title="Delete task" onClick={() => setDel(true)}><Trash2 size={15} /></Button>
          </div>
        )}
      </div>

      {isOwner && task.status === 'completed' && (task.verification_status === 'clarification_requested' || task.verification_status === 'rejected') && (
        <ResubmitPanel task={task} note={reviews.length ? reviews[reviews.length - 1].note : null} hasEvidence={evidence.length > 0} onAddEvidence={() => setAddEv(true)} onDone={reload} />
      )}
      {isOwner && task.status === 'completed' && task.verification_status === 'unsubmitted' && (
        <div className="card border-warning/30 bg-warning-soft/40 p-3.5 text-xs text-warning flex flex-col sm:flex-row sm:items-center gap-2">
          <span className="flex-1">No evidence — this task won’t be reviewed or count toward verified quality until you add some.</span>
          <Button size="sm" icon={<Plus size={13} />} onClick={() => setAddEv(true)}>Add evidence</Button>
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-[1fr_340px]">
        <div className="space-y-3 min-w-0">
          <Card title="Details">
            {task.description && <p className="text-[13px] text-muted mb-4 whitespace-pre-wrap">{task.description}</p>}
            <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-3 text-[13px]">
              <Item label="Expected outcome" wide>{task.expected_outcome ?? <span className="text-faint">Not set</span>}</Item>
              <Item label="Actual outcome" wide>{task.actual_outcome ?? <span className="text-faint">{task.status === 'completed' ? 'Not recorded' : 'Recorded when completed'}</span>}</Item>
              <Item label="Impact">{IMPACT_LABEL[task.impact_level]}{task.impact_note && <span className="block text-xs text-muted">{task.impact_note}</span>}</Item>
              <Item label="Priority">{PRIORITY_LABEL[task.priority]}</Item>
              <Item label="Deadline">{fmtDateTime(task.deadline)}</Item>
              <Item label="Estimate / actual"><span className="tnum">{fmtMinutes(task.estimated_minutes)} / {fmtMinutes(task.actual_minutes)}</span><span className="block text-[11px] text-faint">Estimation accuracy only — never scored</span></Item>
              <Item label="Started">{fmtDateTime(task.started_at)}</Item>
              <Item label="Completed">{fmtDateTime(task.completed_at)}</Item>
              <Item label="Created">{fmtDateTime(task.created_at)}</Item>
              <Item label="Planned for">{task.planned_for_date ?? <span className="text-faint">Not planned</span>}</Item>
            </dl>
          </Card>

          {task.ai_suggestions_json && <AiSuggestionsCard task={task} isOwner={isOwner} onDone={reload} />}
          <Card title={`Evidence (${evidence.length})`} action={isOwner && <Button size="sm" icon={<Plus size={13} />} onClick={() => setAddEv(true)}>Add evidence</Button>}>
            {evidence.length === 0 ? <p className="text-xs text-faint py-2">No evidence yet. Links to PRs, docs, screenshots, test results or a written explanation make the work verifiable.</p>
              : <ul className="divide-y divide-border">{evidence.map((e) => <EvidenceItem key={e.id} e={e} canDelete={isOwner && task.verification_status !== 'verified'} onDeleted={reload} />)}</ul>}
          </Card>

          <Comments taskId={task.id} comments={comments} onAdded={reload} />
        </div>

        <div className="space-y-3 min-w-0">
          {isManager && !isOwner && task.status === 'completed' && <ReviewPanel task={task} onDone={reload} />}
          <BlockerPanel blockers={blockers} isOwner={isOwner} onChanged={reload} onReport={task.status !== 'completed' && !openBlocker && isOwner ? () => setBlock(true) : undefined} />
          <ReviewHistory reviews={reviews} />
          <Card title="Activity">
            {timeline.length === 0 ? <p className="text-xs text-faint">No activity yet.</p> : (
              <ol className="space-y-2.5">
                {timeline.map((e) => (
                  <li key={e.id} className="text-xs flex gap-2">
                    <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-accent shrink-0" />
                    <div className="min-w-0"><p className="text-fg">{e.title}</p>{e.detail && <p className="text-muted line-clamp-2">{e.detail}</p>}<p className="text-faint">{fmtDateTime(e.occurred_at)}</p></div>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>
      </div>

      {wrap && <WrapUpDialog task={task} open onClose={() => setWrap(false)} onDone={reload} />}
      {block && <BlockerModal task={task} open onClose={() => setBlock(false)} onDone={reload} />}
      {addEv && <AddEvidenceModal taskId={task.id} onClose={() => setAddEv(false)} onDone={reload} />}
      {edit && <EditTaskModal task={task} onClose={() => setEdit(false)} onDone={reload} />}
      <Modal open={del} onClose={() => setDel(false)} title="Delete task?" footer={<><Button onClick={() => setDel(false)}>Cancel</Button><Button variant="danger" onClick={remove}>Delete</Button></>}>
        <p className="text-sm text-muted">“{task.title}” will be removed from your task list and reports.</p>
      </Modal>
    </div>
  );
}

function AiSuggestionsCard({ task, isOwner, onDone }: { task: TaskWithMeta; isOwner: boolean; onDone: () => void }) {
  const toast = useToast();
  const sug = task.ai_suggestions_json!;
  const [pick, setPick] = useState<Record<'category' | 'expected_outcome' | 'impact_level', boolean>>({ category: sug.category !== task.category, expected_outcome: !task.expected_outcome, impact_level: sug.suggested_impact_level !== task.impact_level });
  const [busy, setBusy] = useState(false);
  const act = async (action: 'accept' | 'dismiss') => {
    setBusy(true);
    try {
      const fields = (Object.keys(pick) as (keyof typeof pick)[]).filter((k) => pick[k]);
      await api.tasks.aiSuggestions(task.id, action, action === 'accept' ? fields : []);
      toast(action === 'accept' ? (fields.length ? `Applied ${fields.length} suggestion${fields.length > 1 ? 's' : ''}` : 'Kept your values') : 'Suggestions dismissed');
      emitDataChanged(); onDone();
    } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
  };
  const rows: { key: keyof typeof pick; label: string; yours: string; ai: string }[] = [
    { key: 'category', label: 'Category', yours: cap(task.category), ai: cap(sug.category) },
    { key: 'expected_outcome', label: 'Expected outcome', yours: task.expected_outcome || '—', ai: sug.expected_outcome },
    { key: 'impact_level', label: 'Impact', yours: IMPACT_LABEL[task.impact_level], ai: IMPACT_LABEL[sug.suggested_impact_level] },
  ];
  const pending = sug.state === 'pending' || !sug.state;
  return (
    <Card title={<span className="flex items-center gap-1.5"><Sparkles size={14} className="text-accent" />AI suggestions</span>}
      subtitle={`AI-generated from this task’s title and description · ${sug.model ?? 'viaSocket AI'}${sug.generated_at ? ' · ' + relTime(sug.generated_at) : ''}`}
      action={!pending && <Badge tone={sug.state === 'accepted' ? 'success' : 'neutral'}>{sug.state === 'accepted' ? `Accepted${sug.applied?.length ? ` (${sug.applied.length})` : ''}` : 'Dismissed'}</Badge>}>
      <ul className="divide-y divide-border text-xs">
        {rows.map((r) => (
          <li key={r.key} className="py-2 grid sm:grid-cols-[120px_1fr] gap-1 sm:gap-3 items-start">
            <span className="text-faint">{r.label}</span>
            <label className={cx('flex items-start gap-2', pending && isOwner && 'cursor-pointer')}>
              {pending && isOwner && <input type="checkbox" className="mt-0.5 accent-[rgb(var(--accent))]" checked={pick[r.key]} onChange={(e) => setPick({ ...pick, [r.key]: e.target.checked })} />}
              <span><span className="text-fg">{r.ai}</span>{r.yours !== r.ai && <span className="block text-faint">Yours: {r.yours}</span>}</span>
            </label>
          </li>
        ))}
        <li className="py-2 grid sm:grid-cols-[120px_1fr] gap-1 sm:gap-3"><span className="text-faint">Why</span><span className="text-muted">{sug.impact_rationale}</span></li>
        <li className="py-2 grid sm:grid-cols-[120px_1fr] gap-1 sm:gap-3"><span className="text-faint">Measure it by</span><span className="text-muted">{sug.measurable_signal}</span></li>
      </ul>
      {pending && isOwner && (
        <div className="mt-3 flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => act('dismiss')} disabled={busy}>Dismiss</Button>
          <Button size="sm" variant="primary" onClick={() => act('accept')} loading={busy}>Apply selected</Button>
        </div>
      )}
      <p className="mt-2 text-[11px] text-faint">Suggestions never change your task until you apply them. AI never affects scores directly.</p>
    </Card>
  );
}

function ResubmitPanel({ task, note, hasEvidence, onAddEvidence, onDone }: { task: TaskWithMeta; note: string | null; hasEvidence: boolean; onAddEvidence: () => void; onDone: () => void }) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const rejected = task.verification_status === 'rejected';
  const submit = async () => {
    if (text.trim().length < 10) { setErr('Explain what changed (at least 10 characters)'); return; }
    setBusy(true); setErr(null);
    try { await api.tasks.resubmit(task.id, text); toast('Resubmitted — back in your manager’s review queue'); setText(''); emitDataChanged(); onDone(); }
    catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Card className="border-warning/40" title={<span className="flex items-center gap-1.5 text-warning"><MessageSquare size={14} />{rejected ? 'Your manager rejected this' : 'Your manager asked for clarification'}</span>}>
      {note && <p className="text-sm mb-3 border-l-2 border-warning/50 pl-3 text-muted">“{note}”</p>}
      <Field label="Your response" error={err} hint="Say what you changed or clarified. Add new evidence first if it helps.">
        <textarea className="input" rows={2} value={text} onChange={(e) => { setText(e.target.value); setErr(null); }} placeholder="e.g. Added the before/after numbers: p95 went from 1.8s to 380ms (see new screenshot)." />
      </Field>
      <div className="mt-3 flex flex-wrap gap-2 justify-end">
        <Button size="sm" icon={<Plus size={13} />} onClick={onAddEvidence}>Add evidence</Button>
        <Button size="sm" variant="primary" icon={<Send size={13} />} loading={busy} disabled={!hasEvidence} title={hasEvidence ? undefined : 'Add evidence first'} onClick={submit}>Resubmit for review</Button>
      </div>
    </Card>
  );
}

function Item({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return <div className={cx(wide && 'sm:col-span-2')}><dt className="text-[11px] font-medium text-faint uppercase tracking-wide mb-0.5">{label}</dt><dd>{children}</dd></div>;
}

export function EvidenceItem({ e, canDelete, onDeleted, showTask }: { e: Evidence; canDelete?: boolean; onDeleted?: () => void; showTask?: boolean }) {
  const toast = useToast();
  const Icon = EVIDENCE_ICON[e.type];
  const remove = async () => { try { await api.evidence.remove(e.id); toast('Evidence removed'); emitDataChanged(); onDeleted?.(); } catch (err) { toast(errMsg(err), 'error'); } };
  return (
    <li className="py-2.5 flex gap-3 items-start">
      <span className="h-7 w-7 rounded-md bg-subtle flex items-center justify-center text-muted shrink-0"><Icon size={14} /></span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-medium">{EVIDENCE_LABEL[e.type]}</span>
          {showTask && e.task_title && <Link to={`/tasks/${e.task_id}`} className="text-xs text-muted hover:text-accent truncate">· {e.task_title}</Link>}
          {e.verification_status && <VerifyPill status={e.verification_status} />}
        </div>
        {e.url && <a href={e.url} target="_blank" rel="noreferrer" className="text-xs text-accent hover:underline inline-flex items-center gap-1 break-all">{e.url}<ExternalLink size={11} className="shrink-0" /></a>}
        {e.file_path && <a href={`/api/evidence/${e.id}/file`} target="_blank" rel="noreferrer" className="text-xs text-accent hover:underline">Open attached file</a>}
        {e.note && <p className="text-xs text-muted mt-0.5 whitespace-pre-wrap">{e.note}</p>}
        <p className="text-[11px] text-faint mt-0.5">Submitted {relTime(e.submitted_at)}</p>
      </div>
      {canDelete && <button onClick={remove} className="text-faint hover:text-danger" aria-label="Remove evidence" title="Remove evidence"><Trash2 size={14} /></button>}
    </li>
  );
}

export function AddEvidenceModal({ taskId, onClose, onDone }: { taskId: number; onClose: () => void; onDone?: () => void }) {
  const toast = useToast();
  const [v, setV] = useState<NewEvidence>({ type: 'github' });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const e = validateEvidence(v); if (e) { setErr(e); return; }
    setBusy(true);
    try { await api.evidence.add(taskId, v); toast('Evidence added'); emitDataChanged(); onDone?.(); onClose(); } catch (x) { setErr(errMsg(x)); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title="Add evidence" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={submit} loading={busy}>Submit evidence</Button></>}>
      <EvidenceForm value={v} onChange={(x) => { setV(x); setErr(null); }} error={err} />
    </Modal>
  );
}

function EditTaskModal({ task, onClose, onDone }: { task: TaskWithMeta; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const toLocal = (v: string | null) => { if (!v) return ''; const d = new Date(v); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
  const [f, setF] = useState({ title: task.title, description: task.description ?? '', expected_outcome: task.expected_outcome ?? '', priority: task.priority, impact_level: task.impact_level, impact_note: task.impact_note ?? '', deadline: toLocal(task.deadline), estimated_minutes: task.estimated_minutes ?? '' as number | '' });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!f.title.trim()) { setErr('Title is required'); return; }
    setBusy(true);
    try {
      await api.tasks.update(task.id, { title: f.title.trim(), description: f.description || null, expected_outcome: f.expected_outcome || null, priority: f.priority, impact_level: f.impact_level, impact_note: f.impact_note || null, deadline: f.deadline ? new Date(f.deadline).toISOString() : null, estimated_minutes: f.estimated_minutes === '' ? null : Number(f.estimated_minutes) });
      toast('Task updated'); emitDataChanged(); onDone(); onClose();
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title="Edit task" width="max-w-xl" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save} loading={busy}>Save</Button></>}>
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Title" className="sm:col-span-2" error={err}><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <Field label="Description" className="sm:col-span-2"><textarea className="input" rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <Field label="Expected outcome" className="sm:col-span-2"><input className="input" value={f.expected_outcome} onChange={(e) => setF({ ...f, expected_outcome: e.target.value })} /></Field>
        <Field label="Priority"><select className="input" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value as Priority })}>{['low', 'medium', 'high', 'critical'].map((p) => <option key={p} value={p}>{cap(p)}</option>)}</select></Field>
        <Field label="Impact"><select className="input" value={f.impact_level} onChange={(e) => setF({ ...f, impact_level: e.target.value as ImpactLevel })}>{['low', 'medium', 'high'].map((p) => <option key={p} value={p}>{cap(p)}</option>)}</select></Field>
        <Field label="Deadline"><input type="datetime-local" className="input" value={f.deadline} onChange={(e) => setF({ ...f, deadline: e.target.value })} /></Field>
        <Field label="Estimate (minutes)"><input type="number" min={0} step={5} className="input" value={f.estimated_minutes} onChange={(e) => setF({ ...f, estimated_minutes: e.target.value === '' ? '' : Number(e.target.value) })} /></Field>
        <Field label="Impact note" className="sm:col-span-2"><input className="input" value={f.impact_note} onChange={(e) => setF({ ...f, impact_note: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

function Comments({ taskId, comments, onAdded }: { taskId: number; comments: { id: number; body: string; kind: string; created_at: string; author_name?: string; author_id: number }[]; onAdded: () => void }) {
  const toast = useToast();
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async (e: React.FormEvent) => {
    e.preventDefault(); if (!body.trim()) return;
    setBusy(true);
    try { await api.comments.add(taskId, body); setBody(''); emitDataChanged(); onAdded(); } catch (x) { toast(errMsg(x), 'error'); } finally { setBusy(false); }
  };
  return (
    <Card title={`Comments (${comments.length})`}>
      {comments.length > 0 && (
        <ul className="space-y-3 mb-4">
          {comments.map((c) => (
            <li key={c.id} className="flex gap-2.5">
              <Avatar name={c.author_name ?? '?'} size={24} />
              <div className="min-w-0 flex-1">
                <p className="text-xs"><span className="font-medium text-fg">{c.author_name}</span> <span className="text-faint">· {relTime(c.created_at)}</span>
                  {c.kind !== 'comment' && <Badge tone={c.kind === 'clarification' ? 'warning' : 'success'} className="ml-1.5">{c.kind === 'clarification' ? 'Review note' : 'Decision'}</Badge>}</p>
                <p className="text-[13px] text-muted mt-0.5 whitespace-pre-wrap">{c.body}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={send} className="flex gap-2">
        <input className="input" placeholder="Write a comment…" value={body} onChange={(e) => setBody(e.target.value)} />
        <Button type="submit" variant="primary" loading={busy} disabled={!body.trim()} icon={<Send size={14} />}><span className="hidden sm:inline">Send</span></Button>
      </form>
    </Card>
  );
}

function BlockerPanel({ blockers, isOwner, onChanged, onReport }: { blockers: Blocker[]; isOwner: boolean; onChanged: () => void; onReport?: () => void }) {
  const toast = useToast();
  const [resolving, setResolving] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const resolve = async () => {
    if (resolving == null) return;
    setBusy(true);
    try { await api.blockers.resolve(resolving, note.trim()); toast('Blocker resolved — task back in progress'); setResolving(null); setNote(''); emitDataChanged(); onChanged(); } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
  };
  return (
    <Card title="Blockers" action={onReport && <Button size="sm" icon={<OctagonAlert size={13} />} onClick={onReport}>Report</Button>}>
      {blockers.length === 0 ? <p className="text-xs text-faint">No blockers reported.</p> : (
        <ul className="space-y-3">
          {blockers.map((b) => {
            const hours = Math.round(((b.resolved_at ? +new Date(b.resolved_at) : Date.now()) - +new Date(b.opened_at)) / 3600000);
            return (
              <li key={b.id} className={cx('rounded-md border p-3 text-xs', b.status === 'open' ? 'border-danger/30 bg-danger-soft/40' : 'border-border')}>
                <div className="flex flex-wrap items-center gap-1.5 mb-1">
                  <Badge tone={b.status === 'open' ? 'danger' : 'success'}>{b.status === 'open' ? 'Open' : 'Resolved'}</Badge>
                  <Badge>{b.dependency_type === 'unclear' ? 'Unclear dependency' : cap(b.dependency_type)}</Badge>
                  {b.is_external && <Badge tone="warning">External</Badge>}
                  <span className="text-faint tnum">{b.status === 'open' ? `open ${hours}h` : `took ${hours}h`}</span>
                </div>
                <p className="text-fg">{b.description}</p>
                {b.dependency_name && <p className="text-muted mt-0.5">Waiting on: {b.dependency_name}</p>}
                {b.ai_extraction_json && (
                  <p className="mt-1 text-accent flex items-start gap-1"><Sparkles size={11} className="mt-0.5 shrink-0" />
                    <span>AI reading: {b.ai_extraction_json.dependency_name ? <>waiting on <b className="font-medium">{b.ai_extraction_json.dependency_name}</b> ({b.ai_extraction_json.dependency_type}{b.ai_extraction_json.is_external && b.ai_extraction_json.dependency_type !== 'external' ? ', external' : ''},{b.ai_extraction_json.confidence} confidence)</> : 'no dependency named in the text'} — <span className="text-faint">{b.ai_extraction_json.note}</span></span>
                  </p>
                )}
                {b.resolution_note && <p className="text-muted mt-1">Resolution: {b.resolution_note}</p>}
                <p className="text-faint mt-1">Opened {fmtDateTime(b.opened_at)}{b.resolved_at && ` · resolved ${fmtDateTime(b.resolved_at)}`}</p>
                {isOwner && b.status === 'open' && (resolving === b.id ? (
                  <div className="mt-2 space-y-2">
                    <input className="input h-8 text-xs" autoFocus placeholder="How was it resolved?" value={note} onChange={(e) => setNote(e.target.value)} />
                    <div className="flex gap-2 justify-end"><Button size="sm" onClick={() => setResolving(null)}>Cancel</Button><Button size="sm" variant="primary" loading={busy} onClick={resolve}>Mark resolved</Button></div>
                  </div>
                ) : <Button size="sm" className="mt-2" icon={<Unlock size={13} />} onClick={() => setResolving(b.id)}>Resolve</Button>)}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function ReviewHistory({ reviews }: { reviews: Review[] }) {
  return (
    <Card title="Review history">
      {reviews.length === 0 ? <p className="text-xs text-faint">Not reviewed yet.</p> : (
        <ul className="space-y-3">
          {[...reviews].reverse().map((r) => (
            <li key={r.id} className="text-xs">
              <div className="flex items-center gap-1.5 flex-wrap">
                <VerifyPill status={r.decision} />
                {r.quality_rating != null && <span className="inline-flex items-center gap-0.5 text-warning tnum"><Star size={11} className="fill-current" />{r.quality_rating}/5</span>}
                <span className="text-faint">{r.manager_name} · {relTime(r.created_at)}</span>
              </div>
              {r.note && <p className="text-muted mt-1">{r.note}</p>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function ReviewPanel({ task, onDone }: { task: TaskWithMeta; onDone: () => void }) {
  const toast = useToast();
  const [note, setNote] = useState('');
  const [rating, setRating] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const decide = async (decision: Review['decision']) => {
    if (decision !== 'verified' && !note.trim()) { setErr('Add a note explaining what is needed'); return; }
    setBusy(decision); setErr(null);
    try {
      await api.reviews.submit(task.id, { decision, note: note.trim() || undefined, quality_rating: rating });
      toast(decision === 'verified' ? 'Verified' : decision === 'rejected' ? 'Rejected — employee notified in-app' : 'Clarification requested');
      setNote(''); setRating(null); emitDataChanged(); onDone();
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(null); }
  };
  return (
    <Card title={<span className="flex items-center gap-1.5"><ShieldCheck size={15} className="text-accent" />Review</span>} subtitle={task.verification_status === 'pending' ? 'Waiting for your decision' : 'Already reviewed — you can update the decision'} className="border-accent/30">
      {task.evidence_count === 0 && <p className="text-xs text-warning mb-2">No evidence attached.</p>}
      <Field label="Note (required to reject or request clarification)" error={err}>
        <textarea className="input" rows={2} value={note} onChange={(e) => { setNote(e.target.value); setErr(null); }} />
      </Field>
      <div className="mt-3">
        <p className="label">Quality rating (optional)</p>
        <div className="flex gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} onClick={() => setRating(rating === n ? null : n)} aria-label={`${n} stars`} className={cx('h-7 w-7 rounded-md border flex items-center justify-center transition', rating != null && n <= rating ? 'border-warning/40 bg-warning-soft text-warning' : 'border-border text-faint hover:text-warning')}>
              <Star size={13} className={cx(rating != null && n <= rating && 'fill-current')} />
            </button>
          ))}
        </div>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-2">
        <Button variant="primary" loading={busy === 'verified'} disabled={!!busy} onClick={() => decide('verified')} icon={<ShieldCheck size={14} />}>Verify</Button>
        <div className="grid grid-cols-2 gap-2">
          <Button loading={busy === 'clarification_requested'} disabled={!!busy} onClick={() => decide('clarification_requested')}>Ask to clarify</Button>
          <Button variant="danger" loading={busy === 'rejected'} disabled={!!busy} onClick={() => decide('rejected')}>Reject</Button>
        </div>
      </div>
    </Card>
  );
}
