import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Columns3, List, ListChecks, Plus, Search, X } from 'lucide-react';
import { api, type Priority, type TaskFilters, type TaskStatus, type TaskWithMeta } from '@/api';
import { Button, EmptyState, ErrorState, PriorityIcon, Segmented, Skeleton, cx } from '@/components/ui';
import { DueText, StatusControl, TaskMetaBadges, TaskRow } from '@/components/tasks';
import { useUI } from '@/context';
import { CATEGORIES, STATUS_LABEL, cap } from '@/lib/format';
import { useAsync, useDataChanged } from '@/lib/hooks';

const STATUSES: TaskStatus[] = ['not_started', 'in_progress', 'blocked', 'completed'];

export default function MyTasks() {
  const ui = useUI();
  const [view, setView] = useState<'list' | 'board'>(() => { try { return (localStorage.getItem('wl-tasks-view') as 'list' | 'board') || 'list'; } catch { return 'list'; } });
  const [q, setQ] = useState('');
  const [f, setF] = useState<TaskFilters>({ sort: 'deadline', status: '', priority: '', category: '' });
  const [dq, setDq] = useState('');
  useEffect(() => { const t = setTimeout(() => setDq(q.trim()), 250); return () => clearTimeout(t); }, [q]);
  const { data, loading, error, reload } = useAsync(() => api.tasks.list({ ...f, q: dq || undefined }), [f.status, f.priority, f.category, f.sort, f.overdue, dq]);
  useDataChanged(reload);

  const setView2 = (v: 'list' | 'board') => { setView(v); try { localStorage.setItem('wl-tasks-view', v); } catch { /* ignore */ } };
  const tasks = useMemo(() => data ?? [], [data]);
  const filtered = !!(q || f.status || f.priority || f.category || f.overdue);
  const overdue = tasks.filter((t) => t.is_overdue).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="h-page">My Tasks</h1>
          <p className="text-xs text-muted mt-0.5">{data ? `${tasks.length} task${tasks.length === 1 ? '' : 's'}` : 'Loading…'}{overdue > 0 && <span className="text-danger"> · {overdue} overdue</span>}</p>
        </div>
        <div className="flex items-center gap-2">
          <Segmented value={view} onChange={setView2} options={[{ value: 'list', label: <><List size={13} />List</> }, { value: 'board', label: <><Columns3 size={13} />Board</> }]} />
          <Button variant="primary" icon={<Plus size={15} />} onClick={ui.openComposer}>Add task</Button>
        </div>
      </div>

      <div className="card p-2.5 flex flex-col md:flex-row gap-2">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
          <input className="input pl-8 h-8" placeholder="Search tasks…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 md:flex gap-2">
          <select aria-label="Status" className="input h-8 md:w-36 text-xs" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as TaskStatus | '' })}>
            <option value="">All statuses</option>{STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
          <select aria-label="Priority" className="input h-8 md:w-32 text-xs" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value as Priority | '' })}>
            <option value="">All priorities</option>{(['critical', 'high', 'medium', 'low'] as Priority[]).map((p) => <option key={p} value={p}>{cap(p)}</option>)}
          </select>
          <select aria-label="Category" className="input h-8 md:w-36 text-xs" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
            <option value="">All categories</option>{CATEGORIES.map((c) => <option key={c} value={c}>{cap(c)}</option>)}
          </select>
          <select aria-label="Sort" className="input h-8 md:w-36 text-xs" value={f.sort} onChange={(e) => setF({ ...f, sort: e.target.value as TaskFilters['sort'] })}>
            <option value="deadline">Sort: Deadline</option><option value="created">Sort: Newest</option><option value="priority">Sort: Priority</option>
          </select>
        </div>
        <button type="button" aria-pressed={!!f.overdue} onClick={() => setF({ ...f, overdue: !f.overdue })}
          className={cx('h-8 px-3 rounded-md border text-xs font-medium transition whitespace-nowrap', f.overdue ? 'bg-danger-soft border-danger/30 text-danger' : 'border-border text-muted hover:text-fg hover:bg-subtle')}>Overdue only</button>
        {filtered && <Button variant="ghost" size="sm" className="h-8" icon={<X size={13} />} onClick={() => { setQ(''); setF({ sort: f.sort, status: '', priority: '', category: '', overdue: false }); }}>Clear</Button>}
      </div>

      {error ? <ErrorState message={error} onRetry={reload} />
        : loading && !data ? <div className="card p-2 space-y-2">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-12" />)}</div>
        : tasks.length === 0 ? (
          <div className="card">
            <EmptyState icon={<ListChecks size={18} />} title={filtered ? 'No tasks match these filters' : 'No tasks yet'}
              body={filtered ? 'Try clearing a filter or searching for something else.' : 'Add what you are working on — outcomes, not hours.'}
              action={filtered ? <Button onClick={() => { setQ(''); setF({ sort: f.sort, status: '', priority: '', category: '', overdue: false }); }}>Clear filters</Button> : <Button variant="primary" icon={<Plus size={15} />} onClick={ui.openComposer}>Add task</Button>} />
          </div>
        ) : view === 'list' ? (
          <div className="card overflow-hidden">
            <div className="hidden sm:flex items-center px-4 h-9 border-b border-border text-[11px] font-medium uppercase tracking-wide text-faint bg-subtle/50">
              <span className="flex-1">Task</span><span className="w-[220px] text-right">Due · Status</span>
            </div>
            {tasks.map((t) => <TaskRow key={t.id} task={t} onChanged={reload} />)}
          </div>
        ) : (
          <Board tasks={tasks} onChanged={reload} />
        )}
    </div>
  );
}

function Board({ tasks, onChanged }: { tasks: TaskWithMeta[]; onChanged: () => void }) {
  const dot: Record<TaskStatus, string> = { not_started: 'bg-faint', in_progress: 'bg-info', blocked: 'bg-danger', completed: 'bg-success' };
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {STATUSES.map((s) => {
        const col = tasks.filter((t) => t.status === s);
        return (
          <div key={s} className="rounded-lg bg-subtle/60 border border-border p-2 min-h-[120px]">
            <div className="flex items-center gap-2 px-1.5 py-1 mb-1.5">
              <span className={cx('h-2 w-2 rounded-full', dot[s])} />
              <span className="text-xs font-semibold">{STATUS_LABEL[s]}</span>
              <span className="text-xs text-faint tnum">{col.length}</span>
            </div>
            <div className="space-y-2">
              {col.length === 0 && <p className="text-[11px] text-faint px-1.5 py-3 text-center">Nothing here</p>}
              {col.map((t) => (
                <div key={t.id} className={cx('card p-3', t.is_overdue && 'border-danger/40')}>
                  <div className="flex items-start gap-2">
                    <PriorityIcon priority={t.priority} />
                    <Link to={`/tasks/${t.id}`} className="text-[13px] font-medium leading-snug hover:text-accent flex-1">{t.title}</Link>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 mt-2"><span className="text-[11px] text-faint">{cap(t.category)}</span><TaskMetaBadges task={t} /></div>
                  {t.open_blocker && <p className="mt-2 text-[11px] text-danger line-clamp-2">Blocked: {t.open_blocker.dependency_name ?? t.open_blocker.description}</p>}
                  <div className="flex items-center justify-between mt-2.5 gap-2"><DueText task={t} /><StatusControl task={t} onChanged={onChanged} /></div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
