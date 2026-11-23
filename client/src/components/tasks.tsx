import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, FileCheck2, Paperclip, Plus, Trash2 } from 'lucide-react';
import { api, type DependencyType, type EvidenceType, type NewEvidence, type TaskStatus, type TaskWithMeta } from '@/api';
import { Badge, Button, Field, Modal, PriorityIcon, StatusPill, Toggle, VerifyPill, cx } from '@/components/ui';
import { errMsg, useToast } from '@/context';
import { cap, dueLabel, EVIDENCE_LABEL, STATUS_LABEL } from '@/lib/format';
import { emitDataChanged } from '@/lib/hooks';

export const EVIDENCE_TYPES: EvidenceType[] = ['github', 'document', 'screenshot', 'test_result', 'deliverable', 'explanation'];
const GITHUB_RE = /^https:\/\/github\.com\/[^/]+\/[^/]+\/(pull\/\d+|commit\/[0-9a-f]{7,40})/i;
const URL_RE = /^https?:\/\/\S+\.\S+/i;
const MAX_FILE = 5 * 1024 * 1024;
const FILE_TYPES = ['image/png', 'image/jpeg', 'application/pdf'];

/** Client-side validation that mirrors the server rules. Returns an error message or null. */
export function validateEvidence(e: NewEvidence): string | null {
  switch (e.type) {
    case 'github': return GITHUB_RE.test(e.url ?? '') ? null : 'Enter a GitHub pull request or commit URL (https://github.com/org/repo/pull/123)';
    case 'document':
    case 'deliverable': return URL_RE.test(e.url ?? '') ? null : 'Enter a valid link starting with http(s)://';
    case 'screenshot':
      if (!e.file) return 'Choose a PNG, JPEG or PDF file';
      if (!FILE_TYPES.includes(e.file.type)) return 'Only PNG, JPEG or PDF files are allowed';
      if (e.file.size > MAX_FILE) return 'File is larger than 5 MB';
      return null;
    case 'test_result': return (e.note ?? '').trim() || URL_RE.test(e.url ?? '') ? null : 'Paste the test output or a link to the test run';
    case 'explanation': return (e.note ?? '').trim().length >= 30 ? null : 'Write at least 30 characters explaining what changed and how it was checked';
  }
}

/** Controlled editor for one evidence item. */
export function EvidenceForm({ value, onChange, error }: { value: NewEvidence; onChange: (v: NewEvidence) => void; error?: string | null }) {
  const set = (p: Partial<NewEvidence>) => onChange({ ...value, ...p });
  return (
    <div className="space-y-3">
      <Field label="Evidence type">
        <select className="input" value={value.type} onChange={(e) => onChange({ type: e.target.value as EvidenceType })}>
          {EVIDENCE_TYPES.map((t) => <option key={t} value={t}>{EVIDENCE_LABEL[t]}</option>)}
        </select>
      </Field>
      {(value.type === 'github' || value.type === 'document' || value.type === 'deliverable' || value.type === 'test_result') && (
        <Field label={value.type === 'github' ? 'Pull request or commit URL' : value.type === 'test_result' ? 'Link to test run (optional if you paste output)' : 'Link'}>
          <input className="input" value={value.url ?? ''} placeholder={value.type === 'github' ? 'https://github.com/org/repo/pull/123' : 'https://…'} onChange={(e) => set({ url: e.target.value })} />
        </Field>
      )}
      {value.type === 'screenshot' && (
        <Field label="File (PNG, JPEG or PDF, max 5 MB)">
          <input type="file" accept="image/png,image/jpeg,application/pdf" className="block w-full text-xs text-muted file:mr-3 file:h-8 file:px-3 file:rounded-md file:border file:border-border file:bg-surface file:text-fg file:text-xs file:font-medium"
            onChange={(e) => set({ file: e.target.files?.[0] ?? null })} />
        </Field>
      )}
      {(value.type === 'test_result' || value.type === 'explanation' || value.type === 'screenshot' || value.type === 'deliverable' || value.type === 'document') && (
        <Field label={value.type === 'explanation' ? 'Explanation (min 30 characters)' : value.type === 'test_result' ? 'Test output / summary' : 'Note (optional)'}
          hint={value.type === 'explanation' ? `${(value.note ?? '').trim().length}/30 characters` : undefined}>
          <textarea className="input" rows={value.type === 'explanation' || value.type === 'test_result' ? 3 : 2} value={value.note ?? ''} onChange={(e) => set({ note: e.target.value })}
            placeholder={value.type === 'explanation' ? 'What changed, and how did you verify the outcome?' : value.type === 'test_result' ? 'e.g. 214 passed, 0 failed' : ''} />
        </Field>
      )}
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}

/** Completion "wrap up": outcome, optional time, zero or more evidence items. */
export function WrapUpDialog({ task, open, onClose, onDone }: { task: TaskWithMeta; open: boolean; onClose: () => void; onDone?: () => void }) {
  const toast = useToast();
  const [outcome, setOutcome] = useState(task.expected_outcome ?? '');
  const [minutes, setMinutes] = useState<string>('');
  const [items, setItems] = useState<NewEvidence[]>([]);
  const [errors, setErrors] = useState<(string | null)[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const hasEvidence = items.length > 0 || task.evidence_count > 0;

  const submit = async () => {
    if (!outcome.trim()) { setErr('Describe the actual outcome'); return; }
    const errs = items.map(validateEvidence);
    setErrors(errs);
    if (errs.some(Boolean)) return;
    setBusy(true); setErr(null);
    try {
      await api.tasks.complete(task.id, { actual_outcome: outcome.trim(), actual_minutes: minutes ? Number(minutes) : null, evidence: items });
      toast(hasEvidence ? 'Task completed — sent for review' : 'Task completed — flagged “No evidence”', hasEvidence ? 'success' : 'info');
      emitDataChanged(); onDone?.(); onClose();
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title={`Wrap up: ${task.title}`} width="max-w-xl"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={submit} loading={busy}>Complete task</Button></>}>
      <div className="space-y-4">
        <Field label="Actual outcome" hint={task.expected_outcome ? `Expected: ${task.expected_outcome}` : undefined}>
          <textarea className="input" rows={2} value={outcome} onChange={(e) => { setOutcome(e.target.value); setErr(null); }} />
        </Field>
        <Field label="Actual time (minutes, optional)" hint="Shown for estimation accuracy only — hours never raise a score.">
          <input type="number" min={0} step={5} className="input max-w-[160px]" value={minutes} onChange={(e) => setMinutes(e.target.value)} />
        </Field>
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="label mb-0">Evidence {task.evidence_count > 0 && <span className="text-faint">· {task.evidence_count} already attached</span>}</p>
            <Button size="sm" icon={<Plus size={13} />} onClick={() => setItems((s) => [...s, { type: 'github' }])}>Add evidence</Button>
          </div>
          <div className="space-y-3">
            {items.map((it, i) => (
              <div key={i} className="rounded-md border border-border p-3 relative">
                <button className="absolute top-2 right-2 text-faint hover:text-danger" aria-label="Remove evidence" onClick={() => { setItems((s) => s.filter((_, j) => j !== i)); setErrors((s) => s.filter((_, j) => j !== i)); }}><Trash2 size={14} /></button>
                <EvidenceForm value={it} error={errors[i]} onChange={(v) => { setItems((s) => s.map((x, j) => (j === i ? v : x))); setErrors((s) => s.map((x, j) => (j === i ? null : x))); }} />
              </div>
            ))}
          </div>
          {!hasEvidence && (
            <p className="mt-2 text-xs text-warning flex gap-1.5"><AlertTriangle size={13} className="shrink-0 mt-0.5" />Completing without evidence is allowed, but the task will be flagged “No evidence” and won’t go to review.</p>
          )}
        </div>
        {err && <p className="text-xs text-danger">{err}</p>}
      </div>
    </Modal>
  );
}

/** Report a blocker on a task. */
export function BlockerModal({ task, open, onClose, onDone }: { task: Pick<TaskWithMeta, 'id' | 'title'>; open: boolean; onClose: () => void; onDone?: () => void }) {
  const toast = useToast();
  const [desc, setDesc] = useState('');
  const [type, setType] = useState<DependencyType>('person');
  const [name, setName] = useState('');
  const [external, setExternal] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (desc.trim().length < 5) { setErr('Describe what is blocking you'); return; }
    setBusy(true); setErr(null);
    try {
      await api.blockers.open(task.id, { description: desc, dependency_type: type, dependency_name: name, is_external: external || type === 'external' });
      toast('Blocker reported — your manager can see it'); emitDataChanged(); onDone?.(); onClose();
      setDesc(''); setName('');
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title={`Report blocker: ${task.title}`}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="danger" onClick={submit} loading={busy}>Report blocker</Button></>}>
      <div className="space-y-3">
        <Field label="What is blocking you?"><textarea className="input" rows={3} autoFocus value={desc} onChange={(e) => { setDesc(e.target.value); setErr(null); }} placeholder="e.g. Waiting for Razorpay to confirm the webhook signature change" /></Field>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Dependency type">
            <select className="input" value={type} onChange={(e) => { const v = e.target.value as DependencyType; setType(v); if (v === 'external') setExternal(true); }}>
              {(['person', 'team', 'external', 'tool', 'unclear'] as DependencyType[]).map((d) => <option key={d} value={d}>{d === 'unclear' ? 'Not sure yet' : cap(d)}</option>)}
            </select>
          </Field>
          <Field label="Who / what (name)" hint="Naming the dependency counts toward Ownership."><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Platform team, AWS support" /></Field>
        </div>
        <div className="flex items-center justify-between rounded-md border border-border px-3 py-2.5">
          <div><p className="text-sm font-medium">External dependency</p><p className="text-xs text-faint">Outside the company. Blocked time won’t count against completion or on-time rate.</p></div>
          <Toggle checked={external || type === 'external'} onChange={setExternal} label="External dependency" />
        </div>
        {err && <p className="text-xs text-danger">{err}</p>}
      </div>
    </Modal>
  );
}

/** Status select that routes "blocked" and "completed" through their dialogs. */
export function StatusControl({ task, size = 'sm', onChanged }: { task: TaskWithMeta; size?: 'sm' | 'md'; onChanged?: () => void }) {
  const toast = useToast();
  const [wrap, setWrap] = useState(false);
  const [block, setBlock] = useState(false);
  const [busy, setBusy] = useState(false);
  const change = async (s: TaskStatus) => {
    if (s === task.status) return;
    if (s === 'completed') { setWrap(true); return; }
    if (s === 'blocked') { setBlock(true); return; }
    setBusy(true);
    try { await api.tasks.setStatus(task.id, s); toast(`Moved to ${STATUS_LABEL[s]}`); emitDataChanged(); onChanged?.(); }
    catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
  };
  if (task.status === 'completed') return <StatusPill status="completed" />;
  return (
    <>
      <select aria-label="Change status" disabled={busy || task.status === 'blocked'} title={task.status === 'blocked' ? 'Resolve the blocker on the task page first' : 'Change status'}
        className={cx('input w-auto pr-7 text-xs', size === 'sm' ? 'h-7 px-2' : 'h-9')} value={task.status} onChange={(e) => change(e.target.value as TaskStatus)} onClick={(e) => e.stopPropagation()}>
        {(['not_started', 'in_progress', 'blocked', 'completed'] as TaskStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
      </select>
      {wrap && <WrapUpDialog task={task} open onClose={() => setWrap(false)} onDone={onChanged} />}
      {block && <BlockerModal task={task} open onClose={() => setBlock(false)} onDone={onChanged} />}
    </>
  );
}

export function DueText({ task }: { task: TaskWithMeta }) {
  if (task.status === 'completed') return <span className="text-xs text-faint">Done</span>;
  return <span className={cx('text-xs tnum', task.is_overdue ? 'text-danger font-medium' : 'text-muted')}>{dueLabel(task.deadline)}</span>;
}

export function TaskMetaBadges({ task }: { task: TaskWithMeta }) {
  return (
    <>
      {task.status === 'completed' && <VerifyPill status={task.verification_status} />}
      {task.open_blocker && task.open_blocker.is_external && <Badge tone="danger">External</Badge>}
      {task.evidence_count > 0 && <span className="inline-flex items-center gap-0.5 text-[11px] text-faint"><Paperclip size={11} />{task.evidence_count}</span>}
    </>
  );
}

/** Table-ish row on desktop, stacked card on mobile. */
export function TaskRow({ task, onChanged, showOwner }: { task: TaskWithMeta; onChanged?: () => void; showOwner?: boolean }) {
  return (
    <div className={cx('group flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 px-4 py-3 border-b border-border last:border-0 hover:bg-subtle/60 transition', task.is_overdue && 'bg-danger-soft/30')}>
      <div className="flex items-center gap-2.5 min-w-0 flex-1">
        <PriorityIcon priority={task.priority} />
        <div className="min-w-0">
          <Link to={`/tasks/${task.id}`} className="block truncate text-[13px] font-medium hover:text-accent">{task.title}</Link>
          <div className="flex flex-wrap items-center gap-1.5 mt-0.5 text-[11px] text-faint">
            <span>{cap(task.category)}</span>
            {showOwner && task.user_name && <span>· {task.user_name}</span>}
            <TaskMetaBadges task={task} />
          </div>
        </div>
      </div>
      <div className="flex items-center gap-3 sm:justify-end pl-6 sm:pl-0">
        <DueText task={task} />
        <StatusControl task={task} onChanged={onChanged} />
      </div>
    </div>
  );
}

export function EvidenceTypeIcon() {
  return <FileCheck2 size={14} />;
}
