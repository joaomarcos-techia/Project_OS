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
  fromLabel: '22/07',
  toLabel: '20/08',
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
    const metrics = screen.getByRole('region', { name: 'Métricas principais' });
    expect(within(metrics).queryByText('Faturamento (recebido)')).toBeNull();
    expect(within(metrics).getByText('No-show')).toBeTruthy();
    expect(within(metrics).getByText('Ocupação')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Volume de atendimentos' })).toBeTruthy();
    expect(
      screen.queryByRole('region', { name: 'Exportação financeira para contabilidade' }),
    ).toBeNull();
  });

  it('mantém período, exportação e faturamento descobertos com permissão', async () => {
    requireUser.mockResolvedValue({ permissions: [PERMISSIONS.VIEW_FINANCIAL] });

    render(await RelatoriosPage({ searchParams: Promise.resolve({ periodo: '7d' }) }));

    expect(getRelatorios).toHaveBeenCalledWith('clinic-1', 7, { includeFaturamento: true });
    expect(screen.getByText('Faturamento (recebido)')).toBeTruthy();
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
