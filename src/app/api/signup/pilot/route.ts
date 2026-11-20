import { NextResponse } from 'next/server';
import { z } from 'zod';

import { bootstrapPilotSignup, PilotSignupError, PILOT_INVITE_COOKIE } from '@/contexts/onboarding';
import { assertSignupReadAllowed, getClientIp } from '@/lib/auth/rate-limit';
import { metrics } from '@/lib/observability/metrics';
import { env } from '@/lib/env';
import { resolveTrustedApplicationOrigin } from '@/lib/http/application-url';
import { readWebhookBodyCapped } from '@/lib/http/webhook-body';
import { readSignupCookie, SIGNUP_COOKIE_OPTIONS, SIGNUP_SESSION_COOKIE } from '../cookie';
import { readPilotCookie } from './cookie';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const bodySchema = z
  .object({
    inviteToken: z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .optional(),
    turnstileToken: z.string().max(4096).optional(),
  })
  .strict();
export async function POST(req: Request) {
  const json = (body: object, status = 200) =>
    NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store, private' } });
  if (env.ABACATEPAY_PILOT_PROVISIONING_ENABLED !== true)
    return json({ error: 'unavailable' }, 503);
  const origin = resolveTrustedApplicationOrigin(req);
  if (
    !origin ||
    req.headers.get('origin') !== origin ||
    (req.headers.has('sec-fetch-site') && req.headers.get('sec-fetch-site') !== 'same-origin')
  )
    return json({ error: 'blocked' }, 403);
  try {
    if (!(await assertSignupReadAllowed(getClientIp(req.headers))).ok)
      return json({ error: 'rate_limited' }, 429);
    const raw = await readWebhookBodyCapped(req, 8192);
    if (raw === null) return json({ error: 'body_too_large' }, 413);
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return json({ error: 'invalid_body' }, 400);
    }
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) return json({ error: 'invalid_body' }, 400);
    const inviteToken = parsed.data.inviteToken ?? readPilotCookie(req);
    if (!inviteToken) return json({ error: 'forbidden' }, 403);
    const result = await bootstrapPilotSignup({
      inviteToken,
      existingSession: readSignupCookie(req),
      request: {
        ip: getClientIp(req.headers),
        origin,
        expectedHost: new URL(origin).host,
        ...(parsed.data.turnstileToken ? { turnstileToken: parsed.data.turnstileToken } : {}),
      },
    });
    if (!result.ok)
      return json(
        { error: result.reason },
        result.reason === 'challenge_required'
          ? 401
          : result.reason === 'blocked'
            ? 403
            : result.reason === 'rate_limited'
              ? 429
              : 503,
      );
    const response = json(
      { session: result.state, identity: result.identity, resumed: result.resumed },
      201,
    );
    response.cookies.set(SIGNUP_SESSION_COOKIE, result.rawToken, SIGNUP_COOKIE_OPTIONS);
    response.cookies.set(PILOT_INVITE_COOKIE, inviteToken, SIGNUP_COOKIE_OPTIONS);
    return response;
  } catch (error) {
    if (error instanceof PilotSignupError)
      return json(
        { error: error.code },
        error.code === 'expired'
          ? 410
          : error.code === 'conflict'
            ? 409
            : error.code === 'forbidden'
              ? 403
              : 503,
      );
    metrics.emit('signup.pilot.failed', { stage: 'bootstrap', code: 'unexpected' });
    return json({ error: 'unavailable' }, 503);
  }
}
