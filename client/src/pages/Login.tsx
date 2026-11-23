import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Moon, ShieldCheck, Sun, Target, Sparkles, LineChart } from 'lucide-react';
import { Avatar, Button, Field } from '@/components/ui';
import { errMsg, useAuth, useTheme } from '@/context';

const DEMO = [
  { email: 'manager@worklens.dev', name: 'Meera Kapoor', role: 'Manager', color: '#6366F1' },
  { email: 'aarav@worklens.dev', name: 'Aarav Sharma', role: 'Engineer', color: '#0EA5E9' },
  { email: 'priya@worklens.dev', name: 'Priya Nair', role: 'Designer', color: '#EC4899' },
  { email: 'rohan@worklens.dev', name: 'Rohan Mehta', role: 'Support', color: '#F59E0B' },
  { email: 'zoya@worklens.dev', name: 'Zoya Khan', role: 'Marketing', color: '#10B981' },
  { email: 'kabir@worklens.dev', name: 'Kabir Das', role: 'New joiner', color: '#8B5CF6' },
];

export default function Login() {
  const { user, login } = useAuth();
  const { theme, toggle } = useTheme();
  const nav = useNavigate();
  const loc = useLocation() as { state?: { from?: string } };
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (user) return <Navigate to="/" replace />;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const u = await login(email, password);
      nav(loc.state?.from && loc.state.from !== '/login' ? loc.state.from : u.role === 'manager' ? '/manager' : '/dashboard', { replace: true });
    } catch (err) { setError(errMsg(err)); } finally { setBusy(false); }
  }

  return (
    <div className="min-h-full grid lg:grid-cols-2">
      <div className="hidden lg:flex flex-col justify-between bg-[#0E1117] text-white p-12 relative overflow-hidden">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg bg-[#161B26] ring-1 ring-white/10 flex items-center justify-center"><div className="h-4 w-4 rounded-full border-[2.5px] border-[#5EEAD4]" /></div>
          <span className="font-semibold text-lg">WorkLens</span>
        </div>
        <div className="max-w-md">
          <h1 className="font-display text-4xl font-semibold tracking-tight leading-tight">Make every contribution visible.</h1>
          <p className="mt-3 text-white/60 leading-relaxed">WorkLens doesn’t measure how busy you look. It measures what you actually contribute — from real records, with every score explained.</p>
          <ul className="mt-8 space-y-4 text-sm">
            {[
              [Target, 'Five dimensions', 'Productivity, Quality, Impact, Consistency, Ownership'],
              [ShieldCheck, 'Evidence, verified', 'Managers verify outcomes, not activity'],
              [LineChart, 'Fair by design', 'Hours and task counts never raise a score'],
              [Sparkles, 'Grounded AI', 'Summaries only from your own records'],
            ].map(([Icon, t, d]) => {
              const I = Icon as React.ElementType;
              return <li key={t as string} className="flex gap-3"><span className="h-8 w-8 rounded-md bg-white/5 border border-white/10 flex items-center justify-center shrink-0"><I size={15} className="text-[#5EEAD4]" /></span><span><span className="font-medium">{t as string}</span><span className="block text-white/50 text-xs mt-0.5">{d as string}</span></span></li>;
            })}
          </ul>
        </div>
        <p className="text-xs text-white/40">Built for the viaSocket challenge: “How can you and your work be measured?”</p>
      </div>

      <div className="flex flex-col items-center justify-center px-4 py-10 relative">
        <Button variant="ghost" size="icon" onClick={toggle} className="absolute top-4 right-4" aria-label="Toggle theme">{theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}</Button>
        <div className="w-full max-w-sm">
          <div className="lg:hidden flex items-center gap-2 mb-8">
            <div className="h-8 w-8 rounded-lg bg-[#0E1117] flex items-center justify-center"><div className="h-4 w-4 rounded-full border-[2.5px] border-[#5EEAD4]" /></div>
            <span className="font-semibold text-lg">WorkLens</span>
          </div>
          <h2 className="text-xl font-semibold tracking-tight">Sign in</h2>
          <p className="text-muted text-sm mt-1">Use a demo account below, or type the credentials.</p>
          <form onSubmit={submit} className="mt-6 space-y-3.5">
            <Field label="Email"><input className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@worklens.dev" required /></Field>
            <Field label="Password" error={error}><input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
            <Button type="submit" variant="primary" className="w-full h-10" loading={busy}>Sign in</Button>
          </form>

          <div className="mt-8">
            <p className="text-xs font-medium text-muted mb-2">Demo accounts · password <code className="px-1 rounded bg-subtle text-fg">demo1234</code></p>
            <div className="grid grid-cols-2 gap-2">
              {DEMO.map((d) => (
                <button key={d.email} type="button" onClick={() => { setEmail(d.email); setPassword('demo1234'); setError(null); }}
                  className="flex items-center gap-2 p-2 rounded-md border border-border bg-surface hover:border-accent/50 hover:bg-accent-soft/40 transition text-left">
                  <Avatar name={d.name} color={d.color} size={26} />
                  <span className="min-w-0"><span className="block text-xs font-medium truncate">{d.name}</span><span className="block text-[11px] text-faint">{d.role}</span></span>
                </button>
              ))}
            </div>
            <p className="mt-3 text-[11px] text-faint">Click a card to autofill, then Sign in. All people are fictional.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
