// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { BarChart } from './bar-chart';
import { BreakdownList } from './breakdown-list';
import { StackedBar } from './stacked-bar';
import { StatCard } from './stat-card';
import { SummaryList } from './summary-list';

afterEach(cleanup);

describe('StatCard — tom é significado, não direção', () => {
  it('pinta de vermelho uma alta que é ruim (despesa subindo)', () => {
    render(
      <StatCard
        label="Despesas"
        value="R$ 18.430"
        delta={{ direction: 'up', tone: 'negative', label: '4,1% vs julho' }}
      />,
    );
    expect(screen.getByText('4,1% vs julho').className).toContain('text-danger-600');
  });

  it('pinta de verde uma alta que é boa, com a mesma seta', () => {
    render(
      <StatCard
        label="Faturamento"
        value="R$ 48.720"
        delta={{ direction: 'up', tone: 'positive', label: '12,4% vs julho' }}
      />,
    );
    expect(screen.getByText('12,4% vs julho').className).toContain('text-success-600');
  });

  it('dá ao primeiro card da fileira o degrau maior', () => {
    const { container } = render(<StatCard emphasis label="Saldo" value="R$ 1.840" />);
    expect(container.querySelector('[data-slot="stat-card"]')?.innerHTML).toContain('--fs-h1');
  });
});

describe('SummaryList', () => {
  it('separa a linha de fechamento das parcelas', () => {
    const { container } = render(
      <SummaryList
        rows={[
          { label: 'Receitas', value: 'R$ 42.180' },
          { label: 'Resultado', value: 'R$ 23.750', emphasis: true, tone: 'positive' },
        ]}
      />,
    );
    const rows = container.querySelectorAll('dl > div');
    expect(rows[0]?.className).not.toContain('border-t');
    expect(rows[1]?.className).toContain('border-t');
  });
});

describe('BreakdownList', () => {
  it('grampeia percentual fora da faixa em vez de estourar a barra', () => {
    const { container } = render(
      <BreakdownList items={[{ label: 'Pix', value: 'R$ 10', percent: 320 }]} />,
    );
    const bar = container.querySelector('[data-slot="breakdown-list"] div[style]') as HTMLElement;
    expect(bar.style.width).toBe('100%');
    expect(screen.getByText('100%')).toBeTruthy();
  });

  it('não deixa percentual negativo virar largura negativa', () => {
    const { container } = render(
      <BreakdownList items={[{ label: 'Pix', value: 'R$ 0', percent: -5 }]} />,
    );
    const bar = container.querySelector('[data-slot="breakdown-list"] div[style]') as HTMLElement;
    expect(bar.style.width).toBe('0%');
  });
});

describe('StackedBar', () => {
  it('normaliza sozinho — quem chama não precisa somar 100', () => {
    render(
      <StackedBar
        segments={[
          { label: 'Atendidos', value: 3, amount: 3 },
          { label: 'Faltas', value: 1, amount: 1 },
        ]}
      />,
    );
    expect(screen.getByText('75%')).toBeTruthy();
    expect(screen.getByText('25%')).toBeTruthy();
  });

  it('não divide por zero quando tudo é zero', () => {
    render(<StackedBar segments={[{ label: 'Atendidos', value: 0, amount: 0 }]} />);
    expect(screen.getByText('0%')).toBeTruthy();
  });
});

describe('BarChart', () => {
  it('só mostra legenda quando há mais de uma série', () => {
    const { rerender } = render(
      <BarChart
        series={[{ name: 'Recebido', tone: 'primary' }]}
        points={[{ key: 'a', label: 'Seg', values: [10] }]}
      />,
    );
    expect(screen.queryByText('Recebido')).toBeNull();

    rerender(
      <BarChart
        series={[
          { name: 'Faturado', tone: 'primary' },
          { name: 'Recebido', tone: 'muted' },
        ]}
        points={[{ key: 'a', label: 'Seg', values: [10, 5] }]}
      />,
    );
    expect(screen.getByText('Faturado')).toBeTruthy();
  });

  it('não quebra quando todos os valores são zero', () => {
    render(
      <BarChart
        series={[{ name: 'Recebido', tone: 'primary' }]}
        points={[{ key: 'a', label: 'Seg', values: [0] }]}
      />,
    );
    expect(screen.getByText('Seg')).toBeTruthy();
  });

  it('esconde rótulos quando há colunas demais para caberem', () => {
    render(
      <BarChart
        series={[{ name: 'x', tone: 'primary' }]}
        points={Array.from({ length: 20 }, (_, i) => ({
          key: String(i),
          label: `d${i}`,
          values: [100],
        }))}
        formatValue={(v) => String(v)}
      />,
    );
    expect(screen.queryByText('100')).toBeNull();
  });
});
