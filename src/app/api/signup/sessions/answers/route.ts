/**
 * POST /api/signup/sessions/answers — as QUATRO perguntas (ADR-060 §1.c.1).
 *
 * Passo 1 do cadastro autônomo. Superfície PÚBLICA: quem responde ainda não tem
 * conta. O que identifica a sessão é o cookie `__Host-qoro_signup`, nunca um id
 * no corpo — um id no corpo seria adulterável e transformaria isto num jeito de
 * escrever na sessão de outra pessoa.
 *
 * NÃO coleta PII. As quatro respostas são sobre a CLÍNICA, todas de marcar, e o
 * banco recusa qualquer valor fora das listas (CHECK da migration 0098). É o que
 * permite este passo vir ANTES do consentimento.
 */
import { NextResponse } from 'next/server';

import { recordSignupAnswers, signupAnswersSchema } from '@/contexts/onboarding';
import { assertSignupReadAllowed, getClientIp } from '@/lib/auth/rate-limit';

import { SIGNUP_COOKIE_CLEAR_OPTIONS, SIGNUP_SESSION_COOKIE } from '../../cookie';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Teto de corpo. Quatro enums e um inteiro não chegam perto disto. */
const MAX_BODY_BYTES = 1024;

/** Mesma resposta de `GET /me` para toda causa de "não há sessão utilizável". */
function gone(): NextResponse {
  const res = NextResponse.json({ error: 'gone' }, { status: 410 });
  res.cookies.set(SIGNUP_SESSION_COOKIE, '', SIGNUP_COOKIE_CLEAR_OPTIONS);
  return res;
}

function readCookie(req: Request): string | null {
  const raw = req.headers
    .get('cookie')
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SIGNUP_SESSION_COOKIE}=`));
  if (!raw) return null;
  const token = decodeURIComponent(raw.slice(SIGNUP_SESSION_COOKIE.length + 1));
  return token || null;
}

export async function POST(req: Request): Promise<Response> {
  // Limite ANTES de tocar no banco. Reusa o limiter de LEITURA da sessão, e não
  // o de criação: este endpoint não abre sessão nenhuma, então cobrá-lo do balde
  // de abertura faria responder as perguntas consumir o orçamento de quem ainda
  // nem começou.
  const limit = await assertSignupReadAllowed(getClientIp(req.headers));
  if (!limit.ok) {
    return NextResponse.json(
      { error: 'rate_limited' },
      { status: 429, headers: { 'Retry-After': '60' } },
    );
  }

  const declared = Number(req.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'body_too_large' }, { status: 413 });
  }

  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'body_too_large' }, { status: 413 });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  const check = signupAnswersSchema.safeParse(parsed);
  if (!check.success) {
    // Sem detalhe do Zod na resposta: as opções são fechadas e conhecidas pela
    // tela, então quem manda valor inválido não é a tela — é quem está sondando.
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  const token = readCookie(req);
  if (!token) return gone();

  const result = await recordSignupAnswers(token, check.data);

  if (!result.ok) {
    // 409 e 410 dizem coisas diferentes ao cliente, e a distinção é o que o faz
    // agir certo: em `conflict` ele relê a sessão e reenvia; em `gone` não há o
    // que reenviar — a sessão morreu.
    if (result.reason === 'conflict') {
      return NextResponse.json({ error: 'conflict' }, { status: 409 });
    }
    return gone();
  }

  return NextResponse.json({ rowVersion: result.rowVersion }, { status: 200 });
}
