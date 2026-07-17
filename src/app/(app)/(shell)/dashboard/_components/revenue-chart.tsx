import { formatBRL } from '@/lib/format';

export type RevenuePoint = { date: string; label: string; recebido: number };

/**
 * Barras de faturamento (7 dias) — DS v2 §barchart em CSS puro (sem lib).
 * Última barra = hoje (destacada em viz-8, como no mockup do Painel).
 */
export function RevenueChart({ points }: { points: RevenuePoint[] }) {
  const max = Math.max(1, ...points.map((p) => p.recebido));
  return (
    <div className="flex h-44 gap-2.5">
      {points.map((p, i) => {
        const hoje = i === points.length - 1;
        const h = Math.max(2, Math.round((p.recebido / max) * 100));
        return (
          <div
            key={p.date}
            className="flex min-w-0 flex-1 flex-col items-center gap-1.5"
            title={`${p.label}: ${formatBRL(p.recebido)}`}
          >
            <div className="flex w-full flex-1 items-end">
              <div
                className={
                  hoje
                    ? 'w-full rounded-t-(--r-xs) bg-(--viz-8)'
                    : 'w-full rounded-t-(--r-xs) bg-(--viz-1)'
                }
                style={{ height: `${h}%` }}
              />
            </div>
            <span className="font-mono text-(length:--fs-2xs) text-fg-subtle uppercase">
              {p.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}
