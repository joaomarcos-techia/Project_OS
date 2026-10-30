import { randomUUID } from 'node:crypto';

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { verifySignupTurnstileProbe } from '@/contexts/onboarding';
import { assertSignupSessionAllowed, getClientIp } from '@/lib/auth/rate-limit';
import { env } from '@/lib/env';
import { resolveTrustedApplicationOrigin } from '@/lib/http/application-url';
import { readWebhookBodyCapped } from '@/lib/http/webhook-body';
import { metrics } from '@/lib/observability/metrics';
import { isSignupReleaseCheckAvailable } from '@/lib/security/signup-release-check';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 16 * 1024;
const bodySchema = z.object({ turnstileToken: z.string().min(1).max(2048) }).strict();

function json(body: unknown, status: number): Response {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

/** Temporary, same-origin, rate-limited proof. Does not open signup or write app data. */
export async function POST(request: Request): Promise<Response> {
  if (!isSignupReleaseCheckAvailable(env.SIGNUP_ENABLED)) {
    return json({ error: 'not_found' }, 404);
  }
  const origin = resolveTrustedApplicationOrigin(request);
  if (origin === undefined) return json({ error: 'unavailable' }, 503);
  if (origin === null) return json({ error: 'forbidden' }, 403);

  const ip = getClientIp(request.headers);
  const limit = await assertSignupSessionAllowed(ip);
  if (!limit.allowed) return json({ error: 'rate_limited' }, 429);

  const declared = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return json({ error: 'body_too_large' }, 413);
  }
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return json({ error: 'invalid_body' }, 400);
  }
  const raw = await readWebhookBodyCapped(request, MAX_BODY_BYTES);
  if (raw === null) return json({ error: 'body_too_large' }, 413);
  let input: unknown;
  try {
    input = JSON.parse(raw);
  } catch {
    return json({ error: 'invalid_body' }, 400);
  }
  const body = bodySchema.safeParse(input);
  if (!body.success) return json({ error: 'invalid_body' }, 400);

  const result = await verifySignupTurnstileProbe(
    body.data.turnstileToken,
    ip,
    new URL(origin).hostname,
  );
  if (!result.ok) {
    return json(
      { error: result.reason === 'invalid' ? 'challenge_failed' : 'unavailable' },
      result.reason === 'invalid' ? 400 : 503,
    );
  }

  const runId = randomUUID();
  metrics.emit('signup.turnstile.probe.passed', { run_id: runId });
  return json(
    { ok: true, runId, accepted: true, replayRejected: true, invalidRejected: true },
    200,
  );
}
