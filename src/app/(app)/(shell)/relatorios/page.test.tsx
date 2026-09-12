// @vitest-environment happy-dom
import type { ComponentProps } from 'react';

import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PERMISSIONS } from '@/lib/auth/permissions';

import type * as ReportData from './data';

const { getRelatorios, requireClinicId, requireUser } = vi.hoisted(() => ({
  getRelatorios: vi.fn(),
  requireClinicId: vi.fn(),
  requireUser: vi.fn(),
}));

vi.mock('next/link', () => ({
  default: (props: ComponentProps<'a'>) => <a {...props} />,
}));
vi.mock('@/lib/auth/tenant-context', () => ({ requireClinicId, requireUser }));
vi.mock('./data', async (original) => ({
  ...(await original<typeof ReportData>()),
  getRelatorios,
}));

import RelatoriosPage from './page';

const report = {
  faturamento: { recebido: 1200, pago: 250, saldo: 950 },
  noShow: { faltou: 2, atendido: 8, cancelado: 1, total: 11, taxa: 0.2 },
  ocupacao: { busyMinutes: 600, freeMinutes: 400, taxa: 0.6 },
  semanas: [
    {
      weekStart: '2026-08-10',
      label: '10 – 16 de agosto',
      recebido: 800,
      pago: 200,
      saldo: 600,
      atendido: 5,
    },
    // Semana sem lançamento: a UI deve escrever "sem dado", não "R$ 0,00".
    {
      weekStart: '2026-08-17',
      label: '17 – 23 de agosto',
      recebido: null,
      pago: null,
      saldo: null,
      atendido: null,
    },
  ],
  fromLabel: '22/07',
  toLabel: '20/08',
  timezone: 'America/Sao_Paulo',
  accountingMonth: '2026-08',
};

afterEach(cleanup);

describe('RelatoriosPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireClinicId.mockResolvedValue('clinic-1');
    requireUser.mockResolvedValue({ permissions: [] });
    getRelatorios.mockResolvedValue(report);
  });

  it('usa faixa única de métricas e não consulta faturamento sem permissão', async () => {
    render(await RelatoriosPage({ searchParams: Promise.resolve({ periodo: '30d' }) }));

    expect(getRelatorios).toHaveBeenCalledWith('clinic-1', 30, { includeFaturamento: false });
    // Sem view:financial a seção de dinheiro não existe — nem vazia, nem zerada.
    expect(screen.queryByRole('region', { name: 'Financeiro do período' })).toBeNull();
    expect(screen.getByRole('region', { name: 'Faltas' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Ocupação' })).toBeTruthy();
    // Os desfechos seguem visíveis: contagem de consulta não é dado financeiro.
    expect(screen.getByText('Consultas no período')).toBeTruthy();
    expect(screen.getByText('Canceladas')).toBeTruthy();
    expect(
      screen.queryByRole('region', { name: 'Exportação financeira para contabilidade' }),
    ).toBeNull();
  });

  it('mantém período, exportação e faturamento descobertos com permissão', async () => {
    requireUser.mockResolvedValue({ permissions: [PERMISSIONS.VIEW_FINANCIAL] });

    render(await RelatoriosPage({ searchParams: Promise.resolve({ periodo: '7d' }) }));

    expect(getRelatorios).toHaveBeenCalledWith('clinic-1', 7, { includeFaturamento: true });
    const financeiro = screen.getByRole('region', { name: 'Financeiro do período' });
    expect(within(financeiro).getByText('Recebido')).toBeTruthy();
    expect(within(financeiro).getByText('Saldo')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Últimos 7 dias' }).getAttribute('aria-current')).toBe(
      'page',
    );
    expect(screen.getByRole('link', { name: 'Exportar PDF' }).className).toContain(
      'min-h-(--hit-target)',
    );
    const accounting = screen.getByRole('region', {
      name: 'Exportação financeira para contabilidade',
    });
    expect(within(accounting).getByLabelText('Mês de referência').getAttribute('value')).toBe(
      '2026-08',
    );
    expect(within(accounting).getByRole('button', { name: 'Exportar CSV' })).toBeTruthy();
    expect(within(accounting).getByText(/não substitui nota fiscal/i)).toBeTruthy();
  });
});
