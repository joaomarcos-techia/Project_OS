'use client';

import { useCallback, useEffect, useState } from 'react';

const KEY = 'clinicaos-theme';

/** Aplica nos DOIS mecanismos: `.dark` (Tailwind) e `data-theme` (CSS legado). */
function apply(dark: boolean) {
  const el = document.documentElement;
  el.setAttribute('data-theme', dark ? 'dark' : 'light');
  el.classList.toggle('dark', dark);
}

/**
 * Tema do app (compartilhado pelos shells do painel e do admin).
 * Persiste em localStorage['clinicaos-theme'] — a MESMA chave do anti-flash
 * do root layout. Atalho ⌘/Ctrl+\ alterna.
 */
export function useTheme() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(KEY);
    } catch {
      /* storage indisponível */
    }
    const isDark = saved === 'dark';
    apply(isDark);
    setDark(isDark);
  }, []);

  const toggle = useCallback(() => {
    setDark((prev) => {
      const next = !prev;
      apply(next);
      try {
        localStorage.setItem(KEY, next ? 'dark' : 'light');
      } catch {
        /* storage indisponível */
      }
      return next;
    });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === '\\') {
        e.preventDefault();
        toggle();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [toggle]);

  return { dark, toggle };
}
