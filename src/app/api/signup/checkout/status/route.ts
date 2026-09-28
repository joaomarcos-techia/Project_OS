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
import { assertSignupDraftReadAllowed, getClientIp } from '@/lib/auth/rate-limit';
import { hashSignupUserId } from '@/lib/auth/signup-user-hash';
import { env } from '@/lib/env';
import { isSameOriginMutationRequest } from '@/lib/http/same-origin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
    if (onboarding.kind === 'redirect') return json({ state: 'provisioned' });

    // O retorno faz polling. Consumir aqui o orçamento de escrita (5/15 min)
    // fazia plano + criação do Checkout + três leituras esgotarem a janela antes
    // de o Asaas materializar a assinatura. O readback continua autenticado e
    // rate-limited, mas usa o orçamento próprio de leitura (60/15 min por usuário).
    const limit = await assertSignupDraftReadAllowed(
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
      if (completed.state === 'expired') return json({ error: 'expired' }, 409);
      return json({ state: completed.state }, completed.state === 'pending' ? 202 : 200);
    }
    if (completed.reason === 'gone') return json({ error: 'gone' }, 410);
    if (completed.reason === 'conflict') return json({ error: 'conflict' }, 409);
    return json({ error: 'unavailable' }, 503);
  } catch {
    return json({ error: 'unavailable' }, 503);
  }
}
