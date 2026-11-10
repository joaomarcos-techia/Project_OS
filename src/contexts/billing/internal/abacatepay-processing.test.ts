import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  transaction: vi.fn(),
  runtime: vi.fn(),
  emit: vi.fn(),
  record: vi.fn(),
  env: { ABACATEPAY_STORE_ID: 'store_fixture', ABACATEPAY_API_KEY: 'synthetic-worker-unit-only' },
}));
vi.mock('@/lib/db', () => ({
  dbAdmin: { execute: mocks.execute, transaction: mocks.transaction },
}));
vi.mock('@/lib/env', () => ({ env: mocks.env }));
vi.mock('@/lib/payments/saas/acquisition', () => ({ isAbacatePaySandboxRuntime: mocks.runtime }));
vi.mock('@/lib/observability/metrics', () => ({ metrics: { emit: mocks.emit } }));
vi.mock('./subscriptions', () => ({ markInvoicePaid: vi.fn(), recordBillingEvent: mocks.record }));
import {
  reconcileAbacatePayInbox,
  reconcileMissingAbacatePayInitialPayment,
} from './abacatepay-processing';

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockRejectedValue(new Error('External network forbidden in unit test')),
  );
  vi.clearAllMocks();
  mocks.execute.mockReset();
  mocks.transaction.mockReset();
  mocks.transaction.mockImplementation((callback: (tx: object) => Promise<void>) => callback({}));
  mocks.runtime.mockReturnValue(true);
  mocks.env.ABACATEPAY_API_KEY = 'synthetic-worker-unit-only';
  mocks.execute.mockResolvedValue([]);
});

describe('missing initial webhook recovery (unit DB double)', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  it('does not access the database or provider outside the Sandbox runtime', async () => {
    mocks.runtime.mockReturnValue(false);
    expect(await reconcileMissingAbacatePayInitialPayment()).toEqual({
      scanned: 0,
      applied: 0,
      duplicate: 0,
      review: 0,
    });
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('has no side effects without a key', async () => {
    mocks.env.ABACATEPAY_API_KEY = '';
    await reconcileMissingAbacatePayInitialPayment();
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects an invalid scoped identifier before querying', async () => {
    await expect(
      reconcileMissingAbacatePayInitialPayment({ subscriptionId: 'invalid' }),
    ).rejects.toThrow();
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it('does not contact the provider or write when no eligible checkout remains', async () => {
    expect(await reconcileMissingAbacatePayInitialPayment({ subscriptionId: id })).toEqual({
      scanned: 0,
      applied: 0,
      duplicate: 0,
      review: 0,
    });
    expect(mocks.execute).toHaveBeenCalledOnce();
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('records a safe failure without granting access when provider readback fails', async () => {
    mocks.execute.mockResolvedValueOnce([
      {
        subscription_id: id,
        clinic_id: id,
        checkout_id: 'bill_fixture',
        product_id: 'prod_fixture',
        amount_minor: '39700',
      },
    ]);
    expect(await reconcileMissingAbacatePayInitialPayment({ subscriptionId: id })).toEqual({
      scanned: 1,
      applied: 0,
      duplicate: 0,
      review: 1,
    });
    expect(mocks.record).toHaveBeenCalledWith({}, id, 'subscription.initial_payment.checked', {
      subscriptionId: id,
      provider: 'abacatepay',
      outcome: 'readback_or_transaction_failed',
    });
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.emit).toHaveBeenCalledWith('billing.abacatepay.reconcile_failed', {
      reason: 'missing_initial_webhook',
    });
  });
  it('propagates an audit persistence failure instead of claiming recovery', async () => {
    mocks.execute.mockResolvedValueOnce([
      {
        subscription_id: id,
        clinic_id: id,
        checkout_id: 'bill_fixture',
        product_id: 'prod_fixture',
        amount_minor: '39700',
      },
    ]);
    mocks.record.mockRejectedValueOnce(new Error('Synthetic audit unavailable'));
    await expect(reconcileMissingAbacatePayInitialPayment({ subscriptionId: id })).rejects.toThrow(
      'Synthetic audit unavailable',
    );
  });
});
afterEach(() => vi.unstubAllGlobals());
describe('leased AbacatePay worker recovery (unit DB double)', () => {
  it.each(['received', 'processing'])(
    'requests redelivery while %s has not committed',
    async (state) => {
      mocks.execute.mockResolvedValueOnce([]).mockResolvedValueOnce([{ state }]);
      expect(await reconcileAbacatePayInbox({ eventId: 'log_fixture' })).toMatchObject({
        retry: true,
        applied: 0,
      });
      expect(mocks.transaction).not.toHaveBeenCalled();
    },
  );
  it.each(['applied', 'ignored', 'review'])(
    'does not reopen a terminal %s event',
    async (state) => {
      mocks.execute.mockResolvedValueOnce([]).mockResolvedValueOnce([{ state }]);
      const result = await reconcileAbacatePayInbox({ eventId: 'log_fixture' });
      expect(result.applied).toBe(0);
      expect(result.retry).not.toBe(true);
      expect(mocks.transaction).not.toHaveBeenCalled();
    },
  );
  it('does not scan another event after a scoped duplicate', async () => {
    expect(await reconcileAbacatePayInbox({ eventId: 'log_fixture' })).toEqual({
      applied: 0,
      review: 0,
      scanned: 0,
    });
    expect(mocks.execute).toHaveBeenCalledTimes(2);
  });
  it('cron with no work does not open a financial transaction', async () => {
    expect(await reconcileAbacatePayInbox()).toEqual({ applied: 0, review: 0, scanned: 0 });
    expect(mocks.execute).toHaveBeenCalledOnce();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it('does not interfere with the Asaas cron on an inadmissible production runtime', async () => {
    mocks.runtime.mockReturnValue(false);
    expect(await reconcileAbacatePayInbox()).toEqual({ applied: 0, review: 0, scanned: 0 });
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it('missing key performs no work or side effects', async () => {
    mocks.env.ABACATEPAY_API_KEY = '';
    await reconcileAbacatePayInbox();
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it.each([10, 11])(
    'closes a crashed final lease with limit %i without another financial attempt',
    async (limit) => {
      mocks.execute.mockResolvedValueOnce([
        {
          account_id: '11111111-1111-4111-8111-111111111111',
          event_id: 'log_last',
          event_type: 'subscription.completed',
          lease_token: '22222222-2222-4222-8222-222222222222',
          external_subscription_id: 'subs_fixture',
          external_checkout_id: 'bill_fixture',
          external_customer_id: 'cust_fixture',
          attempts: limit + 1,
          attempt_limit: limit,
        },
      ]);
      expect(await reconcileAbacatePayInbox({ eventId: 'log_last' })).toEqual({
        applied: 0,
        review: 1,
        scanned: 1,
      });
      expect(mocks.execute).toHaveBeenCalledTimes(2);
      expect(mocks.transaction).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    },
  );
});
