import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  transaction: vi.fn(),
  authorize: vi.fn(),
  emit: vi.fn(),
  env: {
    NODE_ENV: 'production',
    VERCEL_ENV: 'production',
    SIGNUP_ENABLED: false,
    SAAS_SIGNUP_PROVIDER: 'asaas',
    ABACATEPAY_ENVIRONMENT: undefined as 'production' | undefined,
    ABACATEPAY_NEW_CHECKOUTS_ENABLED: false,
    ABACATEPAY_CHECKOUT_CLINIC_IDS: '',
    ABACATEPAY_STORE_ID: 'store_gate_b_synthetic',
    ABACATEPAY_API_KEY: 'synthetic-no-network',
    ABACATEPAY_WEBHOOK_SECRET: 'synthetic-no-network',
    APP_BASE_URL: 'https://qoro.example',
  },
}));
vi.mock('@/lib/env', () => ({ env: mocks.env }));
vi.mock('@/lib/db', () => ({
  dbAdmin: { execute: mocks.execute, transaction: mocks.transaction },
}));
vi.mock('@/lib/auth/action-guard', () => ({ authorizeAction: mocks.authorize }));
vi.mock('@/lib/http/application-url', () => ({
  resolveTrustedApplicationOrigin: () => 'https://qoro.example',
}));
vi.mock('@/lib/observability/metrics', () => ({ metrics: { emit: mocks.emit } }));
vi.mock('@/lib/observability/capture', () => ({ captureBackgroundError: vi.fn() }));

import { createDeferredSubscriptionCheckout } from '@/contexts/billing/internal/deferred-checkout';
import { createAbacatePayRecontractCheckout } from '@/contexts/billing/internal/abacatepay-management';
import { requestAbacatePayPlanChange } from '@/contexts/billing/internal/abacatepay-plan-changes';
import {
  reconcileAbacatePayInboxTick,
  reconcileAbacatePayRecoveryTick,
  reconcileAbacatePayCheckoutClosuresTick,
  reconcileAbacatePayRenewalWatchTick,
  reconcileMissingAbacatePayInitialPayment,
} from '@/contexts/billing/internal/abacatepay-processing';
import { POST as checkout } from './checkout/route';
import { POST as webhook } from '../webhooks/abacatepay/route';

const clinicId = '11111111-1111-4111-8111-111111111111';
const otherClinicId = '22222222-2222-4222-8222-222222222222';
const database = { execute: mocks.execute, transaction: mocks.transaction };
const request = (body = '{}') =>
  new Request('https://qoro.example/api/billing/checkout', { method: 'POST', body });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.env.ABACATEPAY_ENVIRONMENT = undefined;
  mocks.execute.mockRejectedValue(new Error('Database must not be reached in closed Gate B'));
  mocks.transaction.mockRejectedValue(new Error('Database must not be reached in closed Gate B'));
  mocks.authorize.mockResolvedValue({ ok: true, clinicId });
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network forbidden')));
});
afterEach(() => {
  expect(mocks.execute).not.toHaveBeenCalled();
  expect(mocks.transaction).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

describe('closed Gate B composition with real backend runtime guards', () => {
  it.each([clinicId, otherClinicId])('blocks direct checkout calls for tenant %s', async (id) => {
    await expect(createDeferredSubscriptionCheckout({ clinicId: id })).rejects.toThrow();
  });

  it('blocks direct re-contracting rather than returning a previous hosted checkout', async () => {
    await expect(
      createAbacatePayRecontractCheckout(database, {
        clinicId,
        productId: 'prod_synthetic',
        callbackUrl: 'https://qoro.example/configuracoes/assinatura',
      }),
    ).rejects.toThrow('unavailable');
  });

  it('blocks a plan change without relying on the checkout flag or firewall', async () => {
    await expect(
      requestAbacatePayPlanChange(database, {
        clinicId,
        requestedBy: clinicId,
        contractId: clinicId,
        targetPlanId: otherClinicId,
      }),
    ).rejects.toThrow('configuration unavailable');
  });

  it.each([401, 403])('rejects an unauthorized direct API call (%s)', async (httpStatus) => {
    mocks.authorize.mockResolvedValue({ ok: false, httpStatus });
    expect((await checkout(request())).status).toBe(httpStatus);
  });

  it('blocks an authenticated tenant even across repeated direct API calls', async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const result = await checkout(request());
      expect(result.status).toBe(503);
      expect(await result.json()).toEqual({ error: 'unavailable' });
    }
  });

  it('rejects a browser-supplied tenant rather than trusting it', async () => {
    expect((await checkout(request(JSON.stringify({ clinicId: otherClinicId })))).status).toBe(400);
  });

  it('keeps the AbacatePay webhook disarmed before inbox persistence', async () => {
    const result = await webhook(
      new Request('https://qoro.example/api/webhooks/abacatepay', {
        method: 'POST',
        body: '{}',
      }),
    );
    expect(result.status).toBe(503);
  });

  it('does not let an existing pending checkout start recovery while runtime is disarmed', async () => {
    expect(await reconcileMissingAbacatePayInitialPayment({ subscriptionId: clinicId })).toEqual({
      scanned: 0,
      applied: 0,
      duplicate: 0,
      review: 0,
    });
  });

  it('keeps all four shared-cron AbacatePay entrypoints inert', async () => {
    const deadline = Date.now() + 60_000;
    const results = await Promise.all([
      reconcileAbacatePayInboxTick(),
      reconcileAbacatePayRecoveryTick(deadline),
      reconcileAbacatePayCheckoutClosuresTick(deadline),
      reconcileAbacatePayRenewalWatchTick(),
    ]);
    expect(results).toHaveLength(4);
    expect(results.every((result) => result !== undefined)).toBe(true);
  });
});
