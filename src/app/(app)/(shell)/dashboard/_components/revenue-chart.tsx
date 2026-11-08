import { formatBRL } from '@/lib/format';
import { cn } from '@/lib/ui/cn';

import styles from '../dashboard.module.css';

export type RevenuePoint = { date: string; label: string; recebido: number };

const compact = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });

/** Altura útil das barras dentro da área de 184 px (o resto é o rótulo de valor). */
const PLOT_PX = 160;

/** Teto "redondo" da escala: 1, 2, 2,5 ou 5 vezes uma potência de dez. */
function niceMax(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 2.5, 5, 10]) {
    if (step * magnitude >= value) return step * magnitude;
  }
  return 10 * magnitude;
}

function ddmm(date: string): string {
  const [, month, day] = date.split('-');
  return `${day}/${month}`;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Faturamento recebido nos últimos 7 dias — gráfico do app v5.
 *
 * Todas as barras são do mesmo azul; hoje é a mesma cor HACHURADA, porque o dia
 * ainda não fechou: pintada sólida ao lado de dias completos, a barra de hoje
 * inventaria uma queda toda manhã. Rótulo de valor só no maior dia e em hoje,
 * dica com o valor exato ao passar o mouse, e a série inteira por extenso no
 * `aria-label` — a leitura de quem não vê as barras.
 */
export function RevenueChart({ points, updatedAt }: { points: RevenuePoint[]; updatedAt: string }) {
  const top = niceMax(Math.max(...points.map((p) => p.recebido), 0));
  const maxValue = Math.max(...points.map((p) => p.recebido));
  const maxIndex = points.findIndex((p) => p.recebido === maxValue && maxValue > 0);
  const lastIndex = points.length - 1;

  const description = points
    .map((p, i) =>
      i === lastIndex
        ? `hoje ${formatBRL(p.recebido)} até ${updatedAt}`
        : `${p.label} ${formatBRL(p.recebido)}`,
    )
    .join(', ');

  return (
    <div className={styles.chart}>
      <div role="img" aria-label={`Faturamento recebido nos últimos 7 dias: ${description}.`}>
        <div className={styles.plot}>
          <div aria-hidden="true" className={styles.gridLine} style={{ bottom: PLOT_PX }} />
          <span aria-hidden="true" className={styles.axisLabel} style={{ bottom: PLOT_PX - 8 }}>
            {compact.format(top)}
          </span>
          <div aria-hidden="true" className={styles.gridLine} style={{ bottom: PLOT_PX / 2 }} />
          <span aria-hidden="true" className={styles.axisLabel} style={{ bottom: PLOT_PX / 2 - 8 }}>
            {compact.format(top / 2)}
          </span>

          <div aria-hidden="true" className={styles.bars}>
            {points.map((p, i) => {
              const today = i === lastIndex;
              const empty = p.recebido <= 0;
              const height = empty ? 2 : Math.max(2, Math.round((p.recebido / top) * PLOT_PX));
              const showLabel = !empty && (today || i === maxIndex);
              const tip = today
                ? `Hoje até ${updatedAt} · ${formatBRL(p.recebido)}`
                : `${capitalize(p.label)}, ${ddmm(p.date)} · ${formatBRL(p.recebido)}`;
              return (
                <div key={p.date} className={styles.bar}>
                  <span className={styles.barLabel}>
                    {showLabel ? compact.format(p.recebido) : ''}
                  </span>
                  <span
                    className={cn(styles.barBody, today && !empty && styles.hatch)}
                    data-empty={empty ? 'true' : undefined}
                    style={{ height }}
                  >
                    <span className={styles.tip}>{tip}</span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
        <div aria-hidden="true" className={styles.days}>
          {points.map((p, i) => (
            <span key={p.date} data-today={i === lastIndex ? 'true' : undefined}>
              {i === lastIndex ? 'hoje' : p.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Legenda do cabeçalho: a hachura é o dia em curso. */
export function RevenueTodayLegend({ updatedAt }: { updatedAt: string }) {
  return (
    <span className={styles.legendToday}>
      <span aria-hidden="true" className={cn(styles.legendSwatch, styles.hatch)} />
      Hoje, até {updatedAt}
    </span>
  );
}
