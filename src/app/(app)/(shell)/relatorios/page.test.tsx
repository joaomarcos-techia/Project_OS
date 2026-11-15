// @vitest-environment happy-dom
import type { ComponentProps } from 'react';

import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PERMISSIONS } from '@/lib/auth/permissions';

import type * as ReportData from './data';

const {
  getRelatorios,
  getCurrentPractitioner,
  requireClinicId,
  requireUser,
  hasAdvancedFinancialPolicies,
} = vi.hoisted(() => ({
  getRelatorios: vi.fn(),
  hasAdvancedFinancialPolicies: vi.fn(),
  getCurrentPractitioner: vi.fn(),
  requireClinicId: vi.fn(),
  requireUser: vi.fn(),
}));

vi.mock('@/contexts/billing/api', () => ({ billingApiV1: { hasAdvancedFinancialPolicies } }));
vi.mock('next/link', () => ({
  default: (props: ComponentProps<'a'>) => <a {...props} />,
}));
// A página lê o usuário por `requirePageUser` (sessão morta vai para /login, OBS-001). Aqui ele
// delega ao `requireUser` simulado, para os cenários continuarem os mesmos; o redirecionamento
// tem teste próprio em `src/lib/auth/page-guard.test.ts`.
vi.mock('@/lib/auth/page-guard', () => ({
  requirePageUser: async () => (await import('@/lib/auth/tenant-context')).requireUser(),
}));
vi.mock('@/lib/auth/tenant-context', () => ({ requireClinicId, requireUser }));
vi.mock('@/contexts/identity/internal/practitioner', () => ({ getCurrentPractitioner }));
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
    hasAdvancedFinancialPolicies.mockResolvedValue(true);
    requireClinicId.mockResolvedValue('clinic-1');
    requireUser.mockResolvedValue({ permissions: [] });
    getRelatorios.mockResolvedValue(report);
    getCurrentPractitioner.mockResolvedValue(false);
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
    expect(screen.queryByRole('link', { name: 'Ver repasses por mês' })).toBeNull();
  });

  it('descobre o relatório próprio para titular médico mesmo sem view:financial', async () => {
    getCurrentPractitioner.mockResolvedValue(true);
    render(await RelatoriosPage({ searchParams: Promise.resolve({ periodo: '30d' }) }));
    expect(screen.getByRole('link', { name: 'Ver repasses por mês' })).toBeTruthy();
    expect(getRelatorios).toHaveBeenCalledWith('clinic-1', 30, { includeFaturamento: false });
  });

  it('não oferece o relatório consolidado ao atendente que apenas lê o financeiro', async () => {
    requireUser.mockResolvedValue({ permissions: [PERMISSIONS.VIEW_FINANCIAL] });
    render(await RelatoriosPage({ searchParams: Promise.resolve({ periodo: '30d' }) }));
    expect(screen.queryByRole('link', { name: 'Ver repasses por mês' })).toBeNull();
    expect(getRelatorios).toHaveBeenCalledWith('clinic-1', 30, { includeFaturamento: true });
  });

  it('mantém o link para médico mesmo com leitura financeira concedida', async () => {
    requireUser.mockResolvedValue({ permissions: [PERMISSIONS.VIEW_FINANCIAL] });
    getCurrentPractitioner.mockResolvedValue(true);
    render(await RelatoriosPage({ searchParams: Promise.resolve({ periodo: '30d' }) }));
    expect(screen.getByRole('link', { name: 'Ver repasses por mês' })).toBeTruthy();
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
  it('Consultório mantém indicadores gerais e PDF sem oferecer relatório de repasses', async () => {
    hasAdvancedFinancialPolicies.mockResolvedValue(false);
    requireUser.mockResolvedValue({
      permissions: [PERMISSIONS.MANAGE_FINANCIAL, PERMISSIONS.VIEW_FINANCIAL],
    });
    getCurrentPractitioner.mockResolvedValue(true);
    render(await RelatoriosPage({ searchParams: Promise.resolve({ periodo: '30d' }) }));
    expect(screen.queryByRole('link', { name: 'Ver repasses por mês' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Exportar PDF' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Financeiro do período' })).toBeTruthy();
    expect(getCurrentPractitioner).not.toHaveBeenCalled();
  });
});
