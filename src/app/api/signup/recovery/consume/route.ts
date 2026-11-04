import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import {
  consumeSignupRecovery,
  hashSignupToken,
  signupRecoveryInputSchema,
  SIGNUP_RECOVERY_COOKIE,
} from '@/contexts/onboarding';
import { assertSignupContinuationAllowed, getClientIp } from '@/lib/auth/rate-limit';
import {
  signSignupConfirmationGrant,
  SIGNUP_CONFIRMATION_GRANT_TTL_SECONDS,
} from '@/lib/auth/signup-confirmation-grant';
import { env } from '@/lib/env';
import { resolveTrustedApplicationOrigin } from '@/lib/http/application-url';
import { readWebhookBodyCapped } from '@/lib/http/webhook-body';
import { logger } from '@/lib/observability/logger';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export async function POST(request: Request): Promise<Response> {
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
  try {
    const raw = await readWebhookBodyCapped(request, 4096);
    if (raw === null) return json(413, { error: 'body_too_large' });
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      return json(400, { error: 'invalid' });
    }
    const parsed = signupRecoveryInputSchema.safeParse(value);
    if (!parsed.success) return json(400, { error: 'invalid' });
    const scope = hashSignupToken(parsed.data.token);
    const limit = await assertSignupContinuationAllowed(getClientIp(request.headers), scope, scope);
    if (!limit.ok) {
      const response = json(limit.reason === 'rate_limited' ? 429 : 503, { error: limit.reason });
      if (limit.reason === 'rate_limited')
        response.headers.set('Retry-After', String(limit.retryAfter));
      return response;
    }
    const result = await consumeSignupRecovery(parsed.data);
    if (!result.ok) return json(result.reason === 'invalid' ? 410 : 503, { error: result.reason });
    const jar = await cookies();
    jar.set(
      SIGNUP_RECOVERY_COOKIE,
      signSignupConfirmationGrant({
        userId: result.userId,
        signupRef: result.signupRef,
        expiresAt: Date.now() + SIGNUP_CONFIRMATION_GRANT_TTL_SECONDS * 1000,
      }),
      {
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        path: '/',
        maxAge: SIGNUP_CONFIRMATION_GRANT_TTL_SECONDS,
      },
    );
    return json(200, { next: result.next });
  } catch {
    logger.warn('signup.recovery.request_failed', { stage: 'consume' });
    return json(503, { error: 'unavailable' });
  }
}
