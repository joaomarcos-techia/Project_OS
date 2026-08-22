// @vitest-environment happy-dom
import type { ComponentProps } from 'react';

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({
  default: (props: ComponentProps<'a'>) => <a {...props} />,
}));

import { EmptyState } from './empty-state';
import { MetricStrip } from './metric-strip';
import { PageHeader } from './page-header';
import { StatCard } from './stat-card';

afterEach(cleanup);

describe('foundations densas de página', () => {
  it('usa a escala tipográfica normativa no título e na descrição', () => {
    render(<PageHeader title="Pacientes" description="Operação clínica" />);

    expect(screen.getByRole('heading', { level: 1 }).className).toContain('--fs-h2');
    expect(screen.getByText('Operação clínica').className).toContain('--fs-base');
  });

  it('oferece empty state padrão reduzido e variante compacta', () => {
    const { rerender } = render(<EmptyState title="Sem resultados" />);
    expect(screen.getByText('Sem resultados').parentElement?.className).toContain('py-(--sp-8)');

    rerender(<EmptyState title="Sem resultados" variant="compact" />);
    expect(screen.getByText('Sem resultados').parentElement?.className).toContain('py-(--sp-5)');
  });

  it('agrupa métricas numa superfície única e mantém números tabulares', () => {
    render(
      <MetricStrip>
        <StatCard label="Consultas" value={12} />
        <StatCard label="Faltas" value={2} />
      </MetricStrip>,
    );

    expect(screen.getByRole('region', { name: 'Métricas principais' }).className).toContain(
      'auto-fit',
    );
    expect(screen.getByText('12').className).toContain('tabular-nums');
    expect(screen.getByText('12').closest('[data-slot="stat-card"]')).not.toBeNull();
  });
});
