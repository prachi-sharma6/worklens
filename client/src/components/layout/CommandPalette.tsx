import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { CornerDownLeft, FileText, Plus, Search, User as UserIcon } from 'lucide-react';
import { api, type TaskWithMeta, type User } from '@/api';
import { Avatar, StatusPill, cx } from '@/components/ui';
import { useAuth, useUI } from '@/context';
import { EMPLOYEE_NAV, MANAGER_NAV } from './nav';

type Item = { key: string; label: string; hint?: string; icon: React.ReactNode; run: () => void; right?: React.ReactNode };

export function CommandPalette() {
  const { paletteOpen: open, setPaletteOpen, openComposer } = useUI();
  const { user } = useAuth();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const [res, setRes] = useState<{ tasks: TaskWithMeta[]; people: User[] }>({ tasks: [], people: [] });

  useEffect(() => { if (open) { setQ(''); setSel(0); setRes({ tasks: [], people: [] }); } }, [open]);
  useEffect(() => {
    if (!open || !q.trim()) { setRes({ tasks: [], people: [] }); return; }
    let live = true;
    const t = setTimeout(() => api.search.query(q).then((r) => live && setRes(r)).catch(() => {}), 120);
    return () => { live = false; clearTimeout(t); };
  }, [q, open]);

  const close = () => setPaletteOpen(false);
  const go = (to: string) => { close(); nav(to); };

  const items: Item[] = useMemo(() => {
    const pages = user?.role === 'manager' ? MANAGER_NAV : EMPLOYEE_NAV;
    const s = q.trim().toLowerCase();
    const out: Item[] = [];
    if (user?.role === 'employee' && (!s || 'add task new create'.includes(s) || s.startsWith('add'))) out.push({ key: 'new', label: 'Add task', hint: 'Action', icon: <Plus size={15} />, run: () => { close(); openComposer(); } });
    pages.filter((p) => !s || p.label.toLowerCase().includes(s) || p.hint.toLowerCase().includes(s)).forEach((p) => out.push({ key: p.to, label: p.label, hint: p.hint, icon: <p.icon size={15} />, run: () => go(p.to) }));
    res.people.forEach((u) => out.push({ key: `u${u.id}`, label: u.name, hint: u.title, icon: <Avatar name={u.name} color={u.avatar_color} size={18} />, run: () => go(`/people/${u.id}`) }));
    res.tasks.forEach((t) => out.push({ key: `t${t.id}`, label: t.title, hint: user?.role === 'manager' ? t.user_name : undefined, icon: <UserIcon size={15} className="opacity-0" />, right: <StatusPill status={t.status} />, run: () => go(`/tasks/${t.id}`) }));
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, res, user]);

  useEffect(() => { setSel(0); }, [items.length]);

  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-[55] flex items-start justify-center pt-[12vh] px-4" onKeyDown={(e) => {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(items.length - 1, s + 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
      else if (e.key === 'Enter') { e.preventDefault(); items[sel]?.run(); }
    }}>
      <div className="absolute inset-0 bg-black/40" onClick={close} />
      <div className="relative w-full max-w-xl card shadow-pop overflow-hidden" role="dialog" aria-label="Command palette">
        <div className="flex items-center gap-2 px-4 border-b border-border">
          <Search size={16} className="text-faint" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Jump to a page or search tasks…" className="flex-1 h-12 bg-transparent outline-none text-sm placeholder:text-faint" />
          <kbd className="text-[10px] text-faint border border-border rounded px-1">Esc</kbd>
        </div>
        <ul className="max-h-[50vh] overflow-y-auto p-1.5 scrollbar-thin">
          {items.length === 0 && <li className="px-3 py-6 text-center text-xs text-faint">No matches for “{q}”</li>}
          {items.map((it, i) => (
            <li key={it.key}>
              <button onMouseEnter={() => setSel(i)} onClick={it.run} className={cx('w-full flex items-center gap-2.5 px-2.5 h-9 rounded-md text-left text-[13px]', i === sel ? 'bg-subtle text-fg' : 'text-muted')}>
                <span className="text-faint w-4 flex justify-center">{it.icon}</span>
                <span className="flex-1 truncate">{it.label}</span>
                {it.right}
                {it.hint && <span className="text-[11px] text-faint truncate max-w-[30%]">{it.hint}</span>}
                {i === sel && <CornerDownLeft size={12} className="text-faint" />}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>,
    document.body,
  );
}
