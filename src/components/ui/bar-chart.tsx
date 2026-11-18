import { cn } from '@/lib/ui/cn';

export type BarChartPoint = {
  /** Chave estável da coluna. */
  key: string;
  /** Rótulo do eixo. */
  label: string;
  /** Uma entrada por série, na mesma ordem de `series`. */
  values: number[];
};

export type BarChartSeries = {
  name: string;
  tone: 'primary' | 'muted';
};

const TONE_BAR = {
  primary: 'bg-primary',
  muted: 'bg-surface-inset',
} as const;

const TONE_DOT = {
  primary: 'bg-primary',
  // P-26: a mesma cor da barra (token com tema escuro), com contorno para o ponto aparecer.
  muted: 'bg-surface-inset ring-1 ring-inset ring-border-strong',
} as const;

/**
 * Barras verticais em CSS — série simples ou agrupada.
 *
 * Sem biblioteca de gráfico: os gráficos das referências são barras com rótulo,
 * sem eixo Y, sem gridline e sem interação. Um recharts da vida custaria ~100kB
 * de bundle para desenhar `div`s com altura percentual.
 *
 * `formatValue` decide o rótulo sobre a barra; passar `null` esconde os rótulos
 * quando as colunas ficam estreitas demais para eles.
 */
export function BarChart({
  points,
  series,
  formatValue,
  className,
}: {
  points: BarChartPoint[];
  series: BarChartSeries[];
  formatValue?: ((value: number) => string) | null;
  className?: string;
}) {
  const max = Math.max(1, ...points.flatMap((p) => p.values));
  const showLabels = formatValue !== null && points.length <= 12;

  return (
    <div data-slot="bar-chart" className={cn('flex flex-col gap-(--sp-3)', className)}>
      {series.length > 1 ? (
        <div className="flex flex-wrap items-center gap-(--sp-4)">
          {series.map((s) => (
            <span
              key={s.name}
              className="flex items-center gap-2 text-(length:--fs-xs) text-fg-muted"
            >
              <span aria-hidden="true" className={cn('size-2 rounded-full', TONE_DOT[s.tone])} />
              {s.name}
            </span>
          ))}
        </div>
      ) : null}

      <div className="flex h-40 items-end gap-2">
        {points.map((point) => (
          <div key={point.key} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
            <div className="flex w-full flex-1 items-end justify-center gap-1">
              {point.values.map((value, si) => {
                const tone = series[si]?.tone ?? 'primary';
                return (
                  <div key={si} className="flex h-full min-w-0 flex-1 flex-col justify-end gap-1">
                    {showLabels && formatValue ? (
                      <span className="text-center text-(length:--fs-2xs) text-fg-subtle tabular-nums">
                        {value > 0 ? formatValue(value) : ''}
                      </span>
                    ) : null}
                    <div
                      className={cn('w-full rounded-(--r-sm)', TONE_BAR[tone])}
                      style={{ height: `${Math.max(2, (value / max) * 100)}%` }}
                    />
                  </div>
                );
              })}
            </div>
            <span className="w-full truncate text-center text-(length:--fs-2xs) text-fg-subtle">
              {point.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
