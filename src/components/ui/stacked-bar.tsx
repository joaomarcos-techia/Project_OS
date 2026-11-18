import type { ReactNode } from 'react';

import { cn } from '@/lib/ui/cn';

export type StackedSegment = {
  label: ReactNode;
  value: ReactNode;
  /** Peso relativo. A normalização é feita aqui — quem chama não precisa somar 100. */
  amount: number;
};

/** Tons da pilha, do mais forte ao mais fraco. Depois do quarto, repete o neutro. */
const SEGMENT_TONE = [
  'bg-primary',
  'bg-[color-mix(in_oklch,var(--primary)_55%,var(--surface))]',
  'bg-[color-mix(in_oklch,var(--primary)_28%,var(--surface))]',
  // P-26: token semântico, com valor no tema escuro (a escala neutra não muda com o tema).
  'bg-border-strong',
] as const;

/**
 * Distribuição numa barra só + legenda — as "Formas de recebimento" da
 * referência.
 *
 * Difere do `BreakdownList`: lá cada item tem a própria barra e a comparação é
 * item a item; aqui a barra é uma e o que se lê é a PARTICIPAÇÃO de cada fatia
 * no todo. Usar um pelo outro perde justamente a pergunta que a tela responde.
 */
export function StackedBar({
  segments,
  className,
  ...props
}: { segments: StackedSegment[]; className?: string } & Omit<
  React.ComponentProps<'div'>,
  'children' | 'className'
>) {
  const total = segments.reduce((acc, s) => acc + Math.max(0, s.amount), 0);
  if (segments.length === 0) return null;

  const pct = (amount: number) => (total === 0 ? 0 : (Math.max(0, amount) / total) * 100);

  return (
    <div data-slot="stacked-bar" className={cn('flex flex-col gap-(--sp-4)', className)} {...props}>
      <div aria-hidden="true" className="flex h-2 overflow-hidden rounded-full bg-surface-inset">
        {segments.map((s, i) => (
          <span
            key={i}
            className={SEGMENT_TONE[Math.min(i, SEGMENT_TONE.length - 1)]}
            style={{ width: `${pct(s.amount)}%` }}
          />
        ))}
      </div>
      <dl className="flex flex-col gap-2">
        {segments.map((s, i) => (
          <div key={i} className="flex items-baseline justify-between gap-(--sp-3)">
            <dt className="flex items-center gap-2 text-(length:--fs-body-sm) text-fg">
              <span
                aria-hidden="true"
                className={cn(
                  'size-2 shrink-0 rounded-full',
                  SEGMENT_TONE[Math.min(i, SEGMENT_TONE.length - 1)],
                )}
              />
              {s.label}
            </dt>
            <dd className="flex items-baseline gap-3 tabular-nums">
              <span className="text-(length:--fs-xs) text-fg-subtle">
                {Math.round(pct(s.amount))}%
              </span>
              <span className="text-(length:--fs-body-sm) font-medium text-fg">{s.value}</span>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
