import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { verifyAbacatePayNotification } from './webhook';

// Public key copied from the provider's documented signature fixture, not from
// the implementation export: this checks that the implementation uses V2's key.
const publicIntegrityKey =
  't9dXRhHHo3yDEj5pVDYz0frf7q6bMKyMRmxxCPIPp3RCplBfXRxqlC6ZpiWmOqj4L63qEaeUOtrCI8P0VMUgo6iIga2ri9ogaHFs0WIIywSMg0q7RmBfybe1E5XJcfC4IW3alNqym0tXoAKkzvfEjZxV6bE0oG2zJrNNYmUCKZyV0KZ3JS8Votf9EAWWYdiDkMkpbMdPggfh1EqHlVkMiTady6jOR3hyzGEHrIz2Ret0xHKMbiqkr9HS1JhNHDX9';
const secret = 'synthetic-webhook-secret-32-characters-minimum';
const event = {
  id: 'log_fixture',
  event: 'subscription.completed',
  apiVersion: 2,
  devMode: true,
  data: {
    subscription: { id: 'subs_test', status: 'ACTIVE', amount: 39700 },
    payment: { id: 'char_test', status: 'PAID' },
    customer: { id: 'cust_test', email: 'private@example.test' },
  },
};
function signed(body: unknown = event) {
  const rawBody = Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  return {
    rawBody,
    signature: createHmac('sha256', publicIntegrityKey).update(rawBody).digest('base64'),
    suppliedSecret: secret,
    expectedSecret: secret,
    expectedEnvironment: 'sandbox' as const,
  };
}

describe('AbacatePay authenticated notification parser (no durable receiver)', () => {
  it('accepts the support-confirmed lost dispute without inventing a subscription ID or financial effect', () => {
    const notification = verifyAbacatePayNotification(
      signed({
        id: 'log_lost_fixture',
        event: 'checkout.lost',
        apiVersion: 2,
        devMode: true,
        data: {
          checkout: { id: 'bill_cycle', status: 'LOST' },
          customer: { id: 'cust_test', email: 'private@example.test' },
          payerInformation: { method: 'CARD', CARD: { number: '1234', brand: 'VISA' } },
        },
      }),
    );
    expect(notification).toMatchObject({
      eventType: 'checkout.lost',
      checkoutId: 'bill_cycle',
      customerId: 'cust_test',
      subscriptionId: null,
      paymentId: null,
    });
    expect(JSON.stringify(notification)).not.toMatch(/private@example|1234|LOST|payerInformation/);
  });
  it('validates the secret AND the HMAC and returns only identifiers', () => {
    const notification = verifyAbacatePayNotification(signed());
    expect(notification).toEqual({
      provider: 'abacatepay',
      environment: 'sandbox',
      eventId: 'log_fixture',
      eventType: 'subscription.completed',
      knownSubscriptionEvent: true,
      subscriptionId: 'subs_test',
      paymentId: 'char_test',
      customerId: 'cust_test',
      checkoutId: null,
    });
    expect(JSON.stringify(notification)).not.toContain('private@example.test');
    expect(notification).not.toHaveProperty('amount');
    expect(notification).not.toHaveProperty('status');
  });
  it('does not treat public-key HMAC as sender authentication', () => {
    expect(() =>
      verifyAbacatePayNotification({ ...signed(), suppliedSecret: 'incorrect-secret' }),
    ).toThrow('unauthorized');
  });
  it.each([null, '', '   '])('rejects a missing/empty URL secret: %j', (suppliedSecret) => {
    expect(() => verifyAbacatePayNotification({ ...signed(), suppliedSecret })).toThrow(
      'unauthorized',
    );
  });
  it.each(['', ' '.repeat(32)])(
    'rejects an unset or whitespace expected secret',
    (expectedSecret) => {
      expect(() => verifyAbacatePayNotification({ ...signed(), expectedSecret })).toThrow(
        'unauthorized',
      );
    },
  );
  it.each([null, '', 'invalid-base64', 'a'.repeat(44)])(
    'rejects malformed signature: %j',
    (signature) => {
      expect(() => verifyAbacatePayNotification({ ...signed(), signature })).toThrow(
        'unauthorized',
      );
    },
  );
  it('rejects body tampering even when the JSON meaning is unchanged', () => {
    const input = signed();
    expect(() =>
      verifyAbacatePayNotification({
        ...input,
        rawBody: Buffer.concat([input.rawBody, Buffer.from(' ')]),
      }),
    ).toThrow('unauthorized');
  });
  it('rejects an event from the other environment', () => {
    expect(() => verifyAbacatePayNotification(signed({ ...event, devMode: false }))).toThrow(
      'environment_mismatch',
    );
  });
  it('rejects V1, missing IDs, invalid JSON and invalid UTF-8', () => {
    for (const body of [{ ...event, apiVersion: 1 }, { ...event, id: undefined }, '{not JSON']) {
      expect(() => verifyAbacatePayNotification(signed(body))).toThrow('invalid_response');
    }
    const rawBody = Buffer.from([0xff]);
    const signature = createHmac('sha256', publicIntegrityKey).update(rawBody).digest('base64');
    expect(() => verifyAbacatePayNotification({ ...signed(), rawBody, signature })).toThrow(
      'invalid_response',
    );
  });
  it('refuses an oversized event before parsing', () => {
    expect(() => verifyAbacatePayNotification(signed('a'.repeat(262_145)))).toThrow(
      'invalid_response',
    );
  });
  it('requires a subscription reference for a known subscription event', () => {
    expect(() => verifyAbacatePayNotification(signed({ ...event, data: {} }))).toThrow(
      'invalid_response',
    );
  });
  it('keeps unknown event types explicit instead of inventing a paid effect', () => {
    expect(
      verifyAbacatePayNotification(signed({ ...event, event: 'future.event', data: {} })),
    ).toMatchObject({ knownSubscriptionEvent: false, subscriptionId: null, paymentId: null });
  });
  it('keeps the same event ID on replay, leaving dedup to durable processing', () => {
    expect(verifyAbacatePayNotification(signed()).eventId).toBe(
      verifyAbacatePayNotification(signed()).eventId,
    );
  });
});
