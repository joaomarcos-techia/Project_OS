/**
 * POST /api/signup/checkout/cancel — encerra um Checkout antes de liberar retry.
 *
 * O parâmetro informa apenas qual tela de retorno foi exibida. Ele nunca decide
 * o estado financeiro: a orquestração relê o Asaas, cancela o Checkout pendente
 * e usa CAS para impedir que um retorno antigo apague uma assinatura concluída.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';

import {
  abandonSignupHostedCheckout,
  resolveReadyOwnedSignupOnboarding,
} from '@/contexts/onboarding';
import { assertSignupDraftWriteAllowed, getClientIp } from '@/lib/auth/rate-limit';
import { hashSignupUserId } from '@/lib/auth/signup-user-hash';
import { env } from '@/lib/env';
import { isSameOriginMutationRequest } from '@/lib/http/same-origin';
import { readWebhookBodyCapped } from '@/lib/http/webhook-body';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 256;
const bodySchema = z
  .object({
    reason: z.enum(['cancelled', 'expired']),
  })
  .strict();

function json(body: object, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req: Request): Promise<Response> {
  if (!env.SIGNUP_AUTH_ENABLED || !env.SIGNUP_IDENTITY_ENABLED) {
    return json({ error: 'unavailable' }, 503);
  }
  if (!isSameOriginMutationRequest(req)) return json({ error: 'blocked' }, 403);

  try {
    const onboarding = await resolveReadyOwnedSignupOnboarding();
    if (!onboarding.ok) {
      return json(
        { error: onboarding.reason === 'unavailable' ? 'unavailable' : 'unauthorized' },
        onboarding.reason === 'unavailable' ? 503 : 401,
      );
    }
    if (onboarding.kind === 'redirect') return json({ state: 'already_completed' });

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

    const raw = await readWebhookBodyCapped(req, MAX_BODY_BYTES);
    if (raw === null) return json({ error: 'body_too_large' }, 413);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return json({ error: 'invalid_body' }, 400);
    }
    const body = bodySchema.safeParse(parsed);
    if (!body.success) return json({ error: 'invalid_body' }, 400);

    const abandoned = await abandonSignupHostedCheckout({
      userId: onboarding.userId,
      reason: body.data.reason,
    });
    if (abandoned.ok) return json({ state: abandoned.state });
    if (abandoned.reason === 'gone') return json({ error: 'gone' }, 410);
    if (abandoned.reason === 'conflict') return json({ error: 'conflict' }, 409);
    return json({ error: 'unavailable' }, 503);
  } catch {
    return json({ error: 'unavailable' }, 503);
  }
}
