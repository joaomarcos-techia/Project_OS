import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ManagementDatabase } from './abacatepay-management';
import type { RecurringPaymentEvidence } from '@/lib/payments/saas/recurring-payment';

const m = vi.hoisted(() => ({
  runtime: vi.fn(),
  subscription: vi.fn(),
  discover: vi.fn(),
  capture: vi.fn(),
  emit: vi.fn(),
}));
vi.mock('@/lib/env', () => ({
  env: {
    NODE_ENV: 'test',
    ABACATEPAY_API_KEY: 'synthetic-unit-key',
    ABACATEPAY_STORE_ID: 'store_synthetic',
  },
}));
vi.mock(import('@/lib/payments/saas/acquisition'), async (importOriginal) => ({
  ...(await importOriginal()),
  isAbacatePayRuntime: m.runtime,
}));
vi.mock('@/lib/observability/capture', () => ({ captureBackgroundError: m.capture }));
vi.mock('@/lib/observability/metrics', () => ({ metrics: { emit: m.emit } }));
vi.mock('@/lib/payments/abacatepay/reader', () => ({
  createAbacatePayReadClient: () => ({ readSubscription: m.subscription }),
}));
vi.mock('@/lib/payments/abacatepay/renewal-payment', () => ({
  createAbacatePayRenewalPaymentReader: () => ({ discoverRenewalPayment: m.discover }),
}));
vi.mock('./subscriptions', () => ({ recordBillingEvent: vi.fn() }));
vi.mock('./abacatepay-renewals', () => ({ applyAbacatePayRenewalTx: vi.fn() }));
vi.mock('./abacatepay-renewal-period', () => ({
  abacatePayRenewalPeriod: () => ({
    index: 1,
    start: new Date('2026-11-10T00:00:00Z'),
    end: new Date('2026-12-10T00:00:00Z'),
  }),
}));
import { reconcileAbacatePayMissingRenewal as recover } from './abacatepay-renewal-recovery';

const database = { execute: vi.fn(), transaction: vi.fn() } satisfies ManagementDatabase;
const evidence: RecurringPaymentEvidence = {
  account: { provider: 'abacatepay', environment: 'sandbox', accountId: 'store_synthetic' },
  subscriptionId: 'subs_synthetic',
  customerId: 'cust_synthetic',
  originCheckoutId: 'bill_synthetic',
  checkoutId: 'bill_synthetic',
  productId: 'prod_synthetic',
  paymentId: 'char_synthetic',
  statementId: 'tran_synthetic',
  amountMinor: 39700,
  paidAmountMinor: 39700,
  currency: 'BRL',
  chargeCreatedAt: '2026-11-10T00:00:00Z',
  confirmedAt: '2026-11-10T00:00:01Z',
  providerPeriodStart: '2026-11-10',
  providerPeriodEnd: '2026-12-10',
  method: 'card',
  recurrence: 'running',
  obligation: 'paid',
  settlement: 'unknown',
};
beforeEach(() => {
  vi.resetAllMocks();
  m.runtime.mockReturnValue(true);
  database.execute.mockResolvedValue([{ ready: true }]);
});
function expectSafeAlert() {
  expect(m.capture).toHaveBeenCalledOnce();
  const [error, context] = m.capture.mock.calls[0]!;
  expect(error).toBeInstanceOf(Error);
  expect(error.message).not.toContain('synthetic-sensitive');
  expect(context).toEqual({ flow: 'billing.abacatepay.renewal_recovery' });
}
describe('unhandled persistence failures in renewal recovery', () => {
  it('signals schema-read failure without retrying the database or calling the provider', async () => {
    const failure = new Error('synthetic-sensitive-schema-connection');
    database.execute.mockRejectedValue(failure);
    await expect(recover(database)).rejects.toBe(failure);
    expectSafeAlert();
    expect(database.execute).toHaveBeenCalledOnce();
    expect(database.transaction).not.toHaveBeenCalled();
    expect(m.subscription).not.toHaveBeenCalled();
  });
  it('signals candidate transaction failure even before any remote read', async () => {
    const failure = new Error('synthetic-sensitive-candidate-connection');
    database.transaction.mockRejectedValue(failure);
    await expect(recover(database)).rejects.toBe(failure);
    expectSafeAlert();
    expect(database.transaction).toHaveBeenCalledOnce();
    expect(m.subscription).not.toHaveBeenCalled();
  });
  it('still signals when both the financial transaction and failure audit are unavailable', async () => {
    const failure = new Error('synthetic-sensitive-audit-connection');
    database.transaction
      .mockResolvedValueOnce({
        account_id: '11111111-1111-4111-8111-111111111111',
        subscription_id: '22222222-2222-4222-8222-222222222222',
        clinic_id: '33333333-3333-4333-8333-333333333333',
        external_subscription_id: evidence.subscriptionId,
        external_customer_id: evidence.customerId,
        checkout_id: evidence.checkoutId,
        price_id: '44444444-4444-4444-8444-444444444444',
        product_id: evidence.productId,
        amount_minor: evidence.amountMinor,
        anchor_start: new Date('2026-10-10T00:00:00Z'),
        pending_price_id: null,
        pending_product_id: null,
        pending_amount: null,
      })
      .mockRejectedValueOnce(new Error('synthetic-sensitive-activation-connection'))
      .mockRejectedValueOnce(failure);
    m.subscription.mockResolvedValue({ currentPeriodStart: '2026-11-10', amount: 39700 });
    m.discover.mockResolvedValue({ state: 'paid', evidence });
    await expect(recover(database)).rejects.toBe(failure);
    expectSafeAlert();
    expect(database.transaction).toHaveBeenCalledTimes(3);
    expect(m.subscription).toHaveBeenCalledOnce();
    expect(m.discover).toHaveBeenCalledOnce();
  });
  it('keeps an absent migration inactive without treating it as an infrastructure error', async () => {
    database.execute.mockResolvedValue([{ ready: false }]);
    expect((await recover(database)).scanned).toBe(0);
    expect(m.capture).not.toHaveBeenCalled();
    expect(database.transaction).not.toHaveBeenCalled();
    expect(m.subscription).not.toHaveBeenCalled();
  });
  it('does not query or alert when the Sandbox runtime is disabled', async () => {
    m.runtime.mockReturnValue(false);
    expect((await recover(database)).scanned).toBe(0);
    expect(database.execute).not.toHaveBeenCalled();
    expect(m.capture).not.toHaveBeenCalled();
  });
});
