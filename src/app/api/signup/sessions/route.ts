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
import { env } from '@/lib/env';
import { readWebhookBodyCapped } from '@/lib/http/webhook-body';

import { SIGNUP_COOKIE_OPTIONS, SIGNUP_SESSION_COOKIE } from '../cookie';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Turnstile aceita até 2048 caracteres. 16 KiB comporta até 6 bytes por unidade
 * JSON escapada (\\uXXXX), mais o envelope, sem truncar o schema existente.
 * https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
 */
const MAX_BODY_BYTES = 16 * 1024;

/**
 * O único campo aceito é o token do desafio, e ele é OPCIONAL: a maioria das
 * requisições é de risco baixo e não precisa dele. `.strict()` recusa qualquer
 * outro campo em vez de ignorar — ignorar ensina o cliente a mandar lixo e
 * esconde a divergência quando as fatias seguintes passarem a ler campos.
 */
const bodySchema = z.object({ turnstileToken: z.string().min(1).max(2048).optional() }).strict();

/**
 * O sinal cross-site compara `Origin` com o destino efetivo desta requisição.
 * Uma origem canônica fixa recusaria todo Preview e todo alias legítimo cujo
 * hostname difere de `APP_BASE_URL`.
 */
function expectedHostOf(req: Request): string {
  return new URL(req.url).host;
}

export async function POST(req: Request): Promise<Response> {
  // Kill switch do §21.20, ANTES de ler corpo, gastar orçamento de limite ou
  // escrever linha: desligado, esta rota não é degrau de nada. Login, sessões
  // vivas e tenants existentes não passam por aqui e seguem intactos.
  if (!env.SIGNUP_ENABLED) return NextResponse.json({ error: 'unavailable' }, { status: 503 });

  const declared = Number(req.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'body_too_large' }, { status: 413 });
  }

  const raw = await readWebhookBodyCapped(req, MAX_BODY_BYTES);
  if (raw === null) {
    return NextResponse.json({ error: 'body_too_large' }, { status: 413 });
  }

  let turnstileToken: string | undefined;
  if (raw.trim().length > 0) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
    }
    const check = bodySchema.safeParse(parsed);
    if (!check.success) {
      return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
    }
    turnstileToken = check.data.turnstileToken;
  }

  /*
   * Falha de infraestrutura vira `503 unavailable`, não `500` opaco.
   *
   * Esta era a única rota do grupo sem essa rede: draft, plano e checkout já
   * envolviam o serviço. A diferença apareceu no Preview, onde uma janela
   * transitória devolveu `500` com **corpo vazio** — sem código de erro, sem
   * `Retry-After`, nada para o cliente decidir o que fazer. O cliente do funil
   * trata `503` como "tente de novo em instantes"; `500` ele não trata.
   *
   * Não engole o problema: o erro continua subindo para a observabilidade pelo
   * caminho normal do runtime, e a métrica de bloqueio/criação segue no serviço.
   */
  let result: Awaited<ReturnType<typeof createSignupSession>>;
  try {
    result = await createSignupSession({
      ip: getClientIp(req.headers),
      origin: req.headers.get('origin'),
      expectedHost: expectedHostOf(req),
      ...(turnstileToken ? { turnstileToken } : {}),
    });
  } catch {
    return NextResponse.json(
      { error: 'unavailable' },
      { status: 503, headers: { 'Retry-After': '60' } },
    );
  }

  if (!result.ok) {
    // Quatro desfechos, quatro códigos. Colapsar em um só apagaria a distinção
    // justamente no incidente em que ela decide o que fazer:
    //   429 este cliente pediu demais
    //   503 o sistema todo está no teto
    //   403 requisição recusada por risco alto (cross-site) — não há retry útil
    //   401 falta o desafio; resolver o Turnstile e repetir É o caminho
    const status =
      result.reason === 'rate_limited'
        ? 429
        : result.reason === 'at_capacity'
          ? 503
          : result.reason === 'blocked'
            ? 403
            : 401;
    const headers = status === 429 || status === 503 ? { 'Retry-After': '60' } : undefined;
    return NextResponse.json({ error: result.reason }, { status, ...(headers ? { headers } : {}) });
  }

  const res = NextResponse.json({ session: result.state }, { status: 201 });
  res.cookies.set(SIGNUP_SESSION_COOKIE, result.rawToken, SIGNUP_COOKIE_OPTIONS);
  return res;
}
