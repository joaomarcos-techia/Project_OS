import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  transaction: vi.fn(),
  runtime: vi.fn(),
  emit: vi.fn(),
  record: vi.fn(),
  capture: vi.fn(),
  env: {
    NODE_ENV: 'test',
    ABACATEPAY_STORE_ID: 'store_fixture',
    ABACATEPAY_API_KEY: 'synthetic-worker-unit-only',
  },
}));
vi.mock('@/lib/db', () => ({
  dbAdmin: { execute: mocks.execute, transaction: mocks.transaction },
}));
vi.mock('@/lib/env', () => ({ env: mocks.env }));
vi.mock('@/lib/payments/saas/acquisition', () => ({ isAbacatePaySandboxRuntime: mocks.runtime }));
vi.mock('@/lib/observability/metrics', () => ({ metrics: { emit: mocks.emit } }));
vi.mock('@/lib/observability/capture', () => ({ captureBackgroundError: mocks.capture }));
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
  it.each(['applied', 'duplicate'])(
    'alerts late activation once for %s outcome without logging provider data',
    async (outcome) => {
      const id = '11111111-1111-4111-8111-111111111111';
      mocks.execute
        .mockResolvedValueOnce([
          {
            account_id: id,
            event_id: 'log_late',
            event_type: 'subscription.completed',
            lease_token: '22222222-2222-4222-8222-222222222222',
            external_subscription_id: 'subs_fixture',
            external_checkout_id: 'bill_fixture',
            external_customer_id: 'cust_fixture',
            attempts: 3,
            attempt_limit: 10,
            received_at: new Date(Date.now() - 180000),
          },
        ])
        .mockResolvedValueOnce([
          {
            subscription_id: id,
            clinic_id: id,
            external_checkout_id: 'bill_fixture',
            product_id: 'prod_fixture',
            amount_minor: 39700,
          },
        ]);
      mocks.transaction.mockResolvedValueOnce(outcome);
      const remote = {
        id: 'subs_fixture',
        checkoutId: 'bill_fixture',
        customerId: 'cust_fixture',
        amount: 39700,
        status: 'ACTIVE',
        method: 'CARD',
        devMode: true,
        trialEndsAt: null,
        createdAt: new Date().toISOString(),
      };
      vi.stubGlobal(
        'fetch',
        vi.fn(async (target: RequestInfo | URL) => {
          const url = new URL(String(target));
          let data: unknown;
          if (url.pathname.endsWith('/stores/get')) data = { id: 'store_fixture' };
          else if (url.pathname.endsWith('/products/get'))
            data = {
              id: 'prod_fixture',
              externalId: 'fixture',
              price: 39700,
              currency: 'BRL',
              devMode: true,
              cycle: 'MONTHLY',
              trialDays: null,
            };
          else if (url.pathname.endsWith('/subscriptions/get')) data = remote;
          else if (url.pathname.endsWith('/checkouts/get'))
            data = {
              id: 'bill_fixture',
              customerId: 'cust_fixture',
              amount: 39700,
              paidAmount: 39700,
              status: 'PAID',
              devMode: true,
              frequency: 'SUBSCRIPTION',
              items: [{ id: 'prod_fixture', quantity: 1 }],
            };
          else if (url.pathname.endsWith('/subscriptions/list'))
            return Response.json({
              success: true,
              data: [remote],
              pagination: { hasMore: false, next: null },
            });
          else throw new Error('Unexpected synthetic endpoint');
          return Response.json({ success: true, data });
        }),
      );
      await reconcileAbacatePayInbox({ eventId: 'log_late' });
      expect(mocks.capture).toHaveBeenCalledTimes(outcome === 'applied' ? 1 : 0);
      if (outcome === 'applied')
        expect(mocks.capture).toHaveBeenCalledWith(expect.any(Error), {
          flow: 'billing.abacatepay.activation_late',
        });
    },
  );
  it.each([1, 10])(
    'records safe readback diagnostics and alerts terminal failure at attempt %i',
    async (attempts) => {
      mocks.execute
        .mockResolvedValueOnce([
          {
            account_id: '11111111-1111-4111-8111-111111111111',
            event_id: 'log_failed',
            event_type: 'subscription.completed',
            lease_token: '22222222-2222-4222-8222-222222222222',
            external_subscription_id: 'subs_fixture',
            external_checkout_id: 'bill_fixture',
            external_customer_id: 'cust_fixture',
            attempts,
            attempt_limit: 10,
            received_at: new Date(Date.now() - 180000),
          },
        ])
        .mockResolvedValueOnce([{ event_id: 'log_failed' }]);
      const result = await reconcileAbacatePayInbox({ eventId: 'log_failed' });
      expect(result.retry).toBe(attempts < 10);
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(mocks.emit).toHaveBeenCalledWith(
        'billing.abacatepay.reconcile_failed',
        expect.objectContaining({
          code: 'unavailable',
          httpStatus: null,
          attempts,
          processingMs: expect.any(Number),
        }),
      );
      expect(mocks.capture).toHaveBeenCalledTimes(attempts === 10 ? 1 : 0);
      expect(JSON.stringify(mocks.emit.mock.calls)).not.toContain('External network');
    },
  );
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
          received_at: new Date(),
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
