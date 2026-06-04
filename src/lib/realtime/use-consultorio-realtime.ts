'use client';

/**
 * Realtime do Consultório (C8) com fallback de polling + backoff + observabilidade.
 *
 * RLS é o gate real: o subscriber autenticado (sessão via @supabase/ssr) só recebe
 * linhas do seu tenant (policy resolve por current_clinic_id() = claim JWT). O
 * `filter: clinic_id=eq.<id>` é relevância/perf, não isolamento.
 *
 * Se o canal cair (CHANNEL_ERROR/TIMED_OUT/CLOSED), entra polling progressivo
 * 5s→10s→15s→30s; ao reconectar (SUBSCRIBED), desliga o polling e faz um refetch
 * para fechar a janela. Eventos são logados (console.warn — permitido pelo lint)
 * para diagnosticar "o card não apareceu".
 */
import { useEffect, useRef, useState } from 'react';

import { createBrowserClient } from '@/lib/auth/supabase-browser';

export type RealtimeState = 'connecting' | 'live' | 'polling';

const POLL_BACKOFF_MS = [5_000, 10_000, 15_000, 30_000] as const;
const DEBOUNCE_MS = 250;

export function useConsultorioRealtime(opts: {
  clinicId: string;
  tables: readonly string[];
  onChange: () => void;
  label?: string;
}): RealtimeState {
  const { clinicId, tables, onChange, label = 'consultorio' } = opts;
  const [state, setState] = useState<RealtimeState>('connecting');

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const tablesKey = tables.join(',');

  useEffect(() => {
    const supabase = createBrowserClient();

    // CRÍTICO p/ RLS no Realtime: o WebSocket precisa do JWT do usuário, senão
    // sobe como anônimo e a policy filtra TODOS os eventos em silêncio (canal
    // "SUBSCRIBED" mas sem entregar nada). onAuthStateChange dispara
    // INITIAL_SESSION com a sessão dos cookies (@supabase/ssr) e a cada refresh;
    // setAuth re-propaga o token aos canais já inscritos. (getSession é barrado
    // pelo lint; onAuthStateChange é o caminho permitido.)
    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.access_token) supabase.realtime.setAuth(session.access_token);
    });

    let disposed = false;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    let pollStep = 0;
    let polling = false;

    const fire = () => {
      if (disposed) return;
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => onChangeRef.current(), DEBOUNCE_MS);
    };

    const stopPolling = () => {
      if (pollTimer) {
        clearTimeout(pollTimer);
        pollTimer = null;
      }
      if (polling) {
        polling = false;
        console.warn(`[${label}] polling.disabled`, { clinicId });
      }
      pollStep = 0;
    };

    const schedulePoll = () => {
      const delay = POLL_BACKOFF_MS[Math.min(pollStep, POLL_BACKOFF_MS.length - 1)]!;
      pollTimer = setTimeout(() => {
        if (disposed) return;
        onChangeRef.current();
        pollStep += 1;
        schedulePoll();
      }, delay);
    };

    const startPolling = () => {
      if (polling || disposed) return;
      polling = true;
      pollStep = 0;
      console.warn(`[${label}] polling.activated`, { clinicId });
      schedulePoll();
    };

    const channel = supabase.channel(`${label}:${clinicId}`);
    for (const table of tables) {
      channel.on(
        // @supabase/realtime-js: postgres_changes
        'postgres_changes' as never,
        { event: '*', schema: 'public', table, filter: `clinic_id=eq.${clinicId}` } as never,
        fire as never,
      );
    }
    channel.subscribe((status: string) => {
      if (disposed) return;
      if (status === 'SUBSCRIBED') {
        const wasPolling = polling;
        stopPolling();
        setState('live');
        if (wasPolling) console.warn(`[${label}] realtime.recovered`, { clinicId });
        onChangeRef.current();
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        setState('polling');
        console.warn(`[${label}] realtime.disconnected`, { clinicId, status });
        startPolling();
      }
    });

    return () => {
      disposed = true;
      if (debounceTimer) clearTimeout(debounceTimer);
      stopPolling();
      authListener.subscription.unsubscribe();
      void supabase.removeChannel(channel);
    };
    // onChange é acessado via ref; só re-assina quando clínica/tabelas/label mudam.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clinicId, tablesKey, label]);

  return state;
}
