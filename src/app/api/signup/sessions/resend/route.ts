import { NextResponse } from 'next/server';

import {
  finishSignupResendAttempt,
  hashSignupToken,
  reserveSignupResendAttempt,
  signupResendSchema,
} from '@/contexts/onboarding';
import { captchaOptions } from '@/lib/auth/captcha';
import { hashEmail } from '@/lib/auth/email-hash';
import { assertSignupResendAllowed, getClientIp } from '@/lib/auth/rate-limit';
import { createServerClient } from '@/lib/auth/supabase-server';
import { env } from '@/lib/env';
import { buildApplicationUrl } from '@/lib/http/application-url';
import { readWebhookBodyCapped } from '@/lib/http/webhook-body';

import { readSignupCookie, SIGNUP_COOKIE_CLEAR_OPTIONS, SIGNUP_SESSION_COOKIE } from '../../cookie';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const MAX_RESEND_BODY_BYTES = 16_384;

function json(body: { error: string } | { rowVersion: number }, status = 200): NextResponse {
  const response = NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
  if ('error' in body && body.error === 'gone') {
    response.cookies.set(SIGNUP_SESSION_COOKIE, '', SIGNUP_COOKIE_CLEAR_OPTIONS);
  }
  return response;
}

export async function POST(req: Request): Promise<Response> {
  if (!env.SIGNUP_AUTH_ENABLED || !env.SIGNUP_IDENTITY_ENABLED)
    return json({ error: 'unavailable' }, 503);
  let redirectUrl: string;
  try {
    redirectUrl = buildApplicationUrl(env.APP_BASE_URL ?? '', '/auth/confirm', {
      allowInsecureLocalhost: env.NODE_ENV !== 'production',
    });
  } catch {
    return json({ error: 'unavailable' }, 503);
  }
  if (
    req.headers.get('origin') !== new URL(redirectUrl).origin ||
    req.headers.get('sec-fetch-site') === 'cross-site'
  ) {
    return json({ error: 'blocked' }, 403);
  }
  const token = readSignupCookie(req);
  if (!token || !/^[A-Za-z0-9_-]{43}$/u.test(token)) return json({ error: 'gone' }, 410);

  try {
    const raw = await readWebhookBodyCapped(req, MAX_RESEND_BODY_BYTES);
    if (raw === null) return json({ error: 'body_too_large' }, 413);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return json({ error: 'invalid_body' }, 400);
    }
    const check = signupResendSchema.safeParse(parsed);
    if (!check.success) return json({ error: 'invalid_body' }, 400);
    const { email, captchaToken } = check.data;
    const limit = await assertSignupResendAllowed(
      getClientIp(req.headers),
      hashSignupToken(token),
      hashEmail(email),
    );
    if (!limit.ok) {
      const response = json({ error: limit.reason }, limit.reason === 'rate_limited' ? 429 : 503);
      if (limit.reason === 'rate_limited')
        response.headers.set('Retry-After', String(limit.retryAfter));
      return response;
    }

    const reserved = await reserveSignupResendAttempt(token, check.data);
    if (!reserved.ok) {
      const response = json(
        { error: reserved.reason },
        reserved.reason === 'gone'
          ? 410
          : reserved.reason === 'conflict'
            ? 409
            : reserved.reason === 'cooldown'
              ? 429
              : 503,
      );
      if (reserved.reason === 'cooldown')
        response.headers.set('Retry-After', String(reserved.retryAfter));
      return response;
    }

    let completed = false;
    try {
      const supabase = await createServerClient({
        cookieWrites: 'required',
        sessionWrites: 'reject',
      });
      const { data, error } = await supabase.auth.resend({
        type: 'signup',
        email,
        options: { emailRedirectTo: redirectUrl, ...captchaOptions(captchaToken) },
      });
      completed = !data.session && !error;
    } catch {
      completed = false;
    }
    const finished = await finishSignupResendAttempt(
      token,
      reserved.rowVersion,
      completed ? 'completed' : 'uncertain',
    );
    if (!completed || !finished.ok) return json({ error: 'unavailable' }, 503);
    return json({ rowVersion: finished.rowVersion });
  } catch {
    return json({ error: 'unavailable' }, 503);
  }
}
