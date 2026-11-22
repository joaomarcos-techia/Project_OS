import { createHash, createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import { GatewayPersistenceError } from '../saas/postgres-store';
import { createAbacatePayWebhookHandler } from './webhook-handler';

const account = {
  provider: 'abacatepay',
  environment: 'sandbox',
  accountId: 'store_fixture',
} as const;
const secret = 'synthetic-receiver-secret-at-least-32-chars';
const publicKey =
  't9dXRhHHo3yDEj5pVDYz0frf7q6bMKyMRmxxCPIPp3RCplBfXRxqlC6ZpiWmOqj4L63qEaeUOtrCI8P0VMUgo6iIga2ri9ogaHFs0WIIywSMg0q7RmBfybe1E5XJcfC4IW3alNqym0tXoAKkzvfEjZxV6bE0oG2zJrNNYmUCKZyV0KZ3JS8Votf9EAWWYdiDkMkpbMdPggfh1EqHlVkMiTady6jOR3hyzGEHrIz2Ret0xHKMbiqkr9HS1JhNHDX9';
const event = {
  id: 'log_http_fixture',
  event: 'subscription.completed',
  apiVersion: 2,
  devMode: true,
  data: {
    subscription: { id: 'subs_fixture', status: 'ACTIVE', amount: 19700 },
    customer: { id: 'cust_fixture', email: 'private@example.test' },
    payment: { id: 'char_fixture' },
  },
};
function request(body = JSON.stringify(event), suppliedSecret = secret, signature?: string) {
  return new Request(
    `https://qoro.example/webhook?webhookSecret=${encodeURIComponent(suppliedSecret)}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature':
          signature ?? createHmac('sha256', publicKey).update(body).digest('base64'),
      },
      body,
    },
  );
}
function setup() {
  const accept = vi
    .fn<(_: { eventId: string }, hash: string) => Promise<'accepted' | 'duplicate'>>()
    .mockResolvedValue('accepted');
  const onFailure = vi.fn();
  const handler = createAbacatePayWebhookHandler({
    account,
    expectedSecret: secret,
    inbox: { account, accept },
    onFailure,
  });
  return { handler, accept, onFailure };
}

describe('composable AbacatePay receiver (unit persistence double)', () => {
  it('queues only after persistence and stores IDs/hash instead of raw body/PII/status', async () => {
    const { handler, accept } = setup();
    const body = JSON.stringify(event);
    const result = await handler(request(body));
    expect(result.status).toBe(202);
    expect(await result.json()).toEqual({ received: true, queued: true });
    expect(accept).toHaveBeenCalledWith(
      {
        eventId: 'log_http_fixture',
        eventType: 'subscription.completed',
        subscriptionId: 'subs_fixture',
        checkoutId: null,
        paymentId: 'char_fixture',
        customerId: 'cust_fixture',
      },
      createHash('sha256').update(body).digest('hex'),
    );
    expect(JSON.stringify(accept.mock.calls)).not.toContain('private@example.test');
    expect(JSON.stringify(accept.mock.calls)).not.toContain('19700');
    expect(JSON.stringify(accept.mock.calls)).not.toContain(secret);
  });
  it('does not return success while persistence is still pending', async () => {
    const { handler, accept } = setup();
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    accept.mockImplementation(async () => {
      await gate;
      return 'accepted';
    });
    let settled = false;
    const pending = handler(request()).then((result) => {
      settled = true;
      return result;
    });
    await vi.waitFor(() => expect(accept).toHaveBeenCalledTimes(1));
    expect(settled).toBe(false);
    if (!release) throw new Error('Missing synthetic persistence gate');
    release();
    expect((await pending).status).toBe(202);
  });
  it('returns 200 only for a durably known duplicate', async () => {
    const { handler, accept } = setup();
    accept.mockResolvedValue('duplicate');
    const result = await handler(request());
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ received: true, duplicate: true });
  });
  it('returns retryable 503 when persistence fails without leaking raw errors', async () => {
    const { handler, accept, onFailure } = setup();
    accept.mockRejectedValue(new Error(`private database URL and ${secret}`));
    const result = await handler(request());
    expect(result.status).toBe(503);
    expect(await result.text()).toBe('{"error":"persistence_unavailable"}');
    expect(onFailure).toHaveBeenCalledWith('persistence_failed');
    expect(JSON.stringify(onFailure.mock.calls)).not.toContain(secret);
  });
  it('flags conflicting content under the same event ID', async () => {
    const { handler, accept, onFailure } = setup();
    accept.mockRejectedValue(new GatewayPersistenceError('event_content_conflict'));
    expect((await handler(request())).status).toBe(409);
    expect(onFailure).toHaveBeenCalledWith('content_conflict');
  });
  it.each(['', 'incorrect-secret'])(
    'rejects invalid URL secret %j without persistence',
    async (suppliedSecret) => {
      const { handler, accept } = setup();
      expect((await handler(request(JSON.stringify(event), suppliedSecret))).status).toBe(401);
      expect(accept).not.toHaveBeenCalled();
    },
  );
  it('rejects a duplicated URL secret', async () => {
    const { handler, accept } = setup();
    const first = request();
    const duplicate = new Request(`${first.url}&webhookSecret=${secret}`, {
      method: 'POST',
      body: JSON.stringify(event),
      headers: first.headers,
    });
    expect((await handler(duplicate)).status).toBe(401);
    expect(accept).not.toHaveBeenCalled();
  });
  it('rejects an invalid HMAC even when the secret matches', async () => {
    const { handler, accept } = setup();
    expect(
      (await handler(request(JSON.stringify(event), secret, 'a'.repeat(43) + '='))).status,
    ).toBe(401);
    expect(accept).not.toHaveBeenCalled();
  });
  it.each([
    '{',
    JSON.stringify({ ...event, devMode: false }),
    JSON.stringify({ ...event, id: '' }),
  ])('does not persist malformed/cross-environment notifications', async (body) => {
    const { handler, accept } = setup();
    expect((await handler(request(body))).status).toBe(400);
    expect(accept).not.toHaveBeenCalled();
  });
  it('persists unknown events without claiming a domain effect', async () => {
    const { handler, accept } = setup();
    const response = await handler(
      request(JSON.stringify({ ...event, event: 'subscription.future_event', data: {} })),
    );
    expect(response.status).toBe(202);
    expect(accept).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'subscription.future_event', subscriptionId: null }),
      expect.any(String),
    );
  });
  it('caps actual body bytes even when Content-Length lies', async () => {
    const { handler, accept } = setup();
    const large = request('x'.repeat(262145));
    large.headers.set('Content-Length', '1');
    expect((await handler(large)).status).toBe(413);
    expect(accept).not.toHaveBeenCalled();
  });
  it('rejects GET without persistence', async () => {
    const { handler, accept } = setup();
    const response = await handler(new Request('https://qoro.example/webhook'));
    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('POST');
    expect(accept).not.toHaveBeenCalled();
  });
  it('refuses a receiver wired to a different account/environment', () => {
    const { accept, onFailure } = setup();
    expect(() =>
      createAbacatePayWebhookHandler({
        account,
        expectedSecret: secret,
        inbox: { account: { ...account, accountId: 'store_other' }, accept },
        onFailure,
      }),
    ).toThrow('invalid_input');
  });
});
