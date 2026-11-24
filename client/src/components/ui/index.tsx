import { clsx } from 'clsx';
import { forwardRef, useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, ArrowDown, ArrowUp, ChevronsUp, Circle, CircleCheck, CircleDashed, CircleDot, Info, Minus, OctagonAlert, X } from 'lucide-react';
import type { Dimension, DimensionScore, Priority, TaskStatus, VerificationStatus } from '@/api/types';
import { DIM_LABEL, initials, PRIORITY_LABEL, STATUS_LABEL, VERIFY_LABEL } from '@/lib/format';

export const cx = clsx;

// ---------- Button ----------
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle';
const VARIANT: Record<Variant, string> = {
  primary: 'bg-accent text-accent-fg hover:bg-accent/90',
  secondary: 'bg-surface border border-border text-fg hover:bg-subtle',
  ghost: 'text-muted hover:text-fg hover:bg-subtle',
  subtle: 'bg-subtle text-fg hover:bg-border/60',
  danger: 'bg-danger text-white hover:bg-danger/90 shadow-sm',
};
export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'icon'; loading?: boolean; icon?: ReactNode }>(
  ({ variant = 'secondary', size = 'md', loading, icon, className, children, disabled, ...rest }, ref) => (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-full font-medium transition whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed select-none',
        size === 'sm' ? 'h-7 px-3 text-xs' : size === 'icon' ? 'h-8 w-8' : 'h-9 px-4 text-sm',
        VARIANT[variant], className,
      )}
      {...rest}
    >
      {loading ? <span className="h-3.5 w-3.5 rounded-full border-2 border-current border-r-transparent animate-spin" /> : icon}
      {children}
    </button>
  ),
);

// ---------- Card ----------
export function Card({ title, action, children, className, bodyClass, subtitle }: { title?: ReactNode; subtitle?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; bodyClass?: string }) {
  return (
    <section className={cx('card', className)}>
      {(title || action) && (
        <header className="flex items-center justify-between gap-3 px-4 pt-3.5 pb-2">
          <div className="min-w-0">
            {title && <h2 className="section-title truncate">{title}</h2>}
            {subtitle && <p className="text-xs text-faint mt-0.5">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      <div className={cx('px-4 pb-4', !(title || action) && 'pt-4', bodyClass)}>{children}</div>
    </section>
  );
}

export function Stat({ label, value, hint, tone, icon }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'success' | 'warning' | 'danger' | 'accent'; icon?: ReactNode }) {
  const toneCls = tone ? { success: 'text-success', warning: 'text-warning', danger: 'text-danger', accent: 'text-accent' }[tone] : 'text-fg';
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between text-xs text-muted"><span>{label}</span>{icon && <span className="text-faint">{icon}</span>}</div>
      <div className={cx('mt-1.5 font-display text-3xl font-semibold tnum tracking-tight', toneCls)}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-faint">{hint}</div>}
    </div>
  );
}

// ---------- Badges & pills ----------
type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';
const TONE: Record<Tone, string> = {
  neutral: 'bg-subtle text-muted border-border',
  accent: 'bg-accent-soft text-accent border-accent/20',
  success: 'bg-success-soft text-success border-success/20',
  warning: 'bg-warning-soft text-warning border-warning/25',
  danger: 'bg-danger-soft text-danger border-danger/20',
  info: 'bg-info-soft text-info border-info/20',
};
export function Badge({ tone = 'neutral', children, className, icon }: { tone?: Tone; children: ReactNode; className?: string; icon?: ReactNode }) {
  return <span className={cx('inline-flex items-center gap-1 h-5 px-1.5 rounded border text-[11px] font-medium whitespace-nowrap', TONE[tone], className)}>{icon}{children}</span>;
}

const STATUS_META: Record<TaskStatus, { tone: Tone; icon: ReactNode }> = {
  not_started: { tone: 'neutral', icon: <CircleDashed size={11} /> },
  in_progress: { tone: 'info', icon: <CircleDot size={11} /> },
  completed: { tone: 'success', icon: <CircleCheck size={11} /> },
  blocked: { tone: 'danger', icon: <OctagonAlert size={11} /> },
};
export const StatusPill = ({ status }: { status: TaskStatus }) => <Badge tone={STATUS_META[status].tone} icon={STATUS_META[status].icon}>{STATUS_LABEL[status]}</Badge>;

const VERIFY_TONE: Record<VerificationStatus, Tone> = { unsubmitted: 'warning', pending: 'accent', verified: 'success', clarification_requested: 'warning', rejected: 'danger' };
export const VerifyPill = ({ status }: { status: VerificationStatus }) => <Badge tone={VERIFY_TONE[status]}>{VERIFY_LABEL[status]}</Badge>;

export function PriorityIcon({ priority, showLabel }: { priority: Priority; showLabel?: boolean }) {
  const m = {
    low: { icon: <ArrowDown size={13} />, cls: 'text-faint' },
    medium: { icon: <Minus size={13} />, cls: 'text-muted' },
    high: { icon: <ArrowUp size={13} />, cls: 'text-warning' },
    critical: { icon: <ChevronsUp size={13} />, cls: 'text-danger' },
  }[priority];
  return <span title={`${PRIORITY_LABEL[priority]} priority`} className={cx('inline-flex items-center gap-1 text-xs', m.cls)}>{m.icon}{showLabel && PRIORITY_LABEL[priority]}</span>;
}

export function Avatar({ name, color, size = 28 }: { name: string; color?: string; size?: number }) {
  return (
    <span className="inline-flex items-center justify-center rounded-full font-semibold text-white shrink-0" style={{ width: size, height: size, background: color ?? '#6366F1', fontSize: size * 0.38 }} aria-hidden>
      {initials(name)}
    </span>
  );
}

// ---------- Form fields ----------
export function Field({ label, hint, error, children, className }: { label: string; hint?: string; error?: string | null; children: ReactNode; className?: string }) {
  return (
    <label className={cx('block', className)}>
      <span className="label">{label}</span>
      {children}
      {error ? <span className="mt-1 block text-xs text-danger">{error}</span> : hint ? <span className="mt-1 block text-xs text-faint">{hint}</span> : null}
    </label>
  );
}

export function Segmented<T extends string>({ value, onChange, options, size = 'md' }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; size?: 'sm' | 'md' }) {
  return (
    <div className="inline-flex p-0.5 rounded-md bg-subtle border border-border" role="tablist">
      {options.map((o) => (
        <button key={o.value} role="tab" aria-selected={value === o.value} onClick={() => onChange(o.value)}
          className={cx('inline-flex items-center gap-1.5 rounded px-2.5 font-medium transition', size === 'sm' ? 'h-6 text-xs' : 'h-7 text-xs', value === o.value ? 'bg-surface text-fg shadow-sm' : 'text-muted hover:text-fg')}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)}
      className={cx('relative inline-flex h-5 w-9 rounded-full transition shrink-0', checked ? 'bg-accent' : 'bg-border')}>
      <span className={cx('absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition', checked ? 'left-[18px]' : 'left-0.5')} />
    </button>
  );
}

// ---------- Feedback ----------
export const Skeleton = ({ className }: { className?: string }) => <div className={cx('skeleton rounded', className)} />;
export function PageSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-7 w-56" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}</div>
      <div className="grid lg:grid-cols-3 gap-3"><Skeleton className="h-64 lg:col-span-2" /><Skeleton className="h-64" /></div>
    </div>
  );
}
export function EmptyState({ icon, title, body, action }: { icon?: ReactNode; title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-10 px-4">
      {icon && <div className="mb-3 h-10 w-10 rounded-full bg-subtle flex items-center justify-center text-faint">{icon}</div>}
      <p className="font-medium">{title}</p>
      {body && <p className="mt-1 text-xs text-muted max-w-sm">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="card p-6 flex items-start gap-3">
      <AlertTriangle className="text-danger shrink-0" size={18} />
      <div className="flex-1"><p className="font-medium">Something went wrong</p><p className="text-xs text-muted mt-0.5">{message}</p></div>
      {onRetry && <Button size="sm" onClick={onRetry}>Retry</Button>}
    </div>
  );
}

// ---------- Overlays ----------
function useEscape(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
}
export function Modal({ open, onClose, title, children, footer, width = 'max-w-lg' }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; width?: string }) {
  useEscape(open, onClose);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[1px]" onClick={onClose} />
      <div role="dialog" aria-modal className={cx('relative w-full bg-surface border border-border rounded-t-xl sm:rounded-xl shadow-pop max-h-[92vh] flex flex-col', width)}>
        <header className="flex items-center justify-between px-5 py-3.5 border-b border-border">
          <h3 className="font-semibold">{title}</h3>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close"><X size={16} /></Button>
        </header>
        <div className="px-5 py-4 overflow-y-auto scrollbar-thin">{children}</div>
        {footer && <footer className="px-5 py-3 border-t border-border flex justify-end gap-2">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}
export function SlideOver({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode }) {
  useEscape(open, onClose);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <aside role="dialog" aria-modal className="absolute right-0 top-0 h-full w-full sm:w-[460px] bg-surface border-l border-border shadow-pop flex flex-col">
        <header className="flex items-center justify-between px-5 py-3.5 border-b border-border">
          <h3 className="font-semibold">{title}</h3>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close"><X size={16} /></Button>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-4 scrollbar-thin">{children}</div>
        {footer && <footer className="px-5 py-3 border-t border-border flex justify-end gap-2">{footer}</footer>}
      </aside>
    </div>,
    document.body,
  );
}

/** Click-to-open popover anchored below its trigger. */
export function Popover({ trigger, children, align = 'left', width = 'w-80' }: { trigger: (p: { open: boolean; toggle: () => void }) => ReactNode; children: ReactNode; align?: 'left' | 'right'; width?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const k = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', h); window.addEventListener('keydown', k);
    return () => { document.removeEventListener('mousedown', h); window.removeEventListener('keydown', k); };
  }, [open]);
  return (
    <div className="relative inline-block" ref={ref} data-popover-open={open || undefined}>
      {trigger({ open, toggle: () => setOpen((o) => !o) })}
      {open && (
        <div className={cx('absolute z-40 mt-1.5 max-w-[calc(100vw-2rem)] card shadow-pop p-3.5 text-xs', width, align === 'right' ? 'right-0' : 'left-0')}>
          {children}
        </div>
      )}
    </div>
  );
}

// ---------- Scores ----------
export function scoreTone(v: number | null | undefined) {
  if (v == null) return 'text-faint';
  return v >= 75 ? 'text-success' : v >= 50 ? 'text-warning' : 'text-danger';
}
export function barColor(v: number | null | undefined) {
  if (v == null) return 'bg-border';
  return v >= 75 ? 'bg-success' : v >= 50 ? 'bg-warning' : 'bg-danger';
}
export function MiniBar({ value, label }: { value: number | null; label?: string }) {
  return (
    <div className="flex items-center gap-1.5" title={`${label ?? ''} ${value == null ? 'Not enough data' : value}`}>
      <div className="h-1.5 w-10 rounded-full bg-subtle overflow-hidden"><div className={cx('h-full rounded-full bar-grow', barColor(value))} style={{ width: `${value ?? 0}%` }} /></div>
    </div>
  );
}
export function ScoreRing({ value, size = 88, provisional }: { value: number | null; size?: number; provisional?: boolean }) {
  const r = (size - 10) / 2, c = 2 * Math.PI * r, pctv = value ?? 0;
  const stroke = value == null ? 'rgb(var(--border))' : value >= 75 ? 'rgb(var(--success))' : value >= 50 ? 'rgb(var(--warning))' : 'rgb(var(--danger))';
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgb(var(--subtle))" strokeWidth={7} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={stroke} strokeWidth={7} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - pctv / 100)} className="ring-anim" style={{ ['--ring-c' as string]: c } as React.CSSProperties} strokeOpacity={provisional ? 0.6 : 1} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-display text-2xl font-semibold tnum">{value ?? '—'}</span>
        {provisional && <span className="text-[9px] uppercase tracking-wide text-warning font-semibold">Provisional</span>}
      </div>
    </div>
  );
}

/** "ⓘ How is this calculated?" popover. */
export function ScoreInfo({ dimension, score, formula, align = 'left' }: { dimension: Dimension | 'overall'; score?: DimensionScore; formula: string; align?: 'left' | 'right' }) {
  return (
    <Popover align={align} trigger={({ toggle }) => (
      <button onClick={toggle} className="inline-flex items-center gap-1 text-[11px] text-faint hover:text-accent transition" aria-label={`How is ${dimension} calculated?`}>
        <Info size={12} /> How is this calculated?
      </button>
    )}>
      <p className="font-semibold text-fg mb-1">{dimension === 'overall' ? 'Overall score' : DIM_LABEL[dimension]}</p>
      <p className="text-muted leading-relaxed">{formula}</p>
      {score && (
        <>
          <p className="font-medium text-fg mt-3 mb-1">Inputs this period</p>
          <ul className="space-y-1 text-muted">{score.explanation.map((e, i) => <li key={i} className="flex gap-1.5"><Circle size={5} className="mt-1.5 shrink-0 fill-current" />{e}</li>)}</ul>
          {score.value == null && <p className="mt-2 text-warning">Not enough data ({score.data_points} data point{score.data_points === 1 ? '' : 's'}, needs 3). Dropped from the overall; other weights re-normalised.</p>}
          {score.excluded.length > 0 && (
            <>
              <p className="font-medium text-fg mt-3 mb-1">Excluded</p>
              <ul className="space-y-1 text-muted">{score.excluded.slice(0, 5).map((e, i) => <li key={i}>{e.title ? <span className="text-fg">{e.title}: </span> : null}{e.reason}</li>)}</ul>
            </>
          )}
          {score.override && <p className="mt-3 text-accent">Adjusted by manager: {score.override.original_value ?? '—'} → {score.override.new_value}. “{score.override.reason}”</p>}
        </>
      )}
      <p className="mt-3 text-faint">Hours worked and task count never raise a score.</p>
    </Popover>
  );
}
