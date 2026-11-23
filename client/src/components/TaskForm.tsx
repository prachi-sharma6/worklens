import { useState } from 'react';
import { ChevronDown, ChevronRight, Plus } from 'lucide-react';
import { api, type NewTask, type TaskWithMeta } from '@/api';
import { Button, Field, Toggle, cx } from '@/components/ui';
import { errMsg, useToast } from '@/context';
import { CATEGORIES, cap } from '@/lib/format';
import { emitDataChanged } from '@/lib/hooks';

/** Quick-add (title + Enter) with an expandable full form. Used by the Create Task page and the global slide-over. */
export function TaskForm({ onCreated, defaultExpanded = false, autoFocus = true }: { onCreated?: (t: TaskWithMeta) => void; defaultExpanded?: boolean; autoFocus?: boolean }) {
  const toast = useToast();
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const empty: NewTask = { title: '', description: '', category: '', priority: 'medium', expected_outcome: '', estimated_minutes: undefined, deadline: undefined, impact_level: 'medium', impact_note: '', is_planned_today: true };
  const [f, setF] = useState<NewTask>(empty);
  const set = <K extends keyof NewTask>(k: K, v: NewTask[K]) => setF((s) => ({ ...s, [k]: v }));

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (!f.title.trim()) { setError('Give the task a title'); return; }
    setSaving(true); setError(null);
    try {
      const t = await api.tasks.create({ ...f, deadline: f.deadline ? new Date(f.deadline).toISOString() : undefined, category: f.category || undefined });
      toast(`Task created: ${t.title}`);
      setF(empty);
      emitDataChanged();
      onCreated?.(t);
    } catch (err) { setError(errMsg(err)); } finally { setSaving(false); }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label className="label" htmlFor="task-title">What are you working on?</label>
        <div className="flex gap-2">
          <input id="task-title" autoFocus={autoFocus} className="input h-10 text-[15px]" placeholder="e.g. Fix checkout timeout on slow networks" value={f.title}
            onChange={(e) => { set('title', e.target.value); setError(null); }} />
          <Button type="submit" variant="primary" loading={saving} icon={<Plus size={15} />} className="h-10">Add</Button>
        </div>
        {error ? <p className="mt-1 text-xs text-danger">{error}</p> : <p className="mt-1 text-xs text-faint">Press Enter to save with defaults, or add details below.</p>}
      </div>

      <button type="button" onClick={() => setExpanded((x) => !x)} className="flex items-center gap-1 text-xs font-medium text-muted hover:text-fg">
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />} {expanded ? 'Hide details' : 'Add details (outcome, deadline, impact)'}
      </button>

      <div className={cx('grid sm:grid-cols-2 gap-3', !expanded && 'hidden')}>
        <Field label="Description" className="sm:col-span-2"><textarea className="input" rows={2} value={f.description ?? ''} onChange={(e) => set('description', e.target.value)} /></Field>
        <Field label="Expected outcome" hint="What will be true when this is done? Make it checkable." className="sm:col-span-2">
          <input className="input" placeholder="e.g. Checkout success on 3G back above 98%" value={f.expected_outcome ?? ''} onChange={(e) => set('expected_outcome', e.target.value)} />
        </Field>
        <Field label="Category">
          <select className="input" value={f.category ?? ''} onChange={(e) => set('category', e.target.value)}>
            <option value="">Default for my role</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{cap(c)}</option>)}
          </select>
        </Field>
        <Field label="Priority">
          <select className="input" value={f.priority} onChange={(e) => set('priority', e.target.value as NewTask['priority'])}>
            {['low', 'medium', 'high', 'critical'].map((p) => <option key={p} value={p}>{cap(p)}</option>)}
          </select>
        </Field>
        <Field label="Deadline"><input type="datetime-local" className="input" value={f.deadline ?? ''} onChange={(e) => set('deadline', e.target.value)} /></Field>
        <Field label="Estimate (minutes)"><input type="number" min={5} step={5} className="input" value={f.estimated_minutes ?? ''} onChange={(e) => set('estimated_minutes', e.target.value ? Number(e.target.value) : undefined)} /></Field>
        <Field label="Expected impact">
          <select className="input" value={f.impact_level} onChange={(e) => set('impact_level', e.target.value as NewTask['impact_level'])}>
            <option value="low">Low — routine upkeep</option><option value="medium">Medium — helps the team</option><option value="high">High — moves a key metric / customer</option>
          </select>
        </Field>
        <Field label="Impact note"><input className="input" placeholder="Who benefits, and how?" value={f.impact_note ?? ''} onChange={(e) => set('impact_note', e.target.value)} /></Field>
        <div className="sm:col-span-2 flex items-center justify-between rounded-md border border-border px-3 py-2.5">
          <div><p className="text-sm font-medium">Plan for today</p><p className="text-xs text-faint">Shows on your dashboard and in today’s report.</p></div>
          <Toggle checked={!!f.is_planned_today} onChange={(v) => set('is_planned_today', v)} label="Plan for today" />
        </div>
        <p className="sm:col-span-2 text-xs text-faint">After you save, WorkLens AI may suggest a category, a measurable outcome and an impact level on the task page (if your manager has AI suggestions on). Nothing changes until you apply it.</p>
      </div>
    </form>
  );
}
