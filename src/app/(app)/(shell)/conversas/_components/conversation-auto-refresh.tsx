'use client';

import { useEffect, useRef, useTransition } from 'react';
import { useRouter } from 'next/navigation';

export const CONVERSATION_REFRESH_INTERVAL_MS = 10_000;

/**
 * The inbox stays server-rendered for tenant/RLS safety. Refreshing the current
 * route while it is visible makes persisted inbound/outbound updates appear
 * without a manual reload and without keeping background tabs active.
 *
 * Uma atualização por vez (incidente de /conversas, 14/11/2026 —
 * `docs/otimização_ui_final.md`): `router.refresh()` dentro de `startTransition`
 * deixa `isPending` verdadeiro até a nova árvore chegar, e o tique seguinte é
 * pulado enquanto isso. Antes, com o servidor lento (renders de 3 a 35 s no
 * ambiente local), um refresh começava a cada 10 s mesmo com o anterior em
 * andamento, e as renderizações — cada uma com 5 transações — se empilhavam.
 */
export function ConversationAutoRefresh() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const pendingRef = useRef(false);

  useEffect(() => {
    pendingRef.current = isPending;
  }, [isPending]);

  useEffect(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState !== 'visible' || pendingRef.current) return;
      startTransition(() => router.refresh());
    };
    const interval = window.setInterval(refreshWhenVisible, CONVERSATION_REFRESH_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [router]);

  return null;
}
