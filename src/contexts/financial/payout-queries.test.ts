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

import {
  getProfessionalPayoutPolicy,
  listActiveProfessionalPayoutRules,
  listMonthlyPayoutSnapshots,
  getProfessionalPayoutByAppointment,
} from './payout-queries';

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
  it('não revela snapshots individuais nem relatório mensal sem entitlement', async () => {
    await expect(listMonthlyPayoutSnapshots('clinic-test', ['appointment-1'])).resolves.toEqual([]);
    await expect(
      getProfessionalPayoutByAppointment('clinic-test', 'appointment-1'),
    ).resolves.toBeNull();
    expect(mocks.withTenant).not.toHaveBeenCalled();
  });
});
