import type { ReactNode } from 'react';

import { cn } from '@/lib/ui/cn';

export type BreakdownItem = {
  label: ReactNode;
  value: ReactNode;
  /** 0–100. Fora da faixa é grampeado: dado ruim encolhe a barra, não estoura o card. */
  percent: number;
};

/**
 * Rótulo + valor, barra e percentual — o "Faturamento por serviço" da
 * referência. A barra é `<div>` decorativo: o número já está no texto, então
 * repetir em `role="progressbar"` só faria o leitor de tela ler duas vezes.
 */
export function BreakdownList({
  items,
  className,
  ...props
}: { items: BreakdownItem[]; className?: string } & Omit<
  React.ComponentProps<'div'>,
  'children' | 'className'
>) {
  return (
    <div
      data-slot="breakdown-list"
      className={cn('flex flex-col gap-(--sp-4)', className)}
      {...props}
    >
      {items.map((item, i) => {
        const pct = Math.min(100, Math.max(0, item.percent));
        return (
          <div key={i} className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-(--sp-4)">
              <span className="text-(length:--fs-body-sm) text-fg">{item.label}</span>
              <span className="text-(length:--fs-body-sm) font-semibold tabular-nums">
                {item.value}
              </span>
            </div>
            <div className="flex items-center gap-2.5">
              <div
                aria-hidden="true"
                className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-inset"
              >
                <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
              </div>
              <span className="w-9 shrink-0 text-right text-(length:--fs-xs) text-fg-subtle tabular-nums">
                {Math.round(pct)}%
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
