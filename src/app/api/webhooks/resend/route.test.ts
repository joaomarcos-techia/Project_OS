import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({
  record: vi.fn(),
  verify: vi.fn(),
  parse: vi.fn(),
  env: { RESEND_WEBHOOK_SECRET: 'synthetic' },
}));
vi.mock('@/contexts/onboarding', () => ({ recordSignupEmailDelivery: m.record }));
vi.mock('@/lib/env', () => ({ env: m.env }));
vi.mock('@/lib/email/resend-webhook', () => ({
  verifyResendWebhook: m.verify,
  parseResendDeliveryEvent: m.parse,
}));
vi.mock('@/lib/observability/logger', () => ({ logger: { warn: vi.fn() } }));
import { POST } from './route';
const event = {
  messageId: '11111111-1111-4111-8111-111111111111',
  state: 'delivered',
  occurredAt: new Date(),
  bounceType: null,
};
const req = (raw = '{}') =>
  new Request('https://app.qoro.test/api/webhooks/resend', {
    method: 'POST',
    headers: { 'svix-id': 'msg_synthetic' },
    body: raw,
  });
beforeEach(() => {
  vi.clearAllMocks();
  m.env.RESEND_WEBHOOK_SECRET = 'synthetic';
  m.verify.mockReturnValue(true);
  m.parse.mockReturnValue(event);
  m.record.mockResolvedValue('recorded');
});
describe('Resend delivery HTTP boundary', () => {
  it('fails closed before persistence if the signing secret is missing', async () => {
    m.env.RESEND_WEBHOOK_SECRET = '';
    expect((await POST(req())).status).toBe(503);
    expect(m.record).not.toHaveBeenCalled();
  });
  it('rejects an invalid signature without parsing or persisting', async () => {
    m.verify.mockReturnValue(false);
    expect((await POST(req())).status).toBe(401);
    expect(m.parse).not.toHaveBeenCalled();
    expect(m.record).not.toHaveBeenCalled();
  });
  it('rejects an oversized body before signature processing', async () => {
    expect((await POST(req('a'.repeat(262145)))).status).toBe(413);
    expect(m.verify).not.toHaveBeenCalled();
  });
  it('rejects malformed JSON with a valid signature', async () => {
    expect((await POST(req('{'))).status).toBe(400);
    expect(m.record).not.toHaveBeenCalled();
  });
  it('acknowledges unsupported events without writing', async () => {
    m.parse.mockReturnValue(null);
    const response = await POST(req());
    expect(await response.json()).toEqual({ received: true, outcome: 'ignored' });
    expect(m.record).not.toHaveBeenCalled();
  });
  it.each(['recorded', 'duplicate'])(
    'acknowledges %s using only sanitized event data',
    async (outcome) => {
      m.record.mockResolvedValue(outcome);
      const response = await POST(req());
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ received: true, outcome });
      expect(m.record).toHaveBeenCalledWith({ id: 'msg_synthetic', ...event });
    },
  );
  it('returns retryable failure if persistence is unavailable', async () => {
    m.record.mockRejectedValue(new Error('private database detail'));
    const response = await POST(req());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'unavailable' });
  });
});
