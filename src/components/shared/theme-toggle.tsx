'use client';

import { Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';

import { cn } from '@/lib/ui/cn';

/** Alterna `.dark` no <html> e persiste a escolha. Light é o default (DS / ADR-018). */
export function ThemeToggle({ className }: { className?: string }) {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.classList.contains('dark'));
  }, []);

  function toggle() {
    const next = !document.documentElement.classList.contains('dark');
    document.documentElement.classList.toggle('dark', next);
    try {
      localStorage.setItem('theme', next ? 'dark' : 'light');
    } catch {
      /* localStorage indisponível — sem persistência */
    }
    setDark(next);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="Alternar tema"
      className={cn(
        'flex w-full items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2.5 py-2 text-[12.5px] font-medium text-fg transition-colors hover:border-border-strong',
        className,
      )}
    >
      {dark ? <Moon className="size-4" /> : <Sun className="size-4" />}
      {dark ? 'Tema escuro' : 'Tema claro'}
    </button>
  );
}
