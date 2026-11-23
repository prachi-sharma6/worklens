import type { Dimension, EvidenceType, ImpactLevel, Priority, TaskStatus, VerificationStatus } from '@/api/types';

const DAY = 86400000;
export const dateKey = (d: Date | string | number = new Date()) => { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
export const weekStartKey = (d: Date | string = new Date()) => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return dateKey(x); };

export function fmtDate(v: string | null | undefined, opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }) {
  if (!v) return '—';
  return new Date(v).toLocaleDateString(undefined, opts);
}
export function fmtDateTime(v: string | null | undefined) {
  if (!v) return '—';
  return new Date(v).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
export function relTime(v: string | null | undefined) {
  if (!v) return '—';
  const diff = Date.now() - new Date(v).getTime();
  const abs = Math.abs(diff); const fut = diff < 0;
  const m = Math.round(abs / 60000), h = Math.round(abs / 3600000), d = Math.round(abs / DAY);
  const s = m < 1 ? 'just now' : m < 60 ? `${m}m` : h < 24 ? `${h}h` : d < 7 ? `${d}d` : fmtDate(v);
  if (s === 'just now' || s.includes(' ')) return s;
  return fut ? `in ${s}` : `${s} ago`;
}
export function dueLabel(v: string | null) {
  if (!v) return 'No deadline';
  const d = new Date(v); const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.round((new Date(d).setHours(0, 0, 0, 0) - today.getTime()) / DAY);
  if (diff === 0) return 'Due today';
  if (diff === 1) return 'Due tomorrow';
  if (diff === -1) return 'Due yesterday';
  if (diff < 0) return `${-diff}d overdue`;
  if (diff < 7) return `Due ${d.toLocaleDateString(undefined, { weekday: 'short' })}`;
  return `Due ${fmtDate(v)}`;
}
export const fmtMinutes = (m: number | null | undefined) => (m == null ? '—' : m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}`);
export const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };
export const initials = (name: string) => name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();
export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export const STATUS_LABEL: Record<TaskStatus, string> = { not_started: 'Not started', in_progress: 'In progress', completed: 'Completed', blocked: 'Blocked' };
export const PRIORITY_LABEL: Record<Priority, string> = { low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical' };
export const IMPACT_LABEL: Record<ImpactLevel, string> = { low: 'Low impact', medium: 'Medium impact', high: 'High impact' };
export const VERIFY_LABEL: Record<VerificationStatus, string> = { unsubmitted: 'No evidence', pending: 'Pending review', verified: 'Verified', clarification_requested: 'Clarification requested', rejected: 'Rejected' };
export const EVIDENCE_LABEL: Record<EvidenceType, string> = { github: 'GitHub PR / commit', document: 'Document', screenshot: 'Screenshot', test_result: 'Test result', deliverable: 'Deliverable', explanation: 'Written explanation' };
export const DIM_LABEL: Record<Dimension, string> = { productivity: 'Productivity', quality: 'Quality', impact: 'Impact', consistency: 'Consistency', ownership: 'Ownership' };
export const DIMS: Dimension[] = ['productivity', 'quality', 'impact', 'consistency', 'ownership'];
export const CATEGORIES = ['engineering', 'design', 'support', 'marketing', 'general'];

export function toMarkdownTable(rows: string[][]) {
  if (!rows.length) return '';
  const [h, ...b] = rows;
  return [`| ${h.join(' | ')} |`, `| ${h.map(() => '---').join(' | ')} |`, ...b.map((r) => `| ${r.join(' | ')} |`)].join('\n');
}
export function download(filename: string, text: string, type = 'text/markdown') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
