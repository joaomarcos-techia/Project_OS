import { NextResponse } from 'next/server';

import {
  abortSignupAuthAttempt,
  finishSignupAuthAttempt,
  hashSignupToken,
  readReservedSignupAttemptEpoch,
  reserveSignupAuthAttempt,
  sendSignupConfirmation,
  signupAuthSchema,
} from '@/contexts/onboarding';
import { hashEmail } from '@/lib/auth/email-hash';
import { assertSignupAuthAllowed, getClientIp } from '@/lib/auth/rate-limit';
import { settleSignupAccountResponse } from '@/lib/auth/signup-response-timing';
import { env } from '@/lib/env';
import { resolveTrustedApplicationOrigin } from '@/lib/http/application-url';
import { readWebhookBodyCapped } from '@/lib/http/webhook-body';

import { readSignupCookie, SIGNUP_COOKIE_CLEAR_OPTIONS, SIGNUP_SESSION_COOKIE } from '../../cookie';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const MAX_AUTH_BODY_BYTES = 16_384;

function json(
  body: { error: string; rowVersion?: number } | { rowVersion: number },
  status = 200,
): NextResponse {
  const response = NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
  if ('error' in body && body.error === 'gone') {
    response.cookies.set(SIGNUP_SESSION_COOKIE, '', SIGNUP_COOKIE_CLEAR_OPTIONS);
  }
  return response;
}

export async function POST(req: Request): Promise<Response> {
  let accountOperationStartedAt: number | undefined;
  if (!env.SIGNUP_AUTH_ENABLED || !env.SIGNUP_IDENTITY_ENABLED)
    return json({ error: 'unavailable' }, 503);
  const publicOrigin = resolveTrustedApplicationOrigin(req);
  if (publicOrigin === undefined) return json({ error: 'unavailable' }, 503);
  if (publicOrigin === null) return json({ error: 'blocked' }, 403);
  const token = readSignupCookie(req);
  if (!token || !/^[A-Za-z0-9_-]{43}$/u.test(token)) return json({ error: 'gone' }, 410);
  try {
    const raw = await readWebhookBodyCapped(req, MAX_AUTH_BODY_BYTES);
    if (raw === null) return json({ error: 'body_too_large' }, 413);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return json({ error: 'invalid_body' }, 400);
    }
    const check = signupAuthSchema.safeParse(parsed);
    if (!check.success) return json({ error: 'invalid_body' }, 400);
    const { email, password } = check.data;
    const limit = await assertSignupAuthAllowed(
      getClientIp(req.headers),
      hashSignupToken(token),
      hashEmail(email),
    );
    if (!limit.ok) {
      const response = json({ error: limit.reason }, limit.reason === 'rate_limited' ? 429 : 503);
      if (limit.reason === 'rate_limited')
        response.headers.set('Retry-After', String(limit.retryAfter));
      return response;
    }
    const reserved = await reserveSignupAuthAttempt(token, check.data);
    if (!reserved.ok)
      return json(
        { error: reserved.reason },
        reserved.reason === 'gone' ? 410 : reserved.reason === 'conflict' ? 409 : 503,
      );
    const attemptEpoch = await readReservedSignupAttemptEpoch(
      token,
      reserved.rowVersion,
      'initial',
    );
    if (attemptEpoch === null) {
      await abortSignupAuthAttempt(token, reserved.rowVersion);
      return json({ error: 'unavailable' }, 503);
    }
    // O e-mail de confirmação é NOSSO desde 22/09/2026: `generate_link` devolve
    // só o token, e o Resend entrega o template do repositório. Ver o porquê em
    // `internal/signup-confirmation-email.ts` — em resumo, o template do painel
    // do Supabase é configuração manual por projeto que nenhum teste enxerga, e
    // já quebrou este fluxo duas vezes.
    //
    // O desafio adaptativo continua na criação da sessão anônima. Esta rota não
    // aceita um `captchaToken` fictício: a Admin API não o valida e o contrato
    // estrito rejeita campos sem efeito.
    // O `catch` não é redundante com o try externo: uma exceção que chegasse lá
    // devolveria 503 SEM finalizar a reserva, e a linha ficaria em `reserved`
    // sem nunca registrar o desfecho. A regra antiga já era essa quando o
    // `signUp` tinha try/catch próprio; ela continua valendo.
    accountOperationStartedAt = Date.now();
    const outcome = await sendSignupConfirmation({
      email,
      ...(password === undefined ? {} : { password }),
      signupRef: hashSignupToken(token),
      attemptEpoch,
      publicOrigin,
    }).catch(() => ({ kind: 'uncertain' }) as const);
    const retryable = outcome.kind === 'weak_password' || outcome.kind === 'retryable';
    // `obfuscated` conta como concluído de propósito: é o desfecho que depende
    // da conta existir, e a resposta pública precisa ser idêntica à do envio.
    const completed = outcome.kind === 'sent' || outcome.kind === 'obfuscated';

    // Senha recusada é o único desfecho em que o provider prova que não enviou
    // nada. Devolver a reserva deixa a pessoa tentar outra senha na hora, em vez
    // de gastar a tentativa e cair no cooldown de reenvio. Se o CAS de devolução
    // perder, a linha continua reservada e o caminho conservador vale: 503, sem
    // afirmar envio. Nenhum detalhe do provider atravessa a resposta.
    if (retryable) {
      const aborted = await abortSignupAuthAttempt(token, reserved.rowVersion);
      await settleSignupAccountResponse(accountOperationStartedAt);
      if (!aborted.ok) return json({ error: 'unavailable' }, 503);
      return outcome.kind === 'weak_password'
        ? json({ error: 'weak_password', rowVersion: aborted.rowVersion }, 422)
        : json({ error: 'unavailable' }, 503);
    }

    const finished = await finishSignupAuthAttempt(
      token,
      reserved.rowVersion,
      completed ? 'completed' : 'uncertain',
    );
    await settleSignupAccountResponse(accountOperationStartedAt);
    // Depois que a operacao de conta comecou, `sent`, `obfuscated` e
    // `uncertain` precisam ter a mesma resposta publica. Em especial, uma
    // indisponibilidade do GoTrue/Resend nao pode transformar "conta nova" em
    // 503 enquanto uma conta existente continua respondendo 200. O estado
    // `uncertain` permanece gravado e libera somente o reenvio explicito apos
    // o cooldown; a resposta nao afirma que a mensagem foi entregue.
    if (!finished.ok) return json({ error: 'unavailable' }, 503);
    return json({ rowVersion: finished.rowVersion });
  } catch {
    if (accountOperationStartedAt !== undefined) {
      await settleSignupAccountResponse(accountOperationStartedAt);
    }
    return json({ error: 'unavailable' }, 503);
  }
}
