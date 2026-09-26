/**
 * POST /api/signup/checkout/status — confirma o retorno sem confiar no browser.
 *
 * A rota consulta a assinatura no Asaas e só responde `provisioned` depois que
 * status, customer, valor, ciclo e forma de pagamento conferem com o catálogo.
 */
import { NextResponse } from 'next/server';

import {
  completeSignupHostedCheckout,
  resolveReadyOwnedSignupOnboarding,
} from '@/contexts/onboarding';
import { assertSignupDraftWriteAllowed, getClientIp } from '@/lib/auth/rate-limit';
import { hashSignupUserId } from '@/lib/auth/signup-user-hash';
import { env } from '@/lib/env';
import { buildApplicationUrl } from '@/lib/http/application-url';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function json(body: object, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

function expectedOrigin(): string | null {
  try {
    return new URL(
      buildApplicationUrl(env.APP_BASE_URL ?? '', '/', {
        allowInsecureLocalhost: env.NODE_ENV !== 'production',
      }),
    ).origin;
  } catch {
    return null;
  }
}

export async function POST(req: Request): Promise<Response> {
  if (!env.SIGNUP_AUTH_ENABLED || !env.SIGNUP_IDENTITY_ENABLED) {
    return json({ error: 'unavailable' }, 503);
  }
  const origin = expectedOrigin();
  if (
    !origin ||
    req.headers.get('origin') !== origin ||
    req.headers.get('sec-fetch-site') === 'cross-site'
  ) {
    return json({ error: 'blocked' }, 403);
  }

  try {
    const onboarding = await resolveReadyOwnedSignupOnboarding();
    if (!onboarding.ok) {
      return json(
        { error: onboarding.reason === 'unavailable' ? 'unavailable' : 'unauthorized' },
        onboarding.reason === 'unavailable' ? 503 : 401,
      );
    }
    if (onboarding.kind === 'redirect') return json({ state: 'provisioned' });

    const limit = await assertSignupDraftWriteAllowed(
      getClientIp(req.headers),
      hashSignupUserId(onboarding.userId),
    );
    if (!limit.ok) {
      const response = json({ error: limit.reason }, limit.reason === 'rate_limited' ? 429 : 503);
      if (limit.reason === 'rate_limited') {
        response.headers.set('Retry-After', String('retryAfter' in limit ? limit.retryAfter : 1));
      }
      return response;
    }

    const completed = await completeSignupHostedCheckout({
      userId: onboarding.userId,
      verifiedEmail: onboarding.email,
    });
    if (completed.ok) {
      return json({ state: completed.state }, completed.state === 'pending' ? 202 : 200);
    }
    if (completed.reason === 'gone') return json({ error: 'gone' }, 410);
    if (completed.reason === 'conflict') return json({ error: 'conflict' }, 409);
    return json({ error: 'unavailable' }, 503);
  } catch {
    return json({ error: 'unavailable' }, 503);
  }
}
