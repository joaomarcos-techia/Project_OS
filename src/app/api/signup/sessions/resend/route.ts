import { NextResponse } from 'next/server';

import {
  abortSignupResendAttempt,
  finishSignupResendAttempt,
  hashSignupToken,
  readReservedSignupAttemptEpoch,
  resendSignupConfirmation,
  reserveSignupResendAttempt,
  signupResendSchema,
} from '@/contexts/onboarding';
import { hashEmail } from '@/lib/auth/email-hash';
import { assertSignupResendAllowed, getClientIp } from '@/lib/auth/rate-limit';
import { settleSignupAccountResponse } from '@/lib/auth/signup-response-timing';
import { env } from '@/lib/env';
import { resolveTrustedApplicationOrigin } from '@/lib/http/application-url';
import { readWebhookBodyCapped } from '@/lib/http/webhook-body';

import { readSignupCookie, SIGNUP_COOKIE_CLEAR_OPTIONS, SIGNUP_SESSION_COOKIE } from '../../cookie';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const MAX_RESEND_BODY_BYTES = 16_384;

function json(body: { error: string } | { rowVersion: number }, status = 200): NextResponse {
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
    const raw = await readWebhookBodyCapped(req, MAX_RESEND_BODY_BYTES);
    if (raw === null) return json({ error: 'body_too_large' }, 413);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return json({ error: 'invalid_body' }, 400);
    }
    const check = signupResendSchema.safeParse(parsed);
    if (!check.success) return json({ error: 'invalid_body' }, 400);
    const { email } = check.data;
    const limit = await assertSignupResendAllowed(
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

    const reserved = await reserveSignupResendAttempt(token, check.data);
    if (!reserved.ok) {
      const response = json(
        { error: reserved.reason },
        reserved.reason === 'gone'
          ? 410
          : reserved.reason === 'conflict'
            ? 409
            : reserved.reason === 'cooldown'
              ? 429
              : 503,
      );
      if (reserved.reason === 'cooldown')
        response.headers.set('Retry-After', String(reserved.retryAfter));
      return response;
    }
    const attemptEpoch = await readReservedSignupAttemptEpoch(token, reserved.rowVersion, 'resend');
    if (attemptEpoch === null) {
      await abortSignupResendAttempt(token, reserved.rowVersion);
      return json({ error: 'unavailable' }, 503);
    }

    // Mesmo caminho do primeiro envio, e pelo mesmo motivo (ver a rota `auth`):
    // o token vem do `generate_link` e o e-mail sai pelo Resend com o template
    // do repositório. Aqui o tipo é `recovery`: ele não recebe senha nem cria
    // usuário implicitamente. Se a criação inicial teve resultado incerto e a
    // busca exata prova que o usuário não existe, o módulo pode recriá-lo de
    // forma explícita, ainda passwordless e preso à reserva deste draft.
    // Mesmo motivo da rota irmã: uma exceção não pode escapar sem finalizar a
    // reserva, senão a linha fica em `reserved` sem desfecho registrado.
    accountOperationStartedAt = Date.now();
    const outcome = await resendSignupConfirmation({
      email,
      signupRef: hashSignupToken(token),
      attemptEpoch,
      publicOrigin,
    }).catch(() => ({ kind: 'uncertain' }) as const);
    // `obfuscated` (por exemplo, conta já confirmada ou vínculo incompatível) responde como sucesso:
    // distinguir contaria a um terceiro o estado daquele endereço.
    const completed = outcome.kind === 'sent' || outcome.kind === 'obfuscated';
    const finished = await finishSignupResendAttempt(
      token,
      reserved.rowVersion,
      completed ? 'completed' : 'uncertain',
    );
    await settleSignupAccountResponse(accountOperationStartedAt);
    // A resposta publica nao revela se o endereco tinha conta nem se o
    // provedor ficou indisponivel. `uncertain` segue persistido para impedir
    // repeticao automatica e permitir somente um reenvio explicito posterior.
    if (!finished.ok) return json({ error: 'unavailable' }, 503);
    return json({ rowVersion: finished.rowVersion });
  } catch {
    if (accountOperationStartedAt !== undefined) {
      await settleSignupAccountResponse(accountOperationStartedAt);
    }
    return json({ error: 'unavailable' }, 503);
  }
}
