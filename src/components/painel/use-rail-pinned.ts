'use client';

import { useCallback, useSyncExternalStore } from 'react';

import { RAIL_ATTRIBUTE, RAIL_PINNED, RAIL_STORAGE_KEY } from './rail-preference';

/**
 * Estado de "Fixar menu aberto". A fonte da verdade é o atributo no `<html>`
 * (aplicado antes da pintura pelo layout raiz); este hook só o observa e o
 * alterna. O servidor renderiza "recolhido" — o CSS já mostra o estado certo
 * pelo atributo, então a única coisa que muda na hidratação é o `aria-pressed`.
 */
const listeners = new Set<() => void>();

function readPinned(): boolean {
  return document.documentElement.getAttribute(RAIL_ATTRIBUTE) === RAIL_PINNED;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useRailPinned(): { pinned: boolean; toggle: () => void } {
  const pinned = useSyncExternalStore(subscribe, readPinned, () => false);

  const toggle = useCallback(() => {
    const next = !readPinned();
    const root = document.documentElement;
    if (next) root.setAttribute(RAIL_ATTRIBUTE, RAIL_PINNED);
    else root.removeAttribute(RAIL_ATTRIBUTE);
    try {
      if (next) localStorage.setItem(RAIL_STORAGE_KEY, RAIL_PINNED);
      else localStorage.removeItem(RAIL_STORAGE_KEY);
    } catch {
      // Navegação privada ou armazenamento bloqueado: vale só nesta aba.
    }
    for (const listener of listeners) listener();
  }, []);

  return { pinned, toggle };
}
