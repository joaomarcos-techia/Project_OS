import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  signSignupConfirmationGrant,
  SIGNUP_CONFIRMATION_GRANT_COOKIE,
  SIGNUP_CONFIRMATION_GRANT_TTL_SECONDS,
} from '@/lib/auth/signup-confirmation-grant';

import {
  confirmSignupEmailCode,
  hashSignupToken,
  signupEmailCodeSchema,
} from '@/contexts/onboarding';
import { hashEmail } from '@/lib/auth/email-hash';
import { assertSignupContinuationAllowed, getClientIp } from '@/lib/auth/rate-limit';
import { env } from '@/lib/env';
import { resolveTrustedApplicationOrigin } from '@/lib/http/application-url';
import { readWebhookBodyCapped } from '@/lib/http/webhook-body';
import { logger } from '@/lib/observability/logger';

import { readSignupCookie } from '../../cookie';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function json(body: object, status = 200): Response {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store, private' } });
}

export async function POST(request: Request): Promise<Response> {
  if (!env.SIGNUP_AUTH_ENABLED || !env.SIGNUP_IDENTITY_ENABLED)
    return json({ error: 'unavailable' }, 503);
  const origin = resolveTrustedApplicationOrigin(request);
  if (origin === undefined) return json({ error: 'unavailable' }, 503);
  if (
    origin === null ||
    request.headers.get('origin') !== origin ||
    (request.headers.has('sec-fetch-site') &&
      request.headers.get('sec-fetch-site') !== 'same-origin')
  ) {
    return json({ error: 'blocked' }, 403);
  }
  const token = readSignupCookie(request);
  if (!token || !/^[A-Za-z0-9_-]{43}$/u.test(token)) return json({ error: 'gone' }, 410);
  try {
    const raw = await readWebhookBodyCapped(request, 4096);
    if (raw === null) return json({ error: 'body_too_large' }, 413);
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      return json({ error: 'invalid' }, 400);
    }
    const parsed = signupEmailCodeSchema.safeParse(value);
    if (!parsed.success) return json({ error: 'invalid' }, 400);
    const limit = await assertSignupContinuationAllowed(
      getClientIp(request.headers),
      hashSignupToken(token),
      hashEmail(parsed.data.email),
    );
    if (!limit.ok) {
      const response = json({ error: limit.reason }, limit.reason === 'rate_limited' ? 429 : 503);
      if (limit.reason === 'rate_limited')
        response.headers.set('Retry-After', String(limit.retryAfter));
      return response;
    }
    const result = await confirmSignupEmailCode(token, parsed.data);
    if (result.ok) {
      if (result.mailProof) {
        const jar = await cookies();
        jar.set(
          SIGNUP_CONFIRMATION_GRANT_COOKIE,
          signSignupConfirmationGrant({
            ...result.mailProof,
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
      }
      return json({ next: result.next });
    }
    const status =
      result.reason === 'gone'
        ? 410
        : result.reason === 'conflict'
          ? 409
          : result.reason === 'unavailable'
            ? 503
            : result.reason === 'locked'
              ? 429
              : 422;
    return json({ error: result.reason }, status);
  } catch {
    logger.warn('signup.code.request_failed', { stage: 'confirmation' });
    return json({ error: 'unavailable' }, 503);
  }
}
