import type { ReactNode } from 'react';

import { cn } from '@/lib/ui/cn';

import { Avatar } from './avatar';
import { TableCellStack } from './table';

/**
 * Identidade de uma entidade numa linha de tabela — avatar + nome + sublinha.
 *
 * Compõe `Avatar` e `TableCellStack` em vez de reimplementar a pilha de duas
 * linhas: a sublinha muda de estilo num lugar só. `leading` troca o avatar por
 * um ícone quando a entidade não é pessoa (documento, lançamento).
 */
export function EntityCell({
  name,
  sub,
  leading,
  className,
}: {
  name: ReactNode;
  sub?: ReactNode;
  /** Substitui o avatar — para entidades que não são pessoas. */
  leading?: ReactNode;
  className?: string;
}) {
  return (
    <div data-slot="entity-cell" className={cn('flex min-w-0 items-center gap-2.5', className)}>
      {leading ?? (typeof name === 'string' ? <Avatar name={name} /> : null)}
      <TableCellStack className="min-w-0" main={name} sub={sub} />
    </div>
  );
}

/** Moldura do ícone à esquerda, quando a entidade não é pessoa. */
export function EntityIcon({ children }: { children: ReactNode }) {
  return (
    <span
      aria-hidden="true"
      className="grid size-8 shrink-0 place-items-center rounded-(--r-sm) bg-surface-inset text-fg-subtle [&>svg]:size-4"
    >
      {children}
    </span>
  );
}
