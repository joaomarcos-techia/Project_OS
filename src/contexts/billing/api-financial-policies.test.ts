import { beforeEach, describe, expect, it, vi } from 'vitest';

const { withTenantMock } = vi.hoisted(() => ({ withTenantMock: vi.fn() }));

vi.mock('@/lib/db/tenant', () => ({ withTenant: withTenantMock }));

import { billingApiV1, planHasAdvancedFinancialPolicies } from './api';

function planRead(code: string | null) {
  const query = {
    from: vi.fn(),
    innerJoin: vi.fn(),
    where: vi.fn(),
    limit: vi.fn().mockResolvedValue(code === null ? [] : [{ code }]),
  };
  query.from.mockReturnValue(query);
  query.innerJoin.mockReturnValue(query);
  query.where.mockReturnValue(query);
  withTenantMock.mockImplementation(
    async (_clinicId: string, operation: (tx: unknown) => unknown) =>
      operation({ select: () => query }),
  );
}

beforeEach(() => vi.clearAllMocks());

describe('políticas financeiras avançadas por plano', () => {
  it.each([
    ['solo', false],
    ['clinica', true],
    ['pro', true],
    // Oferta por profissional (ADR-067): Clínica mantém, Consultório não.
    ['consultorio_2026', false],
    ['clinica_2026_2', true],
    ['clinica_2026_10', true],
    [null, false],
    ['desconhecido', false],
  ])('plano %s → %s', async (code, expected) => {
    planRead(code);
    expect(planHasAdvancedFinancialPolicies(code)).toBe(expected);
    await expect(billingApiV1.hasAdvancedFinancialPolicies('clinic-test')).resolves.toBe(expected);
    expect(withTenantMock).toHaveBeenCalledWith('clinic-test', expect.any(Function));
  });
});
