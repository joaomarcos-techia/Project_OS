'use client';

import { useSyncExternalStore } from 'react';

/**
 * Quantos handoffs esperam atendimento — store singleton, sem Context/Provider,
 * no mesmo padrão de `use-toast` (Governança de UI regra 6).
 *
 * Existe porque quem descobre o número (o watcher, montado no layout) e quem o
 * exibe (a sidebar, dentro do shell) são componentes irmãos. Subir estado até um
 * ancestral comum obrigaria o shell inteiro a re-renderizar a cada polling.
 *
 * O toast avisa o que ACABOU de chegar; o badge mostra o que AINDA espera. Sem
 * o segundo, quem estava olhando para o lado quando o aviso subiu não fica
 * sabendo de nada.
 */
let count = 0;
const listeners = new Set<() => void>();

export function setOpenHandoffCount(next: number) {
  const safe = Number.isFinite(next) && next > 0 ? Math.floor(next) : 0;
  if (safe === count) return;
  count = safe;
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Servidor renderiza 0: o número só existe depois do primeiro polling. */
export function useOpenHandoffCount(): number {
  return useSyncExternalStore(
    subscribe,
    () => count,
    () => 0,
  );
}

/** test-only — o store é global e vaza entre casos sem isto. */
export const __testing__ = { reset: () => setOpenHandoffCount(0) };
