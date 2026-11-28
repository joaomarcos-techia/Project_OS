import { TrendingDown, TrendingUp } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { cn } from '@/lib/ui/cn';
import { cardSurfaceClassName } from './card';

/**
 * Direção da variação (para onde a seta aponta) e o TOM (se isso é bom ou ruim)
 * são coisas diferentes. Despesa subindo aponta para cima e é vermelha; a API
 * anterior derivava a cor da direção e por isso não conseguia dizer isso.
 */
export type DeltaTone = 'positive' | 'negative' | 'neutral';

export type StatDelta = {
  direction: 'up' | 'down';
  tone: DeltaTone;
  label: ReactNode;
};

/** StatCard — DS v2 §stat. Unifica os padrões antigos de KPI. */
export function StatCard({
  label,
  value,
  suffix,
  delta,
  hint,
  icon,
  emphasis = false,
  valueTone = 'default',
  href,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  /** Unidade discreta ao lado do valor (ex.: "min", "%"). */
  suffix?: ReactNode;
  delta?: StatDelta;
  hint?: ReactNode;
  icon?: ReactNode;
  /** Primeiro card de uma fileira: valor maior, como na referência. */
  emphasis?: boolean;
  /**
   * Cor do VALOR, por significado. Na referência "A receber" é laranja porque é
   * pendência e "Faturado" é verde porque entrou — não é enfeite, é a diferença
   * entre dinheiro que existe e dinheiro que falta.
   */
  valueTone?: 'default' | 'warning' | 'positive' | 'negative';
  /**
   * Indicador que leva ao lugar onde o número se resolve (ex.: "Aguardando" →
   * Consultório). Vira link inteiro, sem prefetch: um painel com vários
   * indicadores não deve renderizar as telas de destino em segundo plano.
   */
  href?: string;
  className?: string;
}) {
  const rootClassName = cn(
    cardSurfaceClassName,
    'flex min-w-0 flex-col gap-2 p-(--card-pad)',
    href && 'text-fg no-underline transition-colors duration-(--dur-fast) hover:bg-surface-hover',
    className,
  );
  const content = (
    <>
      {/* Label à esquerda, ícone à direita: à esquerda o ícone empurrava o
          rótulo e desalinhava a coluna de labels entre os cards da fileira. */}
      <div data-slot="stat-label" className="flex items-start justify-between gap-2">
        <span className="text-(length:--fs-2xs) font-medium tracking-(--tracking-label) text-fg-subtle uppercase">
          {label}
        </span>
        {icon ? (
          <span aria-hidden="true" className="shrink-0 text-fg-subtle [&>svg]:size-4">
            {icon}
          </span>
        ) : null}
      </div>

      <div
        data-slot="stat-value"
        className={cn(
          'leading-none font-semibold tracking-(--tracking-tight) tabular-nums',
          emphasis ? 'text-(length:--fs-h1)' : 'text-(length:--fs-h2)',
          valueTone === 'warning' && 'text-warning-700 dark:text-warning-200',
          valueTone === 'positive' && 'text-success-700 dark:text-success-200',
          valueTone === 'negative' && 'text-danger-600 dark:text-danger-200',
        )}
      >
        {value}
        {suffix ? (
          <small className="text-(length:--fs-sm) font-medium text-fg-subtle"> {suffix}</small>
        ) : null}
      </div>

      {delta ? (
        <span
          className={cn(
            'inline-flex items-center gap-1.5 text-(length:--fs-xs) font-semibold',
            delta.tone === 'positive' && 'text-success-600 dark:text-success-200',
            delta.tone === 'negative' && 'text-danger-600 dark:text-danger-200',
            delta.tone === 'neutral' && 'text-fg-muted',
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
        <span data-slot="stat-hint" className="text-(length:--fs-xs) text-fg-subtle">
          {hint}
        </span>
      ) : null}
    </>
  );

  return href ? (
    <Link href={href} prefetch={false} data-slot="stat-card" className={rootClassName}>
      {content}
    </Link>
  ) : (
    <div data-slot="stat-card" className={rootClassName}>
      {content}
    </div>
  );
}
