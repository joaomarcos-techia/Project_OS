import { NextResponse } from 'next/server';
import { z } from 'zod';
import { PilotSignupError, provisionPilotSignup, hashSignupToken } from '@/contexts/onboarding';
import { resolveTrustedApplicationOrigin } from '@/lib/http/application-url';
import { readWebhookBodyCapped } from '@/lib/http/webhook-body';
import { assertSignupDraftWriteAllowed, getClientIp } from '@/lib/auth/rate-limit';
import { metrics } from '@/lib/observability/metrics';
import { env } from '@/lib/env';
import { readPilotCookie } from '../cookie';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
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
  const token = readPilotCookie(req);
  if (!token) return json({ error: 'forbidden' }, 403);
  try {
    const limit = await assertSignupDraftWriteAllowed(
      getClientIp(req.headers),
      hashSignupToken(token),
    );
    if (!limit.ok)
      return json({ error: limit.reason }, limit.reason === 'rate_limited' ? 429 : 503);
    const raw = await readWebhookBodyCapped(req, 256);
    if (raw === null) return json({ error: 'body_too_large' }, 413);
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return json({ error: 'invalid_body' }, 400);
    }
    if (!z.object({}).strict().safeParse(body).success) return json({ error: 'invalid_body' }, 400);
    return json(await provisionPilotSignup(token));
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
    metrics.emit('signup.pilot.failed', { stage: 'provision', code: 'unexpected' });
    return json({ error: 'unavailable' }, 503);
  }
}
