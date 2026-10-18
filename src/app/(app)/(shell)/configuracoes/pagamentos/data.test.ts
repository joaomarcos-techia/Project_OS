import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  hasAdvancedFinancialPolicies: vi.fn(),
  getPaymentAccountStatus: vi.fn(),
  getDepositPolicy: vi.fn(),
  getProfessionalPayoutPolicy: vi.fn(),
  listActiveProfessionalPayoutRules: vi.fn(),
  listEmployees: vi.fn(),
  listProcedures: vi.fn(),
  requireClinicId: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/contexts/billing/api', () => ({
  billingApiV1: { hasAdvancedFinancialPolicies: mocks.hasAdvancedFinancialPolicies },
}));
vi.mock('@/contexts/payments', () => ({
  getPaymentAccountStatus: mocks.getPaymentAccountStatus,
  getDepositPolicy: mocks.getDepositPolicy,
}));
vi.mock('@/contexts/financial/payout-queries', () => ({
  getProfessionalPayoutPolicy: mocks.getProfessionalPayoutPolicy,
  listActiveProfessionalPayoutRules: mocks.listActiveProfessionalPayoutRules,
}));
vi.mock('@/contexts/identity', () => ({ isPractitioner: vi.fn(() => true) }));
vi.mock('@/contexts/identity/queries', () => ({ listEmployees: mocks.listEmployees }));
vi.mock('@/contexts/scheduling', () => ({
  schedulingApiV1: { listProcedures: mocks.listProcedures },
}));
vi.mock('@/lib/auth/tenant-context', () => ({ requireClinicId: mocks.requireClinicId }));

import { loadPagamentosPage } from './data';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireClinicId.mockResolvedValue('clinic-test');
  mocks.getPaymentAccountStatus.mockResolvedValue({ hasApiKey: false });
  mocks.getDepositPolicy.mockResolvedValue({ mode: 'disabled' });
});

describe('configurações de pagamentos por plano', () => {
  it('Solo não lê políticas, preços, profissionais nem procedimentos avançados', async () => {
    mocks.hasAdvancedFinancialPolicies.mockResolvedValue(false);

    await expect(loadPagamentosPage()).resolves.toMatchObject({
      advancedPoliciesEnabled: false,
      payoutPolicy: { basis: 'gross' },
      payoutRules: [],
      professionals: [],
      procedures: [],
    });
    expect(mocks.getPaymentAccountStatus).toHaveBeenCalledWith('clinic-test');
    expect(mocks.getDepositPolicy).toHaveBeenCalledWith('clinic-test');
    expect(mocks.getProfessionalPayoutPolicy).not.toHaveBeenCalled();
    expect(mocks.listEmployees).not.toHaveBeenCalled();
  });

  it('Clínica/Pro carrega as políticas e regras do tenant', async () => {
    mocks.hasAdvancedFinancialPolicies.mockResolvedValue(true);
    mocks.getProfessionalPayoutPolicy.mockResolvedValue({ basis: 'net' });
    mocks.listActiveProfessionalPayoutRules.mockResolvedValue([{ id: 'rule-1' }]);
    mocks.listEmployees.mockResolvedValue([
      {
        id: 'professional-1',
        nome: 'Dra. Exemplo',
        ativo: true,
        pending: false,
        role: 'doctor',
        crm: '1',
      },
    ]);
    mocks.listProcedures.mockResolvedValue([{ id: 'procedure-1' }]);

    await expect(loadPagamentosPage()).resolves.toMatchObject({
      advancedPoliciesEnabled: true,
      payoutPolicy: { basis: 'net' },
      payoutRules: [{ id: 'rule-1' }],
      professionals: [{ id: 'professional-1', name: 'Dra. Exemplo' }],
    });
    expect(mocks.listProcedures).toHaveBeenCalledWith('clinic-test', { limit: 200 });
  });
});
