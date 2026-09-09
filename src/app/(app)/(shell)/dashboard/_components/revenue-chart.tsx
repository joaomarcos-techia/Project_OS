import { BarChart } from '@/components/ui/bar-chart';
import styles from '../dashboard.module.css';

export type RevenuePoint = { date: string; label: string; recebido: number };

const compact = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });

/**
 * Faturamento de 7 dias. Fina sobre `BarChart`: a série e o formato do rótulo
 * são a única coisa específica do dashboard.
 *
 * A última coluna destaca o recebido hoje; as anteriores mostram os dias
 * fechados. A série continua sendo calculada no fuso da clínica pela página.
 */
export function RevenueChart({ points }: { points: RevenuePoint[] }) {
  return (
    <div className={styles.revenue ?? ''}>
      <BarChart
        series={[{ name: 'Recebido', tone: 'primary' }]}
        points={points.map((p, i) => ({
          key: p.date,
          label: i === points.length - 1 ? 'hoje' : p.label,
          values: [p.recebido],
        }))}
        formatValue={(v) => compact.format(v)}
      />
    </div>
  );
}
