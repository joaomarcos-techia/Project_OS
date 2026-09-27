/**
 * GET /api/signup/sessions/me — estado sanitizado da PRÓPRIA sessão (ADR-060, O-2a).
 *
 * Existe para a página sobreviver a refresh e a múltiplas abas sem reabrir
 * sessão: o cookie já identifica qual é, e o servidor devolve em que pé ela
 * está. A leitura RENOVA o prazo de inatividade (§21.6) — é o que caracteriza
 * "atividade".
 *
 * `410` genérico para cookie ausente, token desconhecido, sessão vencida ou
 * bloqueada. A resposta é a MESMA nos quatro casos de propósito: distinguir
 * "não existe" de "existiu e venceu" contaria a um atacante se um token já foi
 * válido.
 */
import { NextResponse } from 'next/server';

import { readSignupSession } from '@/contexts/onboarding';
import { assertSignupReadAllowed, getClientIp } from '@/lib/auth/rate-limit';

import { readSignupCookie, SIGNUP_COOKIE_CLEAR_OPTIONS, SIGNUP_SESSION_COOKIE } from '../../cookie';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Resposta única para todos os casos de "não há sessão utilizável". */
function gone(): NextResponse {
  const res = NextResponse.json({ error: 'gone' }, { status: 410 });
  // Limpa o cookie morto: sem isso o navegador reenviaria o mesmo token a cada
  // carga, gerando busca inútil no banco e ruído no rate limit do próprio dono.
  res.cookies.set(SIGNUP_SESSION_COOKIE, '', SIGNUP_COOKIE_CLEAR_OPTIONS);
  return res;
}

export async function GET(req: Request): Promise<Response> {
  // Limite ANTES de tocar no banco: a leitura renova o TTL, então ela escreve.
  const limit = await assertSignupReadAllowed(getClientIp(req.headers));
  if (!limit.ok) {
    return NextResponse.json(
      { error: 'rate_limited' },
      { status: 429, headers: { 'Retry-After': '60' } },
    );
  }

  const rawToken = readSignupCookie(req);
  if (!rawToken) return gone();

  const state = await readSignupSession(rawToken);
  if (!state) return gone();

  return NextResponse.json({ session: state }, { status: 200 });
}
