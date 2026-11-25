import { NextResponse } from 'next/server';

import { assertSignupReadAllowed, getClientIp } from '@/lib/auth/rate-limit';
import { env } from '@/lib/env';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Antiga fonte do endereço da etapa do código, aposentada em novembro/2026.
 *
 * Ela devolvia o e-mail (200) só quando o cadastro tinha criado ou reaproveitado
 * uma conta pendente; para um endereço que já tinha conta, o cadastro é ofuscado
 * e não há vínculo, então a resposta era 410. A diferença dizia a quem pediu o
 * cadastro que aquele e-mail estava cadastrado (ADR-062 §6). A tela agora lembra
 * o endereço na própria aba, e esta rota responde igual para todos, sem ler
 * cookie de cadastro nem conta.
 */
export async function GET(request: Request): Promise<Response> {
  const json = (body: object, status: number) =>
    NextResponse.json(body, {
      status,
      headers: { 'Cache-Control': 'no-store, private', 'Referrer-Policy': 'no-referrer' },
    });
  if (!env.SIGNUP_AUTH_ENABLED || !env.SIGNUP_IDENTITY_ENABLED)
    return json({ error: 'unavailable' }, 503);
  if (request.headers.get('sec-fetch-site') !== 'same-origin')
    return json({ error: 'blocked' }, 403);
  const limit = await assertSignupReadAllowed(getClientIp(request.headers));
  if (!limit.ok) return json({ error: 'rate_limited' }, 429);
  return json({ error: 'gone' }, 410);
}
