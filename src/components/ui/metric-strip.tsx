import type { ComponentProps } from 'react';

import { cn } from '@/lib/ui/cn';

/**
 * Fileira de métricas — cards separados por gap.
 *
 * Era uma faixa única com os cards colados por `gap-px` sobre a borda. A
 * referência usa cards independentes, e a faixa colada tinha um efeito colateral
 * ruim: sem gap, o card deixava de ser uma superfície e a fileira lia como uma
 * tabela de uma linha, competindo com as tabelas de verdade da página.
 *
 * `auto-fit` com base de 11rem: cinco KPIs cabem numa linha em desktop e
 * quebram sozinhos antes de espremer o número, sem breakpoint escrito à mão —
 * era o que produzia a linha órfã de dois cards em telas médias (P-09).
 */
export function MetricStrip({
  className,
  variant = 'cards',
  ...props
}: ComponentProps<'section'> & {
  /**
   * `joined` é a faixa do app v5: os indicadores ficam juntos numa borda só,
   * separados por linhas finas, em vez de um cartão por número. Cada um ocupa
   * no mínimo `--kc-min` e a faixa quebra sozinha quando a largura acaba.
   */
  variant?: 'cards' | 'joined';
}) {
  return (
    <section
      data-slot="metric-strip"
      data-variant={variant}
      aria-label="Métricas principais"
      className={cn(
        variant === 'joined'
          ? [
              'flex flex-wrap overflow-hidden rounded-(--card-radius) border border-border bg-surface',
              '[&>[data-slot=stat-card]]:min-w-0 [&>[data-slot=stat-card]]:flex-[1_1_var(--kc-min,11rem)]',
              '[&>[data-slot=stat-card]]:rounded-none [&>[data-slot=stat-card]]:border-0 [&>[data-slot=stat-card]]:bg-transparent',
              '[&>[data-slot=stat-card]]:shadow-[1px_0_0_var(--border-soft),0_1px_0_var(--border-soft)]',
            ]
          : 'grid grid-cols-[repeat(auto-fit,minmax(min(100%,11rem),1fr))] gap-(--sp-3)',
        className,
      )}
      {...props}
    />
  );
}
