/**
 * POST /api/signup/sessions — cria a sessão anônima de cadastro (ADR-060, O-2a).
 *
 * Superfície PÚBLICA e anônima: qualquer um na internet alcança. O que a protege
 * não é sessão — é o rate limit por IP e o teto de sessões vivas, os dois
 * aplicados DENTRO de `createSignupSession`, antes de qualquer escrita.
 *
 * O token cru sai UMA vez, só no cookie `__Host-qoro_signup`. Ele não vai no
 * corpo da resposta nem na URL (§21.6): corpo entra em log de cliente e em
 * ferramenta de captura; URL entra em histórico e em `Referer`.
 *
 * Esta fatia NÃO cria usuário, clínica, assinatura nem envia e-mail.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { createSignupSession } from '@/contexts/onboarding';
import { getClientIp } from '@/lib/auth/rate-limit';

import { SIGNUP_COOKIE_OPTIONS, SIGNUP_SESSION_COOKIE } from '../cookie';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Teto de corpo. §21.9 pede body pequeno; esta rota não recebe campo nenhum. */
const MAX_BODY_BYTES = 1024;

/**
 * `.strict()` sobre objeto VAZIO: a fatia O-2a não coleta nada. Campo extra é
 * rejeitado em vez de ignorado — ignorar ensina o cliente a mandar lixo e
 * esconde a divergência quando as fatias seguintes passarem a ler campos.
 */
const bodySchema = z.object({}).strict();

export async function POST(req: Request): Promise<Response> {
  const declared = Number(req.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'body_too_large' }, { status: 413 });
  }

  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'body_too_large' }, { status: 413 });
  }
  if (raw.trim().length > 0) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
    }
    if (!bodySchema.safeParse(parsed).success) {
      return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
    }
  }

  const result = await createSignupSession(getClientIp(req.headers));

  if (!result.ok) {
    // 429 e 503 são estados DIFERENTES para quem opera: o primeiro é "este
    // cliente pediu demais", o segundo é "o sistema todo está no teto". Colapsar
    // os dois num código só apagaria a distinção justamente no incidente em que
    // ela decide o que fazer.
    const status = result.reason === 'rate_limited' ? 429 : 503;
    return NextResponse.json(
      { error: result.reason },
      { status, headers: { 'Retry-After': '60' } },
    );
  }

  const res = NextResponse.json({ session: result.state }, { status: 201 });
  res.cookies.set(SIGNUP_SESSION_COOKIE, result.rawToken, SIGNUP_COOKIE_OPTIONS);
  return res;
}
