import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createCheckout: vi.fn(),
  cancelCheckout: vi.fn(),
  findPaymentByExternalReference: vi.fn(),
  generateInvoice: vi.fn(),
  claimUpgradeCheckout: vi.fn(),
  finishUpgradeCheckoutCreation: vi.fn(),
  getUpgradePaymentContext: vi.fn(),
  linkUpgradePayment: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db/tenant', () => ({ withTenant: vi.fn((_id, callback) => callback({})) }));
vi.mock('@/lib/env', () => ({ env: { VERCEL_ENV: 'preview', NODE_ENV: 'production' } }));
vi.mock('@/lib/http/application-url', () => ({
  resolvePreviewCallbackOrigin: () => 'https://preview.example',
  buildApplicationUrl: () => 'https://preview.example/',
}));
vi.mock('@/lib/observability/metrics', () => ({ metrics: { emit: vi.fn() } }));
vi.mock('@/lib/payments/asaas', () => ({
  BillingProviderError: class BillingProviderError extends Error {
    constructor(
      message: string,
      readonly code: string,
      readonly httpStatus: number | null,
    ) {
      super(message);
    }
  },
  asaasProvider: {
    createCheckout: mocks.createCheckout,
    cancelCheckout: mocks.cancelCheckout,
    findPaymentByExternalReference: mocks.findPaymentByExternalReference,
    generateInvoice: mocks.generateInvoice,
  },
}));
vi.mock('../proposed-offer', () => ({
  isOffer2026PlanCode: (code: string) => code.startsWith('clinica_2026_'),
}));
vi.mock('./plan-changes', () => ({
  PlanChangeError: class PlanChangeError extends Error {
    constructor(
      message: string,
      readonly code: string,
    ) {
      super(message);
    }
  },
  claimUpgradeCheckout: mocks.claimUpgradeCheckout,
  finishUpgradeCheckoutCreation: mocks.finishUpgradeCheckoutCreation,
  getUpgradePaymentContext: mocks.getUpgradePaymentContext,
  linkUpgradePayment: mocks.linkUpgradePayment,
  planChangeExternalReference: (id: string) => `plan-change:${id}`,
}));

import { BillingProviderError } from '@/lib/payments/asaas';
import { ensureUpgradePayment } from './plan-change-payment';

const CHANGE_ID = '00000000-0000-0000-0000-000000000001';
const CLINIC_ID = '00000000-0000-0000-0000-000000000002';

type CheckoutState = {
  checkoutCreationState: string | null;
  providerCheckoutId: string | null;
  providerCheckoutExpiresAt: Date | null;
  providerPaymentUrl: string | null;
};

let state: CheckoutState;

beforeEach(() => {
  vi.clearAllMocks();
  state = {
    checkoutCreationState: null,
    providerCheckoutId: null,
    providerCheckoutExpiresAt: null,
    providerPaymentUrl: null,
  };
  mocks.getUpgradePaymentContext.mockImplementation(() => ({
    changeId: CHANGE_ID,
    clinicId: CLINIC_ID,
    customerId: 'cus_test',
    amountCents: 7350,
    targetPlanName: 'Clínica com 3 médicos',
    targetPlanCode: 'clinica_2026_3',
    dueDate: '2026-10-26',
    providerPaymentId: null,
    ...state,
  }));
  mocks.claimUpgradeCheckout.mockImplementation(() => {
    if (state.checkoutCreationState) return false;
    state.checkoutCreationState = 'creating';
    return true;
  });
  mocks.finishUpgradeCheckoutCreation.mockImplementation((_tx, _clinic, _change, outcome) => {
    state.checkoutCreationState = outcome.state === 'failed' ? null : outcome.state;
    if (outcome.state === 'ready') {
      state.providerCheckoutId = outcome.checkoutId;
      state.providerPaymentUrl = outcome.checkoutUrl;
      state.providerCheckoutExpiresAt = outcome.expiresAt;
    }
  });
  mocks.createCheckout.mockResolvedValue({
    checkoutId: 'checkout_test',
    link: 'https://sandbox.asaas.com/checkoutSession/show?id=checkout_test',
    status: 'ACTIVE',
  });
});

describe('Checkout do médico adicional', () => {
  it('guarda a sessão antes de devolver o link e nunca cria outra no replay', async () => {
    const first = await ensureUpgradePayment(CLINIC_ID, CHANGE_ID);
    const second = await ensureUpgradePayment(CLINIC_ID, CHANGE_ID);

    expect(first.paymentUrl).toBe(second.paymentUrl);
    expect(mocks.createCheckout).toHaveBeenCalledOnce();
    expect(mocks.createCheckout).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'detached',
        value: 73.5,
        externalReference: `plan-change:${CHANGE_ID}`,
        callback: expect.objectContaining({
          successUrl: 'https://preview.example/?payment=success',
        }),
      }),
    );
    expect(mocks.createCheckout.mock.calls[0]?.[0]).not.toHaveProperty('customerId');
    expect(mocks.finishUpgradeCheckoutCreation).toHaveBeenCalledWith(
      expect.anything(),
      CLINIC_ID,
      CHANGE_ID,
      expect.objectContaining({ state: 'ready', checkoutId: 'checkout_test' }),
    );
    expect(mocks.generateInvoice).not.toHaveBeenCalled();
  });

  it('bloqueia segunda criação após timeout de resultado incerto', async () => {
    mocks.createCheckout.mockRejectedValueOnce(new Error('timeout'));
    await expect(ensureUpgradePayment(CLINIC_ID, CHANGE_ID)).rejects.toThrow('timeout');
    await expect(ensureUpgradePayment(CLINIC_ID, CHANGE_ID)).rejects.toMatchObject({
      code: 'upgrade_checkout_pending',
    });
    expect(state.checkoutCreationState).toBe('creation_unknown');
    expect(mocks.createCheckout).toHaveBeenCalledOnce();
  });

  it('permite retry apenas após recusa 4xx conclusiva', async () => {
    mocks.createCheckout.mockRejectedValueOnce(
      new BillingProviderError('payload recusado', 'invalid_action', 400),
    );
    await expect(ensureUpgradePayment(CLINIC_ID, CHANGE_ID)).rejects.toMatchObject({
      httpStatus: 400,
    });
    expect(state.checkoutCreationState).toBeNull();
    await expect(ensureUpgradePayment(CLINIC_ID, CHANGE_ID)).resolves.toMatchObject({
      paymentId: 'checkout_test',
    });
    expect(mocks.createCheckout).toHaveBeenCalledTimes(2);
  });

  it('nunca devolve link expirado', async () => {
    state.checkoutCreationState = 'ready';
    state.providerCheckoutId = 'checkout_old';
    state.providerPaymentUrl = 'https://sandbox.asaas.com/checkoutSession/show?id=checkout_old';
    state.providerCheckoutExpiresAt = new Date('2026-01-01T00:00:00Z');
    await expect(ensureUpgradePayment(CLINIC_ID, CHANGE_ID)).rejects.toMatchObject({
      code: 'upgrade_checkout_expired',
    });
    expect(mocks.createCheckout).not.toHaveBeenCalled();
  });
});
