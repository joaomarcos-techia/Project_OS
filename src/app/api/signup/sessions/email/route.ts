import { NextResponse } from 'next/server';
import {
  correctSignupEmail,
  hashSignupToken,
  signupEmailCorrectionSchema,
} from '@/contexts/onboarding';
import { assertSignupIdentityAllowed, getClientIp } from '@/lib/auth/rate-limit';
import { env } from '@/lib/env';
import { resolveTrustedApplicationOrigin } from '@/lib/http/application-url';
import { readWebhookBodyCapped } from '@/lib/http/webhook-body';
import { readSignupCookie } from '../../cookie';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const MAX_BODY_BYTES = 4096;

export async function POST(request: Request): Promise<Response> {
  const json = (body: object, status = 200) =>
    NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store, private' } });
  if (!env.SIGNUP_AUTH_ENABLED || !env.SIGNUP_IDENTITY_ENABLED)
    return json({ error: 'unavailable' }, 503);
  const origin = resolveTrustedApplicationOrigin(request);
  if (origin === undefined) return json({ error: 'unavailable' }, 503);
  if (
    origin === null ||
    request.headers.get('origin') !== origin ||
    (request.headers.has('sec-fetch-site') &&
      request.headers.get('sec-fetch-site') !== 'same-origin')
  )
    return json({ error: 'blocked' }, 403);
  const token = readSignupCookie(request);
  if (!token || !/^[A-Za-z0-9_-]{43}$/u.test(token)) return json({ error: 'gone' }, 410);
  try {
    const limit = await assertSignupIdentityAllowed(
      getClientIp(request.headers),
      hashSignupToken(token),
    );
    if (!limit.ok) {
      const response = json({ error: limit.reason }, limit.reason === 'unavailable' ? 503 : 429);
      if (limit.reason !== 'unavailable')
        response.headers.set('Retry-After', String(limit.retryAfter));
      return response;
    }
    const raw = await readWebhookBodyCapped(request, MAX_BODY_BYTES);
    if (raw === null) return json({ error: 'body_too_large' }, 413);
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      return json({ error: 'invalid' }, 400);
    }
    const parsed = signupEmailCorrectionSchema.safeParse(value);
    if (!parsed.success) return json({ error: 'invalid' }, 400);
    const result = await correctSignupEmail(token, parsed.data);
    if (!result.ok)
      return json(
        { error: result.reason },
        result.reason === 'gone' ? 410 : result.reason === 'conflict' ? 409 : 503,
      );
    return json({ rowVersion: result.rowVersion });
  } catch {
    return json({ error: 'unavailable' }, 503);
  }
}
