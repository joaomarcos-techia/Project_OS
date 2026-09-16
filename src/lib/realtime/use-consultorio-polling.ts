'use client';

/**
 * O consultório lê exclusivamente pelo getBoard server-side. O navegador não
 * recebe o JWT do Supabase nem se inscreve diretamente em postgres_changes.
 */
import { useEffect, useState } from 'react';

export type ConsultorioRefreshState = 'connecting' | 'active' | 'retrying' | 'paused';

const REFRESH_INTERVAL_MS = 20_000;
const RETRY_BACKOFF_MS = [5_000, 10_000, 20_000, 30_000] as const;

export function useConsultorioPolling(refresh: () => Promise<boolean>): ConsultorioRefreshState {
  const [state, setState] = useState<ConsultorioRefreshState>('connecting');

  useEffect(() => {
    let disposed = false;
    let inFlight = false;
    let resumePending = false;
    let failureStep = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const isHidden = () => document.visibilityState === 'hidden';

    const clearTimer = () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    };

    const run = async () => {
      if (disposed || inFlight) return;
      if (isHidden()) {
        setState('paused');
        return;
      }

      inFlight = true;
      let ok = false;
      try {
        ok = await refresh();
      } catch {
        // Falhas de transporte/autorização são tratadas pelo mesmo backoff.
      } finally {
        inFlight = false;
      }
      if (disposed) return;
      if (isHidden()) {
        setState('paused');
        return;
      }
      if (resumePending) {
        resumePending = false;
        void run();
        return;
      }

      setState(ok ? 'active' : 'retrying');
      const delay = ok
        ? REFRESH_INTERVAL_MS
        : RETRY_BACKOFF_MS[Math.min(failureStep++, RETRY_BACKOFF_MS.length - 1)]!;
      timer = setTimeout(() => void run(), delay);
      if (ok) failureStep = 0;
    };

    const onVisibilityChange = () => {
      if (isHidden()) {
        clearTimer();
        setState('paused');
      } else {
        clearTimer();
        setState('connecting');
        if (inFlight) resumePending = true;
        else void run();
      }
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    void run();
    return () => {
      disposed = true;
      clearTimer();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [refresh]);

  return state;
}
