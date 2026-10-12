// @vitest-environment happy-dom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  requireClinicId: vi.fn(),
  getClinicTimezone: vi.fn(),
  listLancamentosPage: vi.fn(),
  listSuppliers: vi.fn(),
  listPaymentMethods: vi.fn(),
  getCashFlowToday: vi.fn(),
  getAvailablePatientCreditSummary: vi.fn(),
  listPatientCards: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('@/lib/auth/tenant-context', () => ({
  requireUser: mocks.requireUser,
  requireClinicId: mocks.requireClinicId,
}));
vi.mock('@/contexts/tenancy/queries', () => ({ getClinicTimezone: mocks.getClinicTimezone }));
vi.mock('@/contexts/financial/queries', () => ({
  listLancamentosPage: mocks.listLancamentosPage,
  listSuppliers: mocks.listSuppliers,
  listPaymentMethods: mocks.listPaymentMethods,
  getCashFlowToday: mocks.getCashFlowToday,
  getAvailablePatientCreditSummary: mocks.getAvailablePatientCreditSummary,
}));
vi.mock('@/contexts/patient/queries', () => ({ listPatientCards: mocks.listPatientCards }));
vi.mock('./new-lancamento-drawer', () => ({ NewLancamentoDrawer: () => null }));

import { PERMISSIONS } from '@/lib/auth/permissions';
import FinanceiroPage from './page';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireClinicId.mockResolvedValue('clinic-a');
  mocks.getClinicTimezone.mockResolvedValue('America/Sao_Paulo');
  mocks.listLancamentosPage.mockResolvedValue({ items: [], total: 0, pageSize: 50 });
  mocks.listSuppliers.mockResolvedValue([]);
  mocks.listPaymentMethods.mockResolvedValue([]);
  mocks.listPatientCards.mockResolvedValue([]);
  mocks.getCashFlowToday.mockResolvedValue({
    receber: 0,
    pagar: 0,
    recebidoHoje: 0,
    pagoHoje: 0,
    saldoHoje: 0,
    contagens: {
      receber: 0,
      receberVencidos: 0,
      pagar: 0,
      recebimentos: 0,
      pagamentos: 0,
    },
  });
  mocks.getAvailablePatientCreditSummary.mockResolvedValue({ amount: 10, count: 1 });
});

afterEach(cleanup);

describe('FinanceiroPage', () => {
  it('exibe pagamento antecipado separado de recebível e de recebido no mês', async () => {
    mocks.requireUser.mockResolvedValue({
      clinicId: 'clinic-a',
      permissions: [PERMISSIONS.VIEW_FINANCIAL],
    });

    render(await FinanceiroPage({ searchParams: Promise.resolve({}) }));

    const credits = screen.getByRole('region', { name: 'Créditos antecipados e excedentes' });
    expect(within(credits).getByText(/R\$\s*10,00/u)).toBeTruthy();
    expect(within(credits).getByText('1 crédito com saldo não aplicado')).toBeTruthy();
    expect(within(credits).getByText(/Este saldo não entra em “A receber”/u)).toBeTruthy();
    expect(mocks.getAvailablePatientCreditSummary).toHaveBeenCalledWith('clinic-a');
    expect(screen.getAllByText(/R\$\s*0,00/u).length).toBeGreaterThan(0);
  });

  it('não consulta créditos se o usuário não pode ver o financeiro', async () => {
    mocks.requireUser.mockResolvedValue({ clinicId: 'clinic-a', permissions: [] });

    render(await FinanceiroPage({ searchParams: Promise.resolve({}) }));

    expect(screen.queryByRole('region', { name: 'Créditos antecipados e excedentes' })).toBeNull();
    expect(mocks.getAvailablePatientCreditSummary).not.toHaveBeenCalled();
  });
});
