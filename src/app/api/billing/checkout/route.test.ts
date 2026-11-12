import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  origin: vi.fn(),
  authorize: vi.fn(),
  checkout: vi.fn(),
  emit: vi.fn(),
}));
vi.mock('@/lib/http/application-url', () => ({ resolveTrustedApplicationOrigin: mocks.origin }));
vi.mock('@/lib/auth/action-guard', () => ({ authorizeAction: mocks.authorize }));
vi.mock('@/lib/observability/metrics', () => ({ metrics: { emit: mocks.emit } }));
vi.mock('@/contexts/billing/internal/deferred-checkout', () => ({
  createDeferredSubscriptionCheckout: mocks.checkout,
  DeferredCheckoutError: class extends Error {
    constructor(readonly code: string) {
      super(code);
    }
  },
}));

import { DeferredCheckoutError } from '@/contexts/billing/internal/deferred-checkout';
import { POST } from './route';

const request = (body = '{}') =>
  new Request('https://qoro.example/api/billing/checkout', { method: 'POST', body });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.origin.mockReturnValue('https://qoro.example');
  mocks.authorize.mockResolvedValue({ ok: true, clinicId: 'server-owned-clinic' });
  mocks.checkout.mockResolvedValue({
    state: 'checkout_pending',
    checkoutUrl: 'https://app.abacatepay.com/pay/bill_synthetic',
  });
});

describe('subscription checkout HTTP boundary (unit doubles)', () => {
  it('resolves tenant exclusively from fresh server authorization', async () => {
    const result = await POST(request());
    expect(result.status).toBe(200);
    expect(result.headers.get('cache-control')).toBe('no-store');
    expect(mocks.checkout).toHaveBeenCalledWith({ clinicId: 'server-owned-clinic' });
  });
  it.each([null, undefined])('blocks an untrusted or unconfigured origin', async (origin) => {
    mocks.origin.mockReturnValue(origin);
    expect((await POST(request())).status).toBe(origin === null ? 403 : 503);
    expect(mocks.authorize).not.toHaveBeenCalled();
  });
  it.each([401, 403])('does not originate for an unauthorized actor (%s)', async (httpStatus) => {
    mocks.authorize.mockResolvedValue({ ok: false, httpStatus });
    expect((await POST(request())).status).toBe(httpStatus);
    expect(mocks.checkout).not.toHaveBeenCalled();
  });
  it.each(['', 'null', '[]', '{"clinicId":"other"}', '{"price":1}', '{"productId":"prod_other"}'])(
    'rejects browser-owned input %s',
    async (body) => {
      expect((await POST(request(body))).status).toBe(400);
      expect(mocks.checkout).not.toHaveBeenCalled();
    },
  );
  it('caps body before parsing or provider effects', async () => {
    expect((await POST(request(' '.repeat(257)))).status).toBe(413);
    expect(mocks.checkout).not.toHaveBeenCalled();
  });
  it.each(['not_eligible', 'already_paid', 'cancelled', 'reconcile_required'] as const)(
    'returns safe state %s without changing provider',
    async (code) => {
      mocks.checkout.mockRejectedValue(new DeferredCheckoutError(code));
      const result = await POST(request());
      expect(result.status).toBe(409);
      expect(await result.json()).toEqual({ error: code });
    },
  );
  it('suppresses secrets in unexpected provider failures', async () => {
    mocks.checkout.mockRejectedValue(new Error('private-api-token-and-body'));
    const result = await POST(request());
    expect(result.status).toBe(503);
    expect(await result.text()).not.toContain('private');
    expect(JSON.stringify(mocks.emit.mock.calls)).not.toContain('private');
  });
});
