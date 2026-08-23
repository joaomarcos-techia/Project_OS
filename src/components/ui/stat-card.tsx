import { TrendingDown, TrendingUp } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/ui/cn';
import { Card } from './card';

/**
 * StatCard — DS v2 §stat. Unifica os dois padrões antigos
 * (admin/_components/stat-card.tsx e `.kpi` inline do dashboard).
 */
export function StatCard({
  label,
  value,
  suffix,
  delta,
  hint,
  icon,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  /** Unidade discreta ao lado do valor (ex.: "min", "%"). */
  suffix?: ReactNode;
  /** Variação vs período anterior; direção dita a cor. */
  delta?: { direction: 'up' | 'down'; label: ReactNode };
  hint?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <Card
      data-slot="stat-card"
      className={cn('flex min-w-0 flex-col gap-2 p-(--card-pad)', className)}
    >
      <div className="flex items-center gap-2">
        {icon ? (
          <span aria-hidden="true" className="text-fg-subtle [&>svg]:size-4">
            {icon}
          </span>
        ) : null}
        <span className="text-(length:--fs-2xs) font-medium tracking-(--tracking-label) text-fg-subtle uppercase">
          {label}
        </span>
      </div>
      {/* Numeral em sans com tabular-nums: alinha coluna como mono alinhava, sem
          o desvio de familia que fazia o KPI parecer de outro produto. */}
      <div className="text-(length:--fs-h2) leading-none font-semibold tracking-(--tracking-tight) tabular-nums">
        {value}
        {suffix ? (
          <small className="text-(length:--fs-sm) font-medium text-fg-subtle"> {suffix}</small>
        ) : null}
      </div>
      {delta ? (
        <span
          className={cn(
            'inline-flex items-center gap-1.5 text-(length:--fs-xs) font-semibold',
            delta.direction === 'up'
              ? 'text-success-600 dark:text-success-200'
              : 'text-danger-600 dark:text-danger-200',
          )}
        >
          {delta.direction === 'up' ? (
            <TrendingUp aria-hidden="true" className="size-3.5" />
          ) : (
            <TrendingDown aria-hidden="true" className="size-3.5" />
          )}
          {delta.label}
        </span>
      ) : hint ? (
        <span className="text-(length:--fs-xs) text-fg-subtle">{hint}</span>
      ) : null}
    </Card>
  );
}
