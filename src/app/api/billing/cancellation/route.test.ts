import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  origin: vi.fn(),
  authorize: vi.fn(),
  cancel: vi.fn(),
  emit: vi.fn(),
}));
vi.mock('@/lib/http/application-url', () => ({ resolveTrustedApplicationOrigin: mocks.origin }));
vi.mock('@/lib/auth/action-guard', () => ({ authorizeAction: mocks.authorize }));
vi.mock('@/lib/observability/metrics', () => ({ metrics: { emit: mocks.emit } }));
vi.mock('@/contexts/billing/internal/deferred-checkout', () => ({
  requestDeferredSubscriptionCancellation: mocks.cancel,
}));
vi.mock('@/contexts/billing/internal/abacatepay-management', () => ({
  AbacatePayManagementError: class extends Error {
    constructor(readonly code: string) {
      super(code);
    }
  },
}));
import { AbacatePayManagementError } from '@/contexts/billing/internal/abacatepay-management';
import { POST } from './route';

const contractId = '2d0c7853-147a-4b91-a178-3d081617c132';
const request = (body = JSON.stringify({ contractId })) =>
  new Request('https://qoro.example/api/billing/cancellation', { method: 'POST', body });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.origin.mockReturnValue('https://qoro.example');
  mocks.authorize.mockResolvedValue({
    ok: true,
    clinicId: 'server-clinic',
    user: { userId: 'server-user' },
  });
  mocks.cancel.mockResolvedValue({
    state: 'renewal_cancelled',
    accessUntil: '2026-12-01T12:00:00.000Z',
  });
});
describe('cancellation HTTP authorization boundary (unit doubles)', () => {
  it('uses only fresh server identity and contract generation, with no cache', async () => {
    const result = await POST(request());
    expect(result.status).toBe(200);
    expect(result.headers.get('cache-control')).toBe('no-store');
    expect(mocks.authorize).toHaveBeenCalledWith('manage:settings');
    expect(mocks.cancel).toHaveBeenCalledWith({
      clinicId: 'server-clinic',
      requestedBy: 'server-user',
      contractId,
    });
  });
  it.each([null, undefined])('rejects invalid/unconfigured origin', async (origin) => {
    mocks.origin.mockReturnValue(origin);
    expect((await POST(request())).status).toBe(origin === null ? 403 : 503);
    expect(mocks.cancel).not.toHaveBeenCalled();
  });
  it.each([401, 403])('rejects unauthorized %s', async (httpStatus) => {
    mocks.authorize.mockResolvedValue({ ok: false, httpStatus });
    expect((await POST(request())).status).toBe(httpStatus);
    expect(mocks.cancel).not.toHaveBeenCalled();
  });
  it.each([
    '{}',
    'null',
    '[]',
    '{"contractId":"subs_remote"}',
    JSON.stringify({ contractId, clinicId: 'other' }),
    JSON.stringify({ contractId, requestedBy: 'other' }),
  ])('rejects untrusted input %s', async (body) => {
    expect((await POST(request(body))).status).toBe(400);
    expect(mocks.cancel).not.toHaveBeenCalled();
  });
  it('caps body before any operation', async () => {
    expect((await POST(request(' '.repeat(257)))).status).toBe(413);
    expect(mocks.cancel).not.toHaveBeenCalled();
  });
  it.each(['unavailable', 'not_eligible', 'reconcile_required'] as const)(
    'does not claim success for %s',
    async (code) => {
      mocks.cancel.mockRejectedValue(new AbacatePayManagementError(code));
      const result = await POST(request());
      expect(result.status).toBe(code === 'unavailable' ? 503 : 409);
      expect(await result.json()).toEqual({ error: code });
    },
  );
  it('does not expose unexpected provider details', async () => {
    mocks.cancel.mockRejectedValue(new Error('sensitive-provider-body'));
    const result = await POST(request());
    expect(result.status).toBe(503);
    expect(await result.text()).not.toContain('sensitive');
    expect(JSON.stringify(mocks.emit.mock.calls)).not.toContain('sensitive');
  });
});
