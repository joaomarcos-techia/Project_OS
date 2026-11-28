import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as PostgresStore from '@/lib/payments/saas/postgres-store';

const mocks = vi.hoisted(() => ({
  env: {
    ABACATEPAY_STORE_ID: 'store_synthetic',
    ABACATEPAY_WEBHOOK_SECRET: 'synthetic-secret-for-webhook-only-32',
  },
  guard: vi.fn(),
  accept: vi.fn(),
  process: vi.fn(),
  emit: vi.fn(),
  capture: vi.fn(),
}));
vi.mock('@/lib/env', () => ({ env: mocks.env }));
vi.mock('@/lib/db', () => ({ dbAdmin: {} }));
vi.mock(import('@/lib/payments/saas/acquisition'), async (importOriginal) => ({
  ...(await importOriginal()),
  assertAbacatePayRuntime: mocks.guard,
}));
vi.mock('@/lib/payments/saas/postgres-store', async (importOriginal) => {
  const actual = await importOriginal<typeof PostgresStore>();
  return {
    ...actual,
    createPostgresGatewayInbox: () => ({
      account: { provider: 'abacatepay', environment: 'sandbox', accountId: 'store_synthetic' },
      accept: mocks.accept,
    }),
  };
});
vi.mock('@/contexts/billing/internal/abacatepay-processing', () => ({
  reconcileAbacatePayInbox: mocks.process,
}));
vi.mock('@/lib/observability/metrics', () => ({ metrics: { emit: mocks.emit } }));
vi.mock('@/lib/observability/capture', () => ({ captureBackgroundError: mocks.capture }));
import { POST } from './route';
const publicKey =
  't9dXRhHHo3yDEj5pVDYz0frf7q6bMKyMRmxxCPIPp3RCplBfXRxqlC6ZpiWmOqj4L63qEaeUOtrCI8P0VMUgo6iIga2ri9ogaHFs0WIIywSMg0q7RmBfybe1E5XJcfC4IW3alNqym0tXoAKkzvfEjZxV6bE0oG2zJrNNYmUCKZyV0KZ3JS8Votf9EAWWYdiDkMkpbMdPggfh1EqHlVkMiTady6jOR3hyzGEHrIz2Ret0xHKMbiqkr9HS1JhNHDX9';
const body = JSON.stringify({
  id: 'log_composition',
  event: 'subscription.completed',
  apiVersion: 2,
  devMode: true,
  data: { subscription: { id: 'subs_fixture' } },
});
const request = (raw = body, secret = mocks.env.ABACATEPAY_WEBHOOK_SECRET) =>
  new Request(`https://qoro.example/api/webhooks/abacatepay?webhookSecret=${secret}`, {
    method: 'POST',
    body: raw,
    headers: {
      'X-Webhook-Signature': createHmac('sha256', publicKey).update(raw).digest('base64'),
    },
  });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.guard.mockImplementation(() => undefined);
  mocks.env.ABACATEPAY_STORE_ID = 'store_synthetic';
  mocks.accept.mockResolvedValue('accepted');
  mocks.process.mockResolvedValue({ applied: 1, review: 0, scanned: 1 });
});
describe('AbacatePay webhook composition (real authentication, unit persistence/worker doubles)', () => {
  it('only processes the exact event after durable authenticated acceptance', async () => {
    expect((await POST(request())).status).toBe(202);
    expect(mocks.accept).toHaveBeenCalledOnce();
    expect(mocks.process).toHaveBeenCalledWith({ eventId: 'log_composition' });
  });
  it('retries transient readback failures through provider redelivery, retaining the event', async () => {
    mocks.process.mockResolvedValue({ applied: 0, review: 0, scanned: 1, retry: true });
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(response.headers.get('retry-after')).toBe('30');
    mocks.accept.mockResolvedValue('duplicate');
    expect((await POST(request())).status).toBe(503);
    expect(mocks.process).toHaveBeenCalledTimes(2);
  });
  it('acknowledges an already applied duplicate without another financial effect', async () => {
    mocks.accept.mockResolvedValue('duplicate');
    mocks.process.mockResolvedValue({ applied: 0, review: 0, scanned: 0 });
    expect((await POST(request())).status).toBe(200);
  });
  it('does not ask for endless redelivery when the event requires human review', async () => {
    mocks.process.mockResolvedValue({ applied: 0, review: 1, scanned: 1, retry: false });
    expect((await POST(request())).status).toBe(202);
  });
  it('rejects wrong secret before persistence and worker', async () => {
    expect((await POST(request(body, 'wrong-secret'))).status).toBe(401);
    expect(mocks.accept).not.toHaveBeenCalled();
    expect(mocks.process).not.toHaveBeenCalled();
    expect(mocks.capture).not.toHaveBeenCalled();
  });
  it('rejects malformed authenticated payload before persistence', async () => {
    expect((await POST(request('not-json'))).status).toBe(400);
    expect(mocks.accept).not.toHaveBeenCalled();
    expect(mocks.process).not.toHaveBeenCalled();
  });
  it('fails closed on persistence failure', async () => {
    mocks.accept.mockRejectedValue(new Error('synthetic persistence unavailable'));
    expect((await POST(request())).status).toBe(503);
    expect(mocks.process).not.toHaveBeenCalled();
    expect(mocks.capture).toHaveBeenCalledWith(expect.any(Error), {
      flow: 'billing.abacatepay.webhook',
    });
  });
  it('blocks production before accessing inbox or processing', async () => {
    mocks.guard.mockImplementation(() => {
      throw new Error('Production forbidden');
    });
    expect((await POST(request())).status).toBe(503);
    expect(mocks.accept).not.toHaveBeenCalled();
  });
  it('fails closed when configuration is missing', async () => {
    mocks.env.ABACATEPAY_STORE_ID = '';
    expect((await POST(request())).status).toBe(503);
    expect(mocks.accept).not.toHaveBeenCalled();
  });
});
