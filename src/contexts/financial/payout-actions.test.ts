import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ActionHelpers from './internal/action-helpers';

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  requireCachedPermission: vi.fn(),
  requireClinicId: vi.fn(),
  hasAdvancedFinancialPolicies: vi.fn(),
  idempotentMutation: vi.fn(),
  recordReview: vi.fn(),
  requestContext: vi.fn(),
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
vi.mock('./internal/payout-review', () => ({
  recordProfessionalPayoutReview: mocks.recordReview,
}));
vi.mock('./internal/action-helpers', async (importOriginal) => ({
  ...(await importOriginal<typeof ActionHelpers>()),
  requestContext: mocks.requestContext,
}));

import { PERMISSIONS } from '@/lib/auth/permissions';

import {
  removeProfessionalPayoutRule,
  reviewProfessionalPayout,
  saveProfessionalPayoutPolicy,
  saveProfessionalPayoutRule,
} from './payout-actions';

const CLINIC_ID = '11111111-1111-4111-8111-111111111111';
const PROFESSIONAL_ID = '22222222-2222-4222-8222-222222222222';
const PAYOUT_ID = '33333333-3333-4333-8333-333333333333';
const REVIEW = { payoutId: PAYOUT_ID, amount: 60, reason: 'Devolução parcial acordada.' };
const IDEM = '44444444-4444-4444-8444-444444444444';

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
    ['revisão', () => reviewProfessionalPayout(REVIEW, 'idem-4')],
  ])('bloqueia %s antes de qualquer mutação', async (_label, action) => {
    await expect(action()).rejects.toThrow('plano Clínica');
    expect(mocks.hasAdvancedFinancialPolicies).toHaveBeenCalledWith(CLINIC_ID);
    expect(mocks.idempotentMutation).not.toHaveBeenCalled();
  });
});

describe('revisão humana do repasse suspenso', () => {
  it('sem MANAGE_FINANCIAL não consulta plano nem grava', async () => {
    mocks.requireCachedPermission.mockRejectedValue(
      Object.assign(new Error('forbidden'), { name: 'AuthError', code: 'forbidden' }),
    );
    await expect(reviewProfessionalPayout(REVIEW, 'idem-5')).rejects.toThrow('forbidden');
    expect(mocks.requireCachedPermission).toHaveBeenCalledWith(PERMISSIONS.MANAGE_FINANCIAL);
    expect(mocks.hasAdvancedFinancialPolicies).not.toHaveBeenCalled();
    expect(mocks.idempotentMutation).not.toHaveBeenCalled();
  });

  it.each([
    ['mais de duas casas decimais', { ...REVIEW, amount: 60.001 }],
    ['valor negativo', { ...REVIEW, amount: -1 }],
    ['motivo curto', { ...REVIEW, reason: ' ok ' }],
    ['motivo longo', { ...REVIEW, reason: 'x'.repeat(501) }],
    ['clinicId do navegador', { ...REVIEW, clinicId: PROFESSIONAL_ID }],
  ])('recusa %s antes da mutação', async (_label, input) => {
    mocks.hasAdvancedFinancialPolicies.mockResolvedValue(true);
    await expect(reviewProfessionalPayout(input as typeof REVIEW, IDEM)).rejects.toMatchObject({
      name: 'ZodError',
    });
    expect(mocks.idempotentMutation).not.toHaveBeenCalled();
    expect(mocks.recordReview).not.toHaveBeenCalled();
  });

  it('usa clínica da sessão e autor autenticado; o motivo não volta no resultado auditado', async () => {
    mocks.hasAdvancedFinancialPolicies.mockResolvedValue(true);
    mocks.requestContext.mockResolvedValue({ ip: null, userAgent: null, requestId: 'req-1' });
    const tx = {};
    mocks.idempotentMutation.mockImplementation(
      async (_opts: unknown, fn: (value: unknown) => Promise<unknown>) => fn(tx),
    );
    mocks.recordReview.mockResolvedValue({
      payoutId: PAYOUT_ID,
      version: 1,
      decidedAmount: 60,
      ceilingAmount: 75,
      referenceAmount: 50,
      decidedAt: '2026-10-07T15:00:00.000Z',
    });

    const result = await reviewProfessionalPayout(REVIEW, IDEM);

    expect(mocks.recordReview).toHaveBeenCalledWith(tx, {
      clinicId: CLINIC_ID,
      payoutId: PAYOUT_ID,
      amount: 60,
      reason: 'Devolução parcial acordada.',
      decidedBy: 'user-1',
    });
    expect(mocks.idempotentMutation.mock.calls[0]?.[0]).toMatchObject({
      audit: {
        action: 'financial.professional_payout.reviewed',
        resourceType: 'professional_payout',
        resourceId: PAYOUT_ID,
      },
    });
    expect(result).toEqual(expect.not.objectContaining({ reason: expect.anything() }));
    expect(result).toMatchObject({ version: 1, decidedAmount: 60, ceilingAmount: 75 });
  });
});
