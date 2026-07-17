import type { ComponentProps } from 'react';

import { cn } from '@/lib/ui/cn';

/** Toolbar da tabela (busca/filtros/ações) — DS v2 §tbl-toolbar/filterbar. */
export function TableToolbar({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-2.5 border-b border-border bg-surface px-3.5 py-3',
        className,
      )}
      {...props}
    />
  );
}

/** Espaçador flexível da toolbar. */
export function TableToolbarSpacer() {
  return <span className="min-w-3 flex-1" aria-hidden="true" />;
}
