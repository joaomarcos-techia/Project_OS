import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  requireCachedPermission: vi.fn(),
  requireClinicId: vi.fn(),
  hasAdvancedFinancialPolicies: vi.fn(),
  idempotentMutation: vi.fn(),
}));

vi.mock('@/contexts/billing/api', () => ({
  billingApiV1: { hasAdvancedFinancialPolicies: mocks.hasAdvancedFinancialPolicies },
}));
vi.mock('@/lib/auth/tenant-context', () => ({
  requireUser: mocks.requireUser,
  requireCachedPermission: mocks.requireCachedPermission,
  requireClinicId: mocks.requireClinicId,
}));
vi.mock('@/lib/idempotency/mutation', () => ({ idempotentMutation: mocks.idempotentMutation }));

import {
  removeProfessionalPayoutRule,
  saveProfessionalPayoutPolicy,
  saveProfessionalPayoutRule,
} from './payout-actions';

const CLINIC_ID = '11111111-1111-4111-8111-111111111111';
const PROFESSIONAL_ID = '22222222-2222-4222-8222-222222222222';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue({ userId: 'user-1' });
  mocks.requireCachedPermission.mockResolvedValue(undefined);
  mocks.requireClinicId.mockResolvedValue(CLINIC_ID);
  mocks.hasAdvancedFinancialPolicies.mockResolvedValue(false);
});

describe('repasse indisponível no plano Solo', () => {
  it.each([
    ['política', () => saveProfessionalPayoutPolicy({ basis: 'net' }, 'idem-1')],
    [
      'regra',
      () =>
        saveProfessionalPayoutRule(
          {
            professionalId: PROFESSIONAL_ID,
            procedureId: null,
            kind: 'percentage',
            percentage: 50,
            fixedAmount: null,
          },
          'idem-2',
        ),
    ],
    ['remoção', () => removeProfessionalPayoutRule({ ruleId: PROFESSIONAL_ID }, 'idem-3')],
  ])('bloqueia %s antes de qualquer mutação', async (_label, action) => {
    await expect(action()).rejects.toThrow('planos Clínica e Pro');
    expect(mocks.hasAdvancedFinancialPolicies).toHaveBeenCalledWith(CLINIC_ID);
    expect(mocks.idempotentMutation).not.toHaveBeenCalled();
  });
});
