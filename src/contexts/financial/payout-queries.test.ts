import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  hasAdvancedFinancialPolicies: vi.fn(),
  withTenant: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/contexts/billing/api', () => ({
  billingApiV1: { hasAdvancedFinancialPolicies: mocks.hasAdvancedFinancialPolicies },
}));
vi.mock('@/lib/db/tenant', () => ({ withTenant: mocks.withTenant }));

import { getProfessionalPayoutPolicy, listActiveProfessionalPayoutRules } from './payout-queries';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.hasAdvancedFinancialPolicies.mockResolvedValue(false);
});

describe('leitura da política de repasse no Solo', () => {
  it('devolve o default e não revela regras antigas após downgrade', async () => {
    await expect(getProfessionalPayoutPolicy('clinic-test')).resolves.toEqual({
      basis: 'gross',
      updatedAt: null,
    });
    await expect(listActiveProfessionalPayoutRules('clinic-test')).resolves.toEqual([]);
    expect(mocks.withTenant).not.toHaveBeenCalled();
  });
});
