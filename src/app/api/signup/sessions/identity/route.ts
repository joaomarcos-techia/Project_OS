import { NextResponse } from 'next/server';

import { hashSignupToken, recordSignupIdentity, signupIdentitySchema } from '@/contexts/onboarding';
import { assertSignupIdentityAllowed, getClientIp } from '@/lib/auth/rate-limit';
import { env } from '@/lib/env';
import { resolveTrustedApplicationOrigin } from '@/lib/http/application-url';
import { readWebhookBodyCapped } from '@/lib/http/webhook-body';

import { readSignupCookie, SIGNUP_COOKIE_CLEAR_OPTIONS, SIGNUP_SESSION_COOKIE } from '../../cookie';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const MAX_BODY_BYTES = 4_096;
const SIGNUP_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function error(reason: string, status: number): NextResponse {
  const response = NextResponse.json({ error: reason }, { status });
  if (reason === 'gone') {
    response.cookies.set(SIGNUP_SESSION_COOKIE, '', SIGNUP_COOKIE_CLEAR_OPTIONS);
  }
  return response;
}

export async function POST(req: Request): Promise<Response> {
  if (!env.SIGNUP_IDENTITY_ENABLED) return error('unavailable', 503);
  const publicOrigin = resolveTrustedApplicationOrigin(req);
  if (publicOrigin === undefined) return error('unavailable', 503);
  if (publicOrigin === null) return error('blocked', 403);
  const token = readSignupCookie(req);
  if (!token || !SIGNUP_TOKEN_PATTERN.test(token)) return error('gone', 410);
  try {
    const limit = await assertSignupIdentityAllowed(
      getClientIp(req.headers),
      hashSignupToken(token),
    );
    if (!limit.ok) {
      if (limit.reason === 'unavailable') return error('unavailable', 503);
      const response = error('rate_limited', 429);
      response.headers.set('Retry-After', String(limit.retryAfter));
      return response;
    }
    const raw = await readWebhookBodyCapped(req, MAX_BODY_BYTES);
    if (raw === null) return error('body_too_large', 413);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return error('invalid_body', 400);
    }
    const check = signupIdentitySchema.safeParse(parsed);
    if (!check.success) return error('invalid_body', 400);
    const result = await recordSignupIdentity(token, check.data);
    if (!result.ok) {
      return error(
        result.reason,
        result.reason === 'gone' ? 410 : result.reason === 'conflict' ? 409 : 503,
      );
    }
    return NextResponse.json({ rowVersion: result.rowVersion });
  } catch {
    return error('unavailable', 503);
  }
}
