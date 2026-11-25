import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  origin: vi.fn(),
  authorize: vi.fn(),
  request: vi.fn(),
  cancel: vi.fn(),
  emit: vi.fn(),
}));
vi.mock('@/lib/http/application-url', () => ({ resolveTrustedApplicationOrigin: mocks.origin }));
vi.mock('@/lib/auth/action-guard', () => ({ authorizeAction: mocks.authorize }));
vi.mock('@/lib/observability/metrics', () => ({ metrics: { emit: mocks.emit } }));
vi.mock('@/contexts/billing/internal/deferred-checkout', () => ({
  requestDeferredPixReplacementIntent: mocks.request,
  cancelDeferredPixReplacementIntent: mocks.cancel,
}));
vi.mock('@/contexts/billing/internal/abacatepay-pix-replacement-intent', () => ({
  PixReplacementIntentError: class extends Error {
    constructor(readonly code: string) {
      super(code);
    }
  },
}));

import { PixReplacementIntentError } from '@/contexts/billing/internal/abacatepay-pix-replacement-intent';
import { POST } from './route';

const contractId = '11111111-1111-4111-8111-111111111111';
const targetPlanId = '22222222-2222-4222-8222-222222222222';
const intentId = '33333333-3333-4333-8333-333333333333';
const makeRequest = (body: string) =>
  new Request('https://qoro.example/api/billing/pix-replacement-intent', {
    method: 'POST',
    body,
  });
const requestBody = JSON.stringify({
  action: 'request',
  contractId,
  targetPlanId,
  acknowledged: true,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.origin.mockReturnValue('https://qoro.example');
  mocks.authorize.mockResolvedValue({
    ok: true,
    clinicId: 'server-clinic',
    user: { userId: 'server-user' },
  });
  mocks.request.mockResolvedValue({ state: 'requested', intentId });
  mocks.cancel.mockResolvedValue({ state: 'cancelled' });
});

describe('Pix assistance request HTTP boundary', () => {
  it('derives tenant and actor from the authenticated server state', async () => {
    const result = await POST(makeRequest(requestBody));
    expect(result.status).toBe(200);
    expect(result.headers.get('cache-control')).toBe('no-store');
    expect(mocks.request).toHaveBeenCalledWith({
      clinicId: 'server-clinic',
      requestedBy: 'server-user',
      contractId,
      targetPlanId,
    });
  });
  it('cancels the request without invoking a subscription cancellation', async () => {
    const result = await POST(
      makeRequest(JSON.stringify({ action: 'cancel', contractId, intentId })),
    );
    expect(result.status).toBe(200);
    expect(mocks.cancel).toHaveBeenCalledWith({
      clinicId: 'server-clinic',
      requestedBy: 'server-user',
      contractId,
      intentId,
    });
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it.each([null, undefined])('rejects untrusted or unconfigured origin', async (origin) => {
    mocks.origin.mockReturnValue(origin);
    expect((await POST(makeRequest(requestBody))).status).toBe(origin === null ? 403 : 503);
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it('rejects actors without fresh management permission', async () => {
    mocks.authorize.mockResolvedValue({ ok: false, httpStatus: 403 });
    expect((await POST(makeRequest(requestBody))).status).toBe(403);
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it.each([
    '{}',
    'invalid',
    JSON.stringify({ action: 'request', contractId, targetPlanId }),
    JSON.stringify({ action: 'request', contractId, targetPlanId, acknowledged: false }),
    JSON.stringify({ action: 'request', contractId, targetPlanId, acknowledged: true, amount: 1 }),
    JSON.stringify({
      action: 'request',
      contractId,
      targetPlanId,
      acknowledged: true,
      clinicId: 'other',
    }),
    JSON.stringify({ action: 'cancel', contractId, intentId, subscriptionId: 'other' }),
  ])('rejects unsafe input %s', async (body) => {
    expect((await POST(makeRequest(body))).status).toBe(400);
    expect(mocks.request).not.toHaveBeenCalled();
    expect(mocks.cancel).not.toHaveBeenCalled();
  });
  it('caps the request body', async () => {
    expect((await POST(makeRequest(' '.repeat(513)))).status).toBe(413);
  });
  it('does not leak private exception data', async () => {
    mocks.request.mockRejectedValue(new Error('provider-private-data'));
    const result = await POST(makeRequest(requestBody));
    expect(result.status).toBe(503);
    expect(await result.text()).not.toContain('provider-private-data');
    expect(JSON.stringify(mocks.emit.mock.calls)).not.toContain('provider-private-data');
  });
  it('reports expected conflicts without claiming success', async () => {
    mocks.request.mockRejectedValue(new PixReplacementIntentError('pending_change'));
    expect((await POST(makeRequest(requestBody))).status).toBe(409);
  });
});
