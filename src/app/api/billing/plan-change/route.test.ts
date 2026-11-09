import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  origin: vi.fn(),
  authorize: vi.fn(),
  change: vi.fn(),
  emit: vi.fn(),
}));
vi.mock('@/lib/http/application-url', () => ({ resolveTrustedApplicationOrigin: mocks.origin }));
vi.mock('@/lib/auth/action-guard', () => ({ authorizeAction: mocks.authorize }));
vi.mock('@/lib/observability/metrics', () => ({ metrics: { emit: mocks.emit } }));
vi.mock('@/contexts/billing/internal/abacatepay-plan-changes', () => ({
  AbacatePayPlanChangeError: class extends Error {
    constructor(readonly code: string) {
      super(code);
    }
  },
}));
vi.mock('@/contexts/billing/internal/deferred-checkout', () => ({
  requestDeferredSubscriptionPlanChange: mocks.change,
}));
vi.mock('@/contexts/billing/internal/plan-changes', () => ({
  PlanChangeError: class extends Error {
    constructor(readonly code: string) {
      super(code);
    }
  },
}));
import { AbacatePayPlanChangeError } from '@/contexts/billing/internal/abacatepay-plan-changes';
import { POST } from './route';
const contractId = '2d0c7853-147a-4b91-a178-3d081617c132',
  targetPlanId = '42d7c36b-ab24-490e-ae71-a8becc1217eb';
const request = (body = JSON.stringify({ contractId, targetPlanId })) =>
  new Request('https://qoro.example/api/billing/plan-change', { method: 'POST', body });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.origin.mockReturnValue('https://qoro.example');
  mocks.authorize.mockResolvedValue({
    ok: true,
    clinicId: 'server-clinic',
    user: { userId: 'server-user' },
  });
  mocks.change.mockResolvedValue({ state: 'scheduled' });
});
describe('scheduled AbacatePay plan-change HTTP boundary (unit)', () => {
  it('derives tenant and actor from authorized server state and never accepts client money', async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(mocks.authorize).toHaveBeenCalledWith('manage:settings');
    expect(mocks.change).toHaveBeenCalledWith({
      clinicId: 'server-clinic',
      requestedBy: 'server-user',
      contractId,
      targetPlanId,
    });
  });
  it.each([null, undefined])('rejects an untrusted/unconfigured origin', async (origin) => {
    mocks.origin.mockReturnValue(origin);
    expect((await POST(request())).status).toBe(origin === null ? 403 : 503);
    expect(mocks.change).not.toHaveBeenCalled();
  });
  it.each([401, 403])('rejects unauthorized %s', async (httpStatus) => {
    mocks.authorize.mockResolvedValue({ ok: false, httpStatus });
    expect((await POST(request())).status).toBe(httpStatus);
    expect(mocks.change).not.toHaveBeenCalled();
  });
  it.each([
    '{}',
    'null',
    '[]',
    'invalid',
    JSON.stringify({ contractId, targetPlanId, amountMinor: 1 }),
    JSON.stringify({ contractId, targetPlanId, clinicId: 'other' }),
    JSON.stringify({ contractId, targetPlanId, requestedBy: 'other' }),
    JSON.stringify({ contractId: 'subs_provider', targetPlanId }),
  ])('rejects unsafe body %s', async (body) => {
    expect((await POST(request(body))).status).toBe(400);
    expect(mocks.change).not.toHaveBeenCalled();
  });
  it('caps the body before any operation', async () => {
    expect((await POST(request(' '.repeat(513)))).status).toBe(413);
    expect(mocks.change).not.toHaveBeenCalled();
  });
  it.each(['unavailable', 'not_eligible', 'pending_change', 'reconcile_required'] as const)(
    'does not claim success for %s',
    async (code) => {
      mocks.change.mockRejectedValue(new AbacatePayPlanChangeError(code));
      expect((await POST(request())).status).toBe(code === 'unavailable' ? 503 : 409);
    },
  );
  it('suppresses private provider error details', async () => {
    mocks.change.mockRejectedValue(new Error('private-provider-secret'));
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('private');
    expect(JSON.stringify(mocks.emit.mock.calls)).not.toContain('private');
  });
});
