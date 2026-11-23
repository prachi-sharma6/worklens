import { useMemo, useState } from 'react';
import { FileCheck2, Plus } from 'lucide-react';
import { api, type EvidenceType, type NewEvidence, type VerificationStatus } from '@/api';
import { Button, Card, EmptyState, ErrorState, Field, Modal, Skeleton, Stat, cx } from '@/components/ui';
import { EVIDENCE_TYPES, EvidenceForm, validateEvidence } from '@/components/tasks';
import { EvidenceItem } from './TaskDetails';
import { errMsg, useToast } from '@/context';
import { EVIDENCE_LABEL } from '@/lib/format';
import { emitDataChanged, useAsync, useDataChanged } from '@/lib/hooks';

export default function Evidence() {
  const { data, loading, error, reload } = useAsync(() => api.evidence.list(), []);
  useDataChanged(reload);
  const [type, setType] = useState<EvidenceType | 'all'>('all');
  const [open, setOpen] = useState(false);

  const list = useMemo(() => (data ?? []).filter((e) => type === 'all' || e.type === type), [data, type]);
  const count = (s: VerificationStatus) => new Set((data ?? []).filter((e) => e.verification_status === s).map((e) => e.task_id)).size;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="h-page">Work Evidence</h1>
          <p className="text-xs text-muted mt-0.5">Proof of outcomes your manager can verify. Verified work counts fully toward Quality and Impact.</p>
        </div>
        <Button variant="primary" icon={<Plus size={15} />} onClick={() => setOpen(true)}>Submit evidence</Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Evidence items" value={data ? data.length : '—'} />
        <Stat label="Tasks verified" value={data ? count('verified') : '—'} tone="success" />
        <Stat label="Pending review" value={data ? count('pending') : '—'} tone="accent" />
        <Stat label="Needs clarification" value={data ? count('clarification_requested') + count('rejected') : '—'} tone="warning" />
      </div>

      <div className="flex flex-wrap gap-1.5">
        {(['all', ...EVIDENCE_TYPES] as const).map((t) => {
          const n = t === 'all' ? data?.length : data?.filter((e) => e.type === t).length;
          return (
            <button key={t} onClick={() => setType(t)} className={cx('h-7 px-2.5 rounded-full border text-xs font-medium transition', type === t ? 'bg-accent text-accent-fg border-accent' : 'border-border text-muted hover:text-fg hover:bg-subtle')}>
              {t === 'all' ? 'All' : EVIDENCE_LABEL[t]} <span className="opacity-70 tnum">{n ?? ''}</span>
            </button>
          );
        })}
      </div>

      {error ? <ErrorState message={error} onRetry={reload} /> : loading && !data ? <div className="card p-3 space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-14" />)}</div> : (
        <Card>
          {list.length === 0 ? (
            <EmptyState icon={<FileCheck2 size={18} />} title={type === 'all' ? 'No evidence yet' : `No ${EVIDENCE_LABEL[type as EvidenceType].toLowerCase()} evidence`} body="Attach a PR, document, screenshot, test result or written explanation to a task." action={<Button variant="primary" icon={<Plus size={15} />} onClick={() => setOpen(true)}>Submit evidence</Button>} />
          ) : <ul className="divide-y divide-border -my-2">{list.map((e) => <EvidenceItem key={e.id} e={e} showTask canDelete={e.verification_status !== 'verified'} onDeleted={reload} />)}</ul>}
        </Card>
      )}

      {open && <SubmitEvidenceModal onClose={() => setOpen(false)} onDone={reload} />}
    </div>
  );
}

function SubmitEvidenceModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const tasks = useAsync(() => api.tasks.list({ sort: 'created' }), []);
  const [taskId, setTaskId] = useState<number | ''>('');
  const [v, setV] = useState<NewEvidence>({ type: 'github' });
  const [err, setErr] = useState<string | null>(null);
  const [taskErr, setTaskErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!taskId) { setTaskErr('Pick the task this evidence belongs to'); return; }
    const e = validateEvidence(v); if (e) { setErr(e); return; }
    setBusy(true);
    try { await api.evidence.add(taskId, v); toast('Evidence submitted'); emitDataChanged(); onDone(); onClose(); } catch (x) { setErr(errMsg(x)); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title="Submit evidence" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={submit} loading={busy}>Submit</Button></>}>
      <div className="space-y-3">
        <Field label="Task" error={taskErr} hint="Adding evidence to a completed task sends it for review.">
          <select className="input" value={taskId} onChange={(e) => { setTaskId(e.target.value ? Number(e.target.value) : ''); setTaskErr(null); }} disabled={!tasks.data}>
            <option value="">{tasks.data ? 'Choose a task…' : 'Loading tasks…'}</option>
            {tasks.data?.map((t) => <option key={t.id} value={t.id}>{t.status === 'completed' ? '✓ ' : ''}{t.title}</option>)}
          </select>
        </Field>
        <EvidenceForm value={v} onChange={(x) => { setV(x); setErr(null); }} error={err} />
      </div>
    </Modal>
  );
}
