import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  requireCachedPermission: vi.fn(),
  requireClinicId: vi.fn(),
  idempotentMutation: vi.fn(),
  getPaymentPricingPolicy: vi.fn(),
  hasAdvancedFinancialPolicies: vi.fn(),
}));

vi.mock('@/contexts/billing/api', () => ({
  billingApiV1: { hasAdvancedFinancialPolicies: mocks.hasAdvancedFinancialPolicies },
}));

vi.mock('@/lib/auth/tenant-context', () => ({
  requireUser: mocks.requireUser,
  requireCachedPermission: mocks.requireCachedPermission,
  requireClinicId: mocks.requireClinicId,
}));
vi.mock('@/lib/audit/request-context-from-headers', () => ({
  requestContext: vi.fn(async () => ({
    ip: null,
    userAgent: null,
    requestId: 'request-1',
    correlationId: 'request-1',
  })),
}));
vi.mock('@/lib/idempotency/mutation', () => ({ idempotentMutation: mocks.idempotentMutation }));
vi.mock('@/lib/observability/metrics', () => ({ metrics: { emit: vi.fn() } }));
vi.mock('./pricing-queries', () => ({
  getPaymentPricingPolicy: mocks.getPaymentPricingPolicy,
}));

import {
  removeProcedurePaymentPrice,
  savePaymentPricingPolicy,
  saveProcedurePaymentPrice,
} from './pricing-actions';

const CLINIC_ID = '11111111-1111-4111-8111-111111111111';
const PROCEDURE_ID = '22222222-2222-4222-8222-222222222222';
const OLD_PRICE_ID = '33333333-3333-4333-8333-333333333333';
const NEW_PRICE_ID = '44444444-4444-4444-8444-444444444444';
const IDEM_ID = '55555555-5555-4555-8555-555555555555';

function fakeTx(options: { procedureExists: boolean; oldPriceExists: boolean }) {
  const execute = vi
    .fn()
    .mockResolvedValueOnce(options.procedureExists ? [{ ok: 1 }] : [])
    .mockResolvedValueOnce(options.oldPriceExists ? [{ id: OLD_PRICE_ID }] : []);
  const updateWhere = vi.fn().mockResolvedValue(undefined);
  const updateSet = vi.fn(() => ({ where: updateWhere }));
  const update = vi.fn(() => ({ set: updateSet }));
  const returning = vi.fn().mockResolvedValue([
    {
      id: NEW_PRICE_ID,
      clinicId: CLINIC_ID,
      procedureId: PROCEDURE_ID,
      paymentMethod: 'pix',
      installmentCount: null,
      grossAmount: '240.00',
      active: true,
      effectiveFrom: new Date('2026-10-02T10:00:00Z'),
      effectiveTo: null,
      updatedBy: 'user-1',
      createdAt: new Date('2026-10-02T10:00:00Z'),
      updatedAt: new Date('2026-10-02T10:00:00Z'),
    },
  ]);
  const values = vi.fn(() => ({ returning }));
  const insert = vi.fn(() => ({ values }));
  return {
    tx: { execute, update, insert },
    execute,
    update,
    updateSet,
    updateWhere,
    insert,
    values,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue({ userId: 'user-1' });
  mocks.requireCachedPermission.mockResolvedValue(undefined);
  mocks.requireClinicId.mockResolvedValue(CLINIC_ID);
  mocks.hasAdvancedFinancialPolicies.mockResolvedValue(true);
});

describe('saveProcedurePaymentPrice', () => {
  it.each([
    ['fractional cent', 'pix' as const, null, 240.005],
    ['below one cent', 'pix' as const, null, 0.001],
    ['unsupported installments', 'credit_card' as const, 3, 260],
  ])(
    'rejects %s before creating an idempotent mutation',
    async (_case, paymentMethod, installmentCount, grossAmount) => {
      await expect(
        saveProcedurePaymentPrice(
          { procedureId: PROCEDURE_ID, paymentMethod, installmentCount, grossAmount },
          IDEM_ID,
        ),
      ).rejects.toThrow();
      expect(mocks.idempotentMutation).not.toHaveBeenCalled();
    },
  );

  it('recusa o plano Solo antes de ler ou escrever preços', async () => {
    mocks.hasAdvancedFinancialPolicies.mockResolvedValue(false);
    await expect(
      saveProcedurePaymentPrice(
        {
          procedureId: PROCEDURE_ID,
          paymentMethod: 'pix',
          installmentCount: null,
          grossAmount: 240,
        },
        IDEM_ID,
      ),
    ).rejects.toThrow('plano Clínica');
    expect(mocks.hasAdvancedFinancialPolicies).toHaveBeenCalledWith(CLINIC_ID);
    expect(mocks.idempotentMutation).not.toHaveBeenCalled();
  });
  it('autentica e autoriza antes de revelar erros do schema', async () => {
    const authError = Object.assign(new Error('unauthenticated'), { name: 'AuthError' });
    mocks.requireUser.mockRejectedValue(authError);

    await expect(
      saveProcedurePaymentPrice({ invalid: true } as never, 'idem-invalid'),
    ).rejects.toBe(authError);
    expect(mocks.requireCachedPermission).not.toHaveBeenCalled();
    expect(mocks.idempotentMutation).not.toHaveBeenCalled();
  });

  it('fecha a versão anterior e insere uma nova sem sobrescrever o histórico', async () => {
    const current = fakeTx({ procedureExists: true, oldPriceExists: true });
    mocks.idempotentMutation.mockImplementation(async (_options, operation) =>
      operation(current.tx),
    );

    await expect(
      saveProcedurePaymentPrice(
        {
          procedureId: PROCEDURE_ID,
          paymentMethod: 'pix',
          installmentCount: null,
          grossAmount: 240,
        },
        IDEM_ID,
      ),
    ).resolves.toMatchObject({ id: NEW_PRICE_ID, grossAmount: 240 });

    expect(current.update).toHaveBeenCalledTimes(1);
    expect(current.insert).toHaveBeenCalledTimes(1);
    expect(current.values).toHaveBeenCalledWith(
      expect.objectContaining({
        clinicId: CLINIC_ID,
        procedureId: PROCEDURE_ID,
        paymentMethod: 'pix',
        grossAmount: '240.00',
        active: true,
      }),
    );
  });

  it('recusa procedimento de outro tenant antes de encerrar ou criar preço', async () => {
    const current = fakeTx({ procedureExists: false, oldPriceExists: false });
    mocks.idempotentMutation.mockImplementation(async (_options, operation) =>
      operation(current.tx),
    );

    await expect(
      saveProcedurePaymentPrice(
        {
          procedureId: PROCEDURE_ID,
          paymentMethod: 'pix',
          installmentCount: null,
          grossAmount: 240,
        },
        IDEM_ID,
      ),
    ).rejects.toThrow('procedimento inválido para esta clínica');
    expect(current.update).not.toHaveBeenCalled();
    expect(current.insert).not.toHaveBeenCalled();
  });
});

describe('savePaymentPricingPolicy', () => {
  it('does not enable a policy when only unsupported card installments are configured', async () => {
    const execute = vi.fn().mockResolvedValue([{ count: 0 }]);
    mocks.idempotentMutation.mockImplementation(async (_options, operation) =>
      operation({ execute }),
    );

    await expect(
      savePaymentPricingPolicy({ mode: 'payment_method_pricing' }, IDEM_ID),
    ).rejects.toThrow('Cadastre ao menos um preço');
    expect(execute).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(execute.mock.calls[0]?.[0])).toMatch(/installment_count = 1/);
  });
});

describe('outras escritas de preço no Solo', () => {
  it.each([
    ['política', () => savePaymentPricingPolicy({ mode: 'payment_method_pricing' }, IDEM_ID)],
    ['remoção', () => removeProcedurePaymentPrice({ priceId: OLD_PRICE_ID }, IDEM_ID)],
  ])('bloqueia %s antes de qualquer mutação', async (_label, action) => {
    mocks.hasAdvancedFinancialPolicies.mockResolvedValue(false);
    await expect(action()).rejects.toThrow('plano Clínica');
    expect(mocks.idempotentMutation).not.toHaveBeenCalled();
  });
});
