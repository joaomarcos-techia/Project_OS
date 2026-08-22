'use client';

import { useCallback, useEffect, useState } from 'react';

const KEY = 'clinicaos-theme';

export type ThemePreference = 'light' | 'dark' | 'system';

function isThemePreference(value: string | null): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system';
}

export function resolveThemePreference(
  preference: ThemePreference,
  systemPrefersDark: boolean,
): boolean {
  return preference === 'dark' || (preference === 'system' && systemPrefersDark);
}

/** Aplica nos dois mecanismos: `.dark` (Tailwind) e `data-theme` (CSS legado). */
function apply(preference: ThemePreference): boolean {
  const systemPrefersDark =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches;
  const dark = resolveThemePreference(preference, systemPrefersDark);
  const element = document.documentElement;
  element.setAttribute('data-theme', dark ? 'dark' : 'light');
  element.classList.toggle('dark', dark);
  return dark;
}

function readPreference(): ThemePreference {
  try {
    const saved = localStorage.getItem(KEY);
    return isThemePreference(saved) ? saved : 'light';
  } catch {
    return 'light';
  }
}

function persistPreference(preference: ThemePreference): void {
  try {
    localStorage.setItem(KEY, preference);
  } catch {
    // O tema continua válido na sessão quando o storage está indisponível.
  }
}

/** Tema light/dark/system compartilhado pelos shells, com atalho ⌘/Ctrl+\. */
export function useTheme() {
  const [theme, setTheme] = useState<ThemePreference>('light');
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const saved = readPreference();
    setTheme(saved);
    setDark(apply(saved));
  }, []);

  useEffect(() => {
    if (theme !== 'system' || typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setDark(apply('system'));
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [theme]);

  const toggle = useCallback(() => {
    const next: ThemePreference =
      theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light';
    setTheme(next);
    setDark(apply(next));
    persistPreference(next);
  }, [theme]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === '\\') {
        event.preventDefault();
        toggle();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [toggle]);

  return { theme, dark, toggle };
}
