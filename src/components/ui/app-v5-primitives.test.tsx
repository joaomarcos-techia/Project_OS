// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Badge } from './badge';
import { MetricStrip } from './metric-strip';
import { PanelCard } from './panel-card';
import { StatCard } from './stat-card';
import { AppointmentStatusBadge } from './status-badge';

afterEach(cleanup);

describe('PanelCard — opções do app v5', () => {
  it('sem as opções novas segue h4, com padding e sem data-flush', () => {
    const { container } = render(<PanelCard title="Resumo">corpo</PanelCard>);
    expect(screen.getByRole('heading', { level: 4, name: 'Resumo' })).toBeTruthy();
    const card = container.querySelector('[data-slot="panel-card"]');
    expect(card?.getAttribute('data-flush')).toBeNull();
    expect(card?.className).toContain('p-(--sp-4)');
  });

  it('mantém o título a dois níveis do cartão, com o contador como irmão', () => {
    const { container } = render(
      <PanelCard title="Próximos" headingLevel={2} count={<span>4</span>} flush>
        corpo
      </PanelCard>,
    );
    const heading = screen.getByRole('heading', { level: 2, name: 'Próximos' });
    const card = container.querySelector('[data-slot="panel-card"]');
    expect(heading.parentElement?.parentElement).toBe(card);
    expect(heading.textContent).toBe('Próximos');
    expect(container.querySelector('[data-slot="panel-count"]')?.textContent).toBe('4');
    expect(card?.getAttribute('data-flush')).toBe('true');
  });

  it('o conteúdo livre do canto substitui a ação', () => {
    render(
      <PanelCard
        title="Gráfico"
        description="Últimos 7 dias"
        aside={<span>Legenda</span>}
        action={{ label: 'Abrir', href: '/x' }}
      >
        corpo
      </PanelCard>,
    );
    expect(screen.getByText('Legenda')).toBeTruthy();
    expect(screen.getByText('Últimos 7 dias')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Abrir' })).toBeNull();
  });
});

describe('StatCard e MetricStrip — faixa do app v5', () => {
  it('sem href continua não interativo', () => {
    const { container } = render(<StatCard label="A receber" value="R$ 10,00" />);
    expect(screen.queryByRole('link')).toBeNull();
    expect(container.querySelector('div[data-slot="stat-card"]')).toBeTruthy();
  });

  it('com href o indicador inteiro vira link e o rótulo fica a dois níveis dele', () => {
    render(<StatCard href="/consultorio" label="Aguardando" value={2} hint="na sala" />);
    const link = screen.getByRole('link');
    expect(link.getAttribute('href')).toBe('/consultorio');
    expect(link.getAttribute('data-slot')).toBe('stat-card');
    expect(screen.getByText('Aguardando').parentElement?.parentElement).toBe(link);
  });

  it('a faixa padrão não muda e a unida aceita um nome próprio', () => {
    const { rerender } = render(<MetricStrip />);
    const padrao = screen.getByRole('region', { name: 'Métricas principais' });
    expect(padrao.getAttribute('data-variant')).toBe('cards');
    expect(padrao.className).toContain('auto-fit');

    rerender(<MetricStrip variant="joined" aria-label="Sala de espera" />);
    const unida = screen.getByRole('region', { name: 'Sala de espera' });
    expect(unida.getAttribute('data-variant')).toBe('joined');
    expect(unida.className).not.toContain('auto-fit');
  });
});

describe('Badge — gramática de status', () => {
  it('expõe tom e ponto para o CSS do app da clínica', () => {
    const { container, rerender } = render(<Badge>Sem tom</Badge>);
    let badge = container.querySelector('[data-slot="badge"]');
    expect(badge?.getAttribute('data-tone')).toBe('gray');
    expect(badge?.getAttribute('data-dot')).toBeNull();

    rerender(
      <Badge tone="amber" dot>
        Com ponto
      </Badge>,
    );
    badge = container.querySelector('[data-slot="badge"]');
    expect(badge?.getAttribute('data-tone')).toBe('amber');
    expect(badge?.getAttribute('data-dot')).toBe('true');
  });

  it.each([
    ['agendado', 'gray', 'Agendada'],
    ['confirmado', 'green', 'Confirmada'],
    ['chegou', 'amber', 'Aguardando'],
    ['em_atendimento', 'blue', 'Em atendimento'],
    ['atendido', 'navy', 'Finalizada'],
    ['cancelado', 'line', 'Cancelada'],
    ['faltou', 'orange', 'Falta'],
  ] as const)('consulta %s usa o tom %s e o rótulo %s', (status, tone, label) => {
    const { container } = render(<AppointmentStatusBadge status={status} />);
    expect(container.querySelector('[data-slot="badge"]')?.getAttribute('data-tone')).toBe(tone);
    expect(screen.getByText(label)).toBeTruthy();
  });
});
