'use client';

import { X } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/ui/cn';

/**
 * Barra de seleção da tabela — DS v2 §selbar. Renderizar somente quando houver
 * linhas selecionadas E uma bulk action real (UX honesta).
 */
export function TableSelectionBar({
  count,
  onClear,
  children,
  className,
}: {
  count: number;
  onClear: () => void;
  /** Ações em lote (botões). */
  children?: ReactNode;
  className?: string;
}) {
  if (count === 0) return null;
  return (
    <div
      className={cn(
        'flex items-center gap-3 border-b border-[color-mix(in_oklch,var(--primary)_25%,transparent)] bg-(--primary-soft) px-3.5 py-2 text-(length:--fs-sm) dark:bg-surface-2',
        className,
      )}
    >
      <span className="font-semibold text-(--primary-active) dark:text-fg">
        {count} selecionado{count > 1 ? 's' : ''}
      </span>
      {children}
      <button
        type="button"
        onClick={onClear}
        aria-label="Limpar seleção"
        className="ml-auto grid size-6 place-items-center rounded-(--r-xs) text-fg-subtle transition-colors hover:bg-surface-hover hover:text-fg"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
