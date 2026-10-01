import { NextResponse } from 'next/server';

import {
  readSignupPlan,
  resolveReadyOwnedSignupOnboarding,
  signupPlanMutationSchema,
  writeSignupPlan,
} from '@/contexts/onboarding';
import {
  assertSignupDraftReadAllowed,
  assertSignupDraftWriteAllowed,
  getClientIp,
} from '@/lib/auth/rate-limit';
import { hashSignupUserId } from '@/lib/auth/signup-user-hash';
import { env } from '@/lib/env';
import { resolveTrustedApplicationOrigin } from '@/lib/http/application-url';
import { readWebhookBodyCapped } from '@/lib/http/webhook-body';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const MAX_PLAN_BODY_BYTES = 1_024;

function json(body: object, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

function authFailure(reason: string): NextResponse {
  if (
    reason === 'profile_denied' ||
    reason === 'credentials_pending' ||
    reason === 'credentials_invalid'
  ) {
    return json({ error: 'forbidden' }, 403);
  }
  if (reason === 'unavailable') return json({ error: 'unavailable' }, 503);
  return json({ error: 'unauthorized' }, 401);
}

async function readyPreTenant(): Promise<
  { ok: true; userId: string } | { ok: false; response: NextResponse }
> {
  const onboarding = await resolveReadyOwnedSignupOnboarding();
  if (!onboarding.ok) return { ok: false, response: authFailure(onboarding.reason) };
  if (onboarding.kind !== 'pretenant') {
    return { ok: false, response: json({ error: 'forbidden' }, 403) };
  }
  return { ok: true, userId: onboarding.userId };
}

function limited(reason: 'unavailable' | 'rate_limited', retryAfter?: number): NextResponse {
  const response = json({ error: reason }, reason === 'rate_limited' ? 429 : 503);
  if (reason === 'rate_limited') response.headers.set('Retry-After', String(retryAfter ?? 1));
  return response;
}

export async function GET(req: Request): Promise<Response> {
  if (!env.SIGNUP_AUTH_ENABLED || !env.SIGNUP_IDENTITY_ENABLED)
    return json({ error: 'unavailable' }, 503);
  try {
    const identity = await readyPreTenant();
    if (!identity.ok) return identity.response;
    const limit = await assertSignupDraftReadAllowed(
      getClientIp(req.headers),
      hashSignupUserId(identity.userId),
    );
    if (!limit.ok)
      return limited(limit.reason, 'retryAfter' in limit ? limit.retryAfter : undefined);

    const result = await readSignupPlan(identity.userId);
    if (!result.ok) {
      return json({ error: result.reason }, result.reason === 'gone' ? 410 : 503);
    }
    return json(result.state);
  } catch {
    return json({ error: 'unavailable' }, 503);
  }
}

export async function PUT(req: Request): Promise<Response> {
  if (!env.SIGNUP_AUTH_ENABLED || !env.SIGNUP_IDENTITY_ENABLED)
    return json({ error: 'unavailable' }, 503);
  const publicOrigin = resolveTrustedApplicationOrigin(req);
  if (publicOrigin === undefined) return json({ error: 'unavailable' }, 503);
  if (publicOrigin === null) return json({ error: 'blocked' }, 403);

  try {
    const identity = await readyPreTenant();
    if (!identity.ok) return identity.response;
    const limit = await assertSignupDraftWriteAllowed(
      getClientIp(req.headers),
      hashSignupUserId(identity.userId),
    );
    if (!limit.ok)
      return limited(limit.reason, 'retryAfter' in limit ? limit.retryAfter : undefined);

    const raw = await readWebhookBodyCapped(req, MAX_PLAN_BODY_BYTES);
    if (raw === null) return json({ error: 'body_too_large' }, 413);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return json({ error: 'invalid_body' }, 400);
    }
    const input = signupPlanMutationSchema.safeParse(parsed);
    if (!input.success) return json({ error: 'invalid_body' }, 400);

    const result = await writeSignupPlan(identity.userId, input.data);
    if (!result.ok) {
      const status =
        result.reason === 'gone'
          ? 410
          : result.reason === 'conflict'
            ? 409
            : result.reason === 'invalid_plan'
              ? 422
              : 503;
      return json({ error: result.reason }, status);
    }
    return json({ rowVersion: result.rowVersion, selectedPlanId: result.selectedPlanId });
  } catch {
    return json({ error: 'unavailable' }, 503);
  }
}
