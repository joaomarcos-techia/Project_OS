import { BarChart } from '@/components/ui/bar-chart';

export type RevenuePoint = { date: string; label: string; recebido: number };

const compact = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });

/**
 * Faturamento de 7 dias. Fina sobre `BarChart`: a série e o formato do rótulo
 * são a única coisa específica do dashboard.
 *
 * O destaque de "hoje" saiu. Ele existia para dar um ponto de referência ao
 * olho, mas o eixo já traz o dia e a última coluna é sempre hoje — pintar uma
 * barra de outra cor gastava significado de cor para repetir o que a posição
 * dizia.
 */
export function RevenueChart({ points }: { points: RevenuePoint[] }) {
  return (
    <BarChart
      series={[{ name: 'Recebido', tone: 'primary' }]}
      points={points.map((p) => ({ key: p.date, label: p.label, values: [p.recebido] }))}
      formatValue={(v) => compact.format(v)}
    />
  );
}
