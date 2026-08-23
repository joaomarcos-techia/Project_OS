import type { ReactNode } from 'react';

import { cn } from '@/lib/ui/cn';

export type SummaryRow = {
  label: ReactNode;
  value: ReactNode;
  /** Linha de fechamento: peso maior e separador acima. */
  emphasis?: boolean;
  tone?: 'neutral' | 'positive' | 'negative' | 'link';
};

/**
 * Lista rótulo/valor — o "Resultado do período" da referência.
 *
 * É `<dl>`, não tabela: são pares de definição, e um `<table>` prometeria ao
 * leitor de tela uma grade navegável por coluna que não existe aqui.
 */
export function SummaryList({
  rows,
  className,
  ...props
}: { rows: SummaryRow[]; className?: string } & Omit<
  React.ComponentProps<'dl'>,
  'children' | 'className'
>) {
  return (
    <dl data-slot="summary-list" className={cn('flex flex-col', className)} {...props}>
      {rows.map((row, i) => (
        <div
          key={i}
          className={cn(
            'flex items-baseline justify-between gap-(--sp-4) py-1.5',
            row.emphasis && 'mt-1.5 border-t border-border pt-3',
          )}
        >
          <dt
            className={cn(
              'text-(length:--fs-body-sm) text-fg-muted',
              row.emphasis && 'font-medium text-fg',
            )}
          >
            {row.label}
          </dt>
          <dd
            className={cn(
              'text-(length:--fs-body-sm) tabular-nums',
              row.emphasis ? 'font-semibold' : 'font-medium',
              row.tone === 'positive' && 'text-success-700 dark:text-success-200',
              row.tone === 'negative' && 'text-danger-600 dark:text-danger-200',
              row.tone === 'link' && 'text-link',
              (!row.tone || row.tone === 'neutral') && 'text-fg',
            )}
          >
            {row.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
