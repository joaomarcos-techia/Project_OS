import 'server-only';

import { createHmac } from 'node:crypto';
import { z } from 'zod';

import { safeEqual } from '@/lib/auth/secret-compare';

import { GatewayReadError, opaqueBillingId, parseBillingValue } from '../saas/contracts';

// Public integrity key published by AbacatePay, NOT an authentication secret.
// https://docs.abacatepay.com/pages/webhooks/security (consulted 07/11/2026).
const ABACATEPAY_HMAC_PUBLIC_KEY =
  't9dXRhHHo3yDEj5pVDYz0frf7q6bMKyMRmxxCPIPp3RCplBfXRxqlC6ZpiWmOqj4L63qEaeUOtrCI8P0VMUgo6iIga2ri9ogaHFs0WIIywSMg0q7RmBfybe1E5XJcfC4IW3alNqym0tXoAKkzvfEjZxV6bE0oG2zJrNNYmUCKZyV0KZ3JS8Votf9EAWWYdiDkMkpbMdPggfh1EqHlVkMiTady6jOR3hyzGEHrIz2Ret0xHKMbiqkr9HS1JhNHDX9';
const MAX_EVENT_BYTES = 262_144;
const SIGNATURE_BASE64 = /^[A-Za-z0-9+/]{43}=$/;
const knownSubscriptionEvents = new Set([
  'subscription.trial_started',
  'subscription.completed',
  'subscription.renewed',
  'subscription.payment_failed',
  'subscription.cancelled',
]);
const refSchema = z.object({ id: opaqueBillingId });
const eventSchema = z.object({
  id: opaqueBillingId,
  event: z.string().regex(/^[a-z][a-z0-9_.]{0,127}$/),
  apiVersion: z.literal(2),
  devMode: z.boolean(),
  data: z.object({
    subscription: refSchema.optional(),
    payment: refSchema.optional(),
    checkout: refSchema.optional(),
    customer: refSchema.optional(),
  }),
});

export interface AbacatePayNotification {
  provider: 'abacatepay';
  environment: 'sandbox' | 'production';
  eventId: string;
  eventType: string;
  knownSubscriptionEvent: boolean;
  subscriptionId: string | null;
  paymentId: string | null;
  checkoutId: string | null;
  customerId: string | null;
}

/**
 * Authentication/parser only: NOT a webhook receiver, durable acceptance,
 * deduplication, account verification, financial truth or authorization to grant.
 * Keep status/amount/customer PII out of this notification; read the bound API.
 */
export function verifyAbacatePayNotification(input: {
  rawBody: Uint8Array;
  signature: string | null;
  suppliedSecret: string | null;
  expectedSecret: string;
  expectedEnvironment: 'sandbox' | 'production';
}): AbacatePayNotification {
  if (
    !z.string().min(32).max(1024).regex(/^\S+$/).safeParse(input.expectedSecret).success ||
    !z.enum(['sandbox', 'production']).safeParse(input.expectedEnvironment).success ||
    !z.string().min(32).max(1024).safeParse(input.suppliedSecret).success ||
    !safeEqual(input.expectedSecret, input.suppliedSecret) ||
    !input.signature ||
    !SIGNATURE_BASE64.test(input.signature)
  ) {
    throw new GatewayReadError('unauthorized');
  }
  if (input.rawBody.byteLength > MAX_EVENT_BYTES) throw new GatewayReadError('invalid_response');
  const expectedSignature = createHmac('sha256', ABACATEPAY_HMAC_PUBLIC_KEY)
    .update(input.rawBody)
    .digest('base64');
  if (!safeEqual(input.signature, expectedSignature)) throw new GatewayReadError('unauthorized');

  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(input.rawBody));
  } catch {
    throw new GatewayReadError('invalid_response');
  }
  const event = parseBillingValue(eventSchema, body);
  if (event.devMode !== (input.expectedEnvironment === 'sandbox')) {
    throw new GatewayReadError('environment_mismatch');
  }
  const known = knownSubscriptionEvents.has(event.event);
  if (known && !event.data.subscription?.id.startsWith('subs_')) {
    throw new GatewayReadError('invalid_response');
  }
  return {
    provider: 'abacatepay',
    environment: input.expectedEnvironment,
    eventId: event.id,
    eventType: event.event,
    knownSubscriptionEvent: known,
    subscriptionId: event.data.subscription?.id ?? null,
    paymentId: event.data.payment?.id ?? null,
    checkoutId: event.data.checkout?.id ?? null,
    customerId: event.data.customer?.id ?? null,
  };
}
