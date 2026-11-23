import { useCallback, useEffect, useRef, useState } from 'react';

/** Load async data; re-runs when deps change. `reload()` refetches without clearing data. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const run = useCallback(async (quiet = false) => {
    const id = ++seq.current;
    if (!quiet) setLoading(true);
    try {
      const v = await fn();
      if (id === seq.current) { setData(v); setError(null); }
    } catch (e) {
      if (id === seq.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (id === seq.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { run(); }, [run]);
  return { data, error, loading, reload: () => run(true), setData };
}

export function useMediaQuery(q: string) {
  const [m, setM] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches);
  useEffect(() => { const mq = window.matchMedia(q); const h = () => setM(mq.matches); mq.addEventListener('change', h); return () => mq.removeEventListener('change', h); }, [q]);
  return m;
}

/** Broadcast "data changed" so open pages can refetch after a mutation elsewhere (slide-over, palette…). */
const listeners = new Set<() => void>();
export const emitDataChanged = () => listeners.forEach((l) => l());
export function useDataChanged(cb: () => void) {
  const ref = useRef(cb); ref.current = cb;
  useEffect(() => { const l = () => ref.current(); listeners.add(l); return () => { listeners.delete(l); }; }, []);
}
