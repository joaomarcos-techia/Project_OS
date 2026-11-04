import { NextResponse } from 'next/server';
import { z } from 'zod';

import { requestSignupRecovery } from '@/contexts/onboarding';
import { hashEmail } from '@/lib/auth/email-hash';
import { assertSignupResendAllowed, getClientIp } from '@/lib/auth/rate-limit';
import { settleSignupAccountResponse } from '@/lib/auth/signup-response-timing';
import { env } from '@/lib/env';
import { resolveTrustedApplicationOrigin } from '@/lib/http/application-url';
import { readWebhookBodyCapped } from '@/lib/http/webhook-body';
import { logger } from '@/lib/observability/logger';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const schema = z.object({ email: z.string().trim().max(160).email() }).strict();
async function handleRequest(request: Request): Promise<Response> {
  const json = (status: number, body: object) =>
    NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store, private' } });
  if (!env.SIGNUP_AUTH_ENABLED || !env.SIGNUP_IDENTITY_ENABLED)
    return json(503, { error: 'unavailable' });
  const origin = resolveTrustedApplicationOrigin(request);
  if (origin === undefined) return json(503, { error: 'unavailable' });
  if (
    origin === null ||
    request.headers.get('origin') !== origin ||
    (request.headers.has('sec-fetch-site') &&
      request.headers.get('sec-fetch-site') !== 'same-origin')
  )
    return json(403, { error: 'blocked' });
  const raw = await readWebhookBodyCapped(request, 4096);
  if (raw === null) return json(413, { error: 'body_too_large' });
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return json(400, { error: 'invalid' });
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) return json(400, { error: 'invalid' });
  const scope = hashEmail(parsed.data.email);
  const limit = await assertSignupResendAllowed(getClientIp(request.headers), scope, scope);
  if (!limit.ok) {
    const response = json(limit.reason === 'rate_limited' ? 429 : 503, { error: limit.reason });
    if (limit.reason === 'rate_limited')
      response.headers.set('Retry-After', String(limit.retryAfter));
    return response;
  }
  const started = Date.now();
  try {
    await requestSignupRecovery(parsed.data.email, origin);
  } catch {
    logger.warn('signup.recovery.request_failed', { stage: 'delivery' });
  }
  await settleSignupAccountResponse(started);
  // No recipient, existence, verification, delivery or provider outcome escapes.
  return json(200, { ok: true });
}

export async function POST(request: Request): Promise<Response> {
  try {
    return await handleRequest(request);
  } catch {
    logger.warn('signup.recovery.request_failed', { stage: 'validation' });
    return NextResponse.json(
      { error: 'unavailable' },
      { status: 503, headers: { 'Cache-Control': 'no-store, private' } },
    );
  }
}
