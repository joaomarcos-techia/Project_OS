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
export function MetricStrip({ className, ...props }: ComponentProps<'section'>) {
  return (
    <section
      aria-label="Métricas principais"
      className={cn(
        'grid grid-cols-[repeat(auto-fit,minmax(min(100%,11rem),1fr))] gap-(--sp-3)',
        className,
      )}
      {...props}
    />
  );
}
