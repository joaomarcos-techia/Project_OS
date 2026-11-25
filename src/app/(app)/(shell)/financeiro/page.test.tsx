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
  getOpenReceivablesByOrigin: vi.fn(),
  listPatientCards: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
// A página lê o usuário por `requirePageUser` (sessão morta vai para /login, OBS-001). Aqui ele
// delega ao `requireUser` simulado, para os cenários continuarem os mesmos; o redirecionamento
// tem teste próprio em `src/lib/auth/page-guard.test.ts`.
vi.mock('@/lib/auth/page-guard', () => ({
  requirePageUser: async () => (await import('@/lib/auth/tenant-context')).requireUser(),
}));
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
  getOpenReceivablesByOrigin: mocks.getOpenReceivablesByOrigin,
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
  mocks.getOpenReceivablesByOrigin.mockResolvedValue({
    paciente: { valor: 0, qtd: 0 },
    operadora: { valor: 0, qtd: 0 },
  });
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
  it('P10.6: separa paciente × operadora — filtro de origem, aberto por origem e selo na linha', async () => {
    mocks.requireUser.mockResolvedValue({
      clinicId: 'clinic-a',
      permissions: [PERMISSIONS.VIEW_FINANCIAL],
    });
    const base = {
      tipo: 'receber',
      status: 'pendente',
      valorPago: 0,
      valorGlosado: 0,
      patientId: null,
      supplierId: null,
      snapshotProcedureName: null,
      dueDate: null,
      createdAt: '2026-11-20T12:00:00.000Z',
    };
    mocks.listLancamentosPage.mockResolvedValue({
      items: [
        { ...base, id: 'l-op', descricao: 'Guia de convênio', valor: 150, valorGlosado: 30, sourceHiGuideId: 'g-1' },
        { ...base, id: 'l-pac', descricao: 'Particular', valor: 200, sourceHiGuideId: null },
      ],
      total: 2,
      pageSize: 50,
    });
    mocks.getCashFlowToday.mockResolvedValue({
      receber: 320,
      pagar: 0,
      recebidoHoje: 0,
      pagoHoje: 0,
      saldoHoje: 0,
      contagens: { receber: 2, receberVencidos: 0, pagar: 0, recebimentos: 0, pagamentos: 0 },
    });
    mocks.getOpenReceivablesByOrigin.mockResolvedValue({
      paciente: { valor: 200, qtd: 1 },
      operadora: { valor: 120, qtd: 1 },
    });

    const { container } = render(
      await FinanceiroPage({ searchParams: Promise.resolve({ tipo: 'receber', origem: 'operadora' }) }),
    );

    expect(mocks.listLancamentosPage).toHaveBeenCalledWith('clinic-a', {
      tipo: 'receber',
      origem: 'operadora',
      page: 1,
    });
    const split = container.querySelector('[data-receivable-split]');
    expect(split?.textContent?.replace(/\s+/gu, ' ')).toMatch(
      /Pacientes R\$\s200,00 · Operadoras R\$\s120,00/u,
    );
    expect(container.querySelectorAll('[data-origin="operadora"]')).toHaveLength(1);
    const origem = screen.getByRole('combobox', { name: 'Filtrar por origem' }) as HTMLSelectElement;
    expect(origem.value).toBe('operadora');
    // A troca de tipo preserva a origem filtrada.
    expect(screen.getByRole('link', { name: 'A pagar' }).getAttribute('href')).toBe('/financeiro?tipo=pagar&origem=operadora');
  });

  it('P10.6: origem desconhecida é ignorada e, sem recebível de operadora, a divisão não aparece', async () => {
    mocks.requireUser.mockResolvedValue({
      clinicId: 'clinic-a',
      permissions: [PERMISSIONS.VIEW_FINANCIAL],
    });

    const { container } = render(
      await FinanceiroPage({ searchParams: Promise.resolve({ origem: 'tudo' }) }),
    );

    expect(mocks.listLancamentosPage).toHaveBeenCalledWith('clinic-a', { page: 1 });
    expect(container.querySelector('[data-receivable-split]')).toBeNull();
  });
});
