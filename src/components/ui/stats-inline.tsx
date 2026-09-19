import type { ReactNode } from 'react';

import { cn } from '@/lib/ui/cn';

export type InlineStat = {
  label: ReactNode;
  /** `attention` tinge o item de âmbar — para o que pede ação, não para enfeitar. */
  tone?: 'neutral' | 'attention' | 'positive' | 'negative';
};

/**
 * Métricas de uma lista em UMA linha de texto, separadas por ponto médio.
 *
 * Substitui a fileira de KPI cards no topo de página de listagem: cinco cards
 * ocupavam ~140px de altura para dizer o que cabe numa linha, empurrando a
 * tabela — o conteúdo real — para baixo da dobra.
 */
export function StatsInline({
  items,
  className,
  ...props
}: { items: InlineStat[]; className?: string } & Omit<
  React.ComponentProps<'p'>,
  'children' | 'className'
>) {
  if (items.length === 0) return null;
  return (
    <p
      data-slot="stats-inline"
      className={cn(
        'flex flex-wrap items-center gap-x-2 gap-y-1 text-(length:--fs-body-sm) text-fg-muted',
        className,
      )}
      {...props}
    >
      {items.map((item, i) => (
        <span key={i} className="flex items-center gap-2">
          {i > 0 ? (
            <span aria-hidden="true" className="text-fg-subtle">
              ·
            </span>
          ) : null}
          <span
            className={cn(
              item.tone === 'attention' && 'font-medium text-warning-700 dark:text-warning-200',
              item.tone === 'positive' && 'font-medium text-success-700 dark:text-success-200',
              item.tone === 'negative' && 'font-medium text-danger-600 dark:text-danger-200',
            )}
          >
            {item.label}
          </span>
        </span>
      ))}
    </p>
  );
}
