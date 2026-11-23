import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react';
import { api, type User } from '@/api';
import { cx } from '@/components/ui';

// ---------- Auth ----------
interface AuthCtx { user: User | null; loading: boolean; login(email: string, pw: string): Promise<User>; logout(): Promise<void>; refresh(): Promise<void> }
const AuthContext = createContext<AuthCtx>(null as unknown as AuthCtx);
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => { setUser(await api.auth.me()); }, []);
  useEffect(() => { refresh().finally(() => setLoading(false)); }, [refresh]);
  const login = async (e: string, p: string) => { const u = await api.auth.login(e, p); setUser(u); return u; };
  const logout = async () => { await api.auth.logout(); setUser(null); };
  return <AuthContext.Provider value={{ user, loading, login, logout, refresh }}>{children}</AuthContext.Provider>;
}
export const useAuth = () => useContext(AuthContext);

// ---------- Theme ----------
type Theme = 'light' | 'dark';
const ThemeContext = createContext<{ theme: Theme; toggle(): void; set(t: Theme): void }>(null as never);
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => (document.documentElement.classList.contains('dark') ? 'dark' : 'light'));
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    try { localStorage.setItem('wl-theme', theme); } catch { /* ignore */ }
  }, [theme]);
  return <ThemeContext.Provider value={{ theme, toggle: () => setTheme((t) => (t === 'dark' ? 'light' : 'dark')), set: setTheme }}>{children}</ThemeContext.Provider>;
}
export const useTheme = () => useContext(ThemeContext);

// ---------- Toasts ----------
type ToastKind = 'success' | 'error' | 'info';
interface ToastItem { id: number; kind: ToastKind; msg: string }
const ToastContext = createContext<(msg: string, kind?: ToastKind) => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((msg: string, kind: ToastKind = 'success') => {
    const id = Date.now() + Math.random();
    setItems((s) => [...s, { id, kind, msg }]);
    setTimeout(() => setItems((s) => s.filter((x) => x.id !== id)), 4000);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="fixed bottom-4 right-4 left-4 sm:left-auto z-[60] flex flex-col gap-2 items-end pointer-events-none" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className="pointer-events-auto card shadow-pop px-3.5 py-2.5 flex items-center gap-2.5 text-sm max-w-sm w-full sm:w-auto">
            {t.kind === 'success' ? <CheckCircle2 size={16} className="text-success shrink-0" /> : t.kind === 'error' ? <AlertTriangle size={16} className="text-danger shrink-0" /> : <Info size={16} className="text-info shrink-0" />}
            <span className="flex-1">{t.msg}</span>
            <button onClick={() => setItems((s) => s.filter((x) => x.id !== t.id))} className="text-faint hover:text-fg" aria-label="Dismiss"><X size={14} /></button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
export const useToast = () => useContext(ToastContext);
export const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

// ---------- Global UI (task composer, command palette) ----------
interface UICtx { composerOpen: boolean; openComposer(): void; closeComposer(): void; paletteOpen: boolean; setPaletteOpen(v: boolean): void }
const UIContext = createContext<UICtx>(null as never);
export function UIProvider({ children }: { children: ReactNode }) {
  const [composerOpen, setComposer] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  return (
    <UIContext.Provider value={{ composerOpen, openComposer: () => setComposer(true), closeComposer: () => setComposer(false), paletteOpen, setPaletteOpen }}>
      {children}
    </UIContext.Provider>
  );
}
export const useUI = () => useContext(UIContext);
export { cx };
