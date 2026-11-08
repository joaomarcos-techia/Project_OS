import 'server-only';

import { createHash } from 'node:crypto';
import { z } from 'zod';

import { safeEqual } from '@/lib/auth/secret-compare';
import { readWebhookBytesCapped } from '@/lib/http/webhook-body';

import { billingAccountSchema, GatewayReadError, type BillingAccount } from '../saas/contracts';
import { GatewayPersistenceError } from '../saas/postgres-store';
import { verifyAbacatePayNotification, type AbacatePayNotification } from './webhook';

type References = Omit<
  AbacatePayNotification,
  'provider' | 'environment' | 'knownSubscriptionEvent'
>;
export interface AbacatePayInbox {
  readonly account: BillingAccount;
  accept(references: References, bodyHash: string): Promise<'accepted' | 'duplicate'>;
}
type Failure =
  | 'authentication_failed'
  | 'invalid_request'
  | 'content_conflict'
  | 'persistence_failed';
const MAX_BYTES = 262_144;
const response = (status: number, body: object) =>
  Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });

/**
 * Composable receiver; NOT registered as a public Next route or deployed.
 * 202 means durable inbox acceptance only, never payment/access confirmation.
 * No raw URL, query secret, payload or provider/customer data enters diagnostics.
 */
export function createAbacatePayWebhookHandler(config: {
  account: BillingAccount;
  expectedSecret: string;
  inbox: AbacatePayInbox;
  onFailure: (reason: Failure) => void;
}) {
  const account = billingAccountSchema.safeParse(config.account);
  const inboxAccount = billingAccountSchema.safeParse(config.inbox.account);
  if (
    !account.success ||
    !inboxAccount.success ||
    account.data.provider !== 'abacatepay' ||
    account.data.provider !== inboxAccount.data.provider ||
    account.data.environment !== inboxAccount.data.environment ||
    account.data.accountId !== inboxAccount.data.accountId ||
    !z.string().min(32).max(1024).regex(/^\S+$/).safeParse(config.expectedSecret).success
  ) {
    throw new GatewayReadError('invalid_input');
  }
  const expectedSecret = config.expectedSecret;
  const expectedEnvironment = account.data.environment;
  const accept = config.inbox.accept.bind(config.inbox);
  const onFailure = config.onFailure;
  return async (request: Request): Promise<Response> => {
    if (request.method !== 'POST')
      return Response.json(
        { error: 'method_not_allowed' },
        { status: 405, headers: { Allow: 'POST' } },
      );
    const secrets = new URL(request.url).searchParams.getAll('webhookSecret');
    const suppliedSecret = secrets[0] ?? null;
    if (
      secrets.length !== 1 ||
      !suppliedSecret ||
      suppliedSecret.length > 1024 ||
      !safeEqual(expectedSecret, suppliedSecret)
    ) {
      onFailure('authentication_failed');
      return response(401, { error: 'unauthorized' });
    }
    const contentLength = Number(request.headers.get('content-length') ?? '0');
    if (contentLength > MAX_BYTES) return response(413, { error: 'body_too_large' });
    let body: Uint8Array | null;
    try {
      body = await readWebhookBytesCapped(request, MAX_BYTES);
    } catch {
      onFailure('invalid_request');
      return response(503, { error: 'request_interrupted' });
    }
    if (body === null) return response(413, { error: 'body_too_large' });
    let notification: AbacatePayNotification;
    try {
      notification = verifyAbacatePayNotification({
        rawBody: body,
        signature: request.headers.get('X-Webhook-Signature'),
        suppliedSecret,
        expectedSecret,
        expectedEnvironment,
      });
    } catch (error) {
      const unauthorized = error instanceof GatewayReadError && error.code === 'unauthorized';
      onFailure(unauthorized ? 'authentication_failed' : 'invalid_request');
      return response(unauthorized ? 401 : 400, {
        error: unauthorized ? 'unauthorized' : 'invalid_notification',
      });
    }
    try {
      const result = await accept(
        {
          eventId: notification.eventId,
          eventType: notification.eventType,
          subscriptionId: notification.subscriptionId,
          checkoutId: notification.checkoutId,
          paymentId: notification.paymentId,
          customerId: notification.customerId,
        },
        createHash('sha256').update(body).digest('hex'),
      );
      if (result !== 'accepted' && result !== 'duplicate') throw new GatewayPersistenceError();
      return result === 'duplicate'
        ? response(200, { received: true, duplicate: true })
        : response(202, { received: true, queued: true });
    } catch (error) {
      if (error instanceof GatewayPersistenceError && error.code === 'event_content_conflict') {
        onFailure('content_conflict');
        return response(409, { error: 'event_content_conflict' });
      }
      onFailure('persistence_failed');
      return response(503, { error: 'persistence_unavailable' });
    }
  };
}
