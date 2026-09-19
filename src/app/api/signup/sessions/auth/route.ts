import { NextResponse } from 'next/server';

import {
  abortSignupAuthAttempt,
  finishSignupAuthAttempt,
  hashSignupToken,
  reserveSignupAuthAttempt,
  signupAuthSchema,
} from '@/contexts/onboarding';
import { captchaOptions } from '@/lib/auth/captcha';
import { hashEmail } from '@/lib/auth/email-hash';
import { assertSignupAuthAllowed, getClientIp } from '@/lib/auth/rate-limit';
import { createServerClient } from '@/lib/auth/supabase-server';
import { env } from '@/lib/env';
import { buildApplicationUrl } from '@/lib/http/application-url';
import { readWebhookBodyCapped } from '@/lib/http/webhook-body';

import { readSignupCookie, SIGNUP_COOKIE_CLEAR_OPTIONS, SIGNUP_SESSION_COOKIE } from '../../cookie';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const MAX_AUTH_BODY_BYTES = 16_384;
/**
 * Recusas que DEPENDEM da conta. Todas recebem a mesma resposta pública, porque
 * diferenciá-las diria a um terceiro se aquele endereço já existe (§6).
 *
 * `weak_password` saiu deste conjunto em 17/09/2026. Ela não depende de conta
 * nenhuma: o GoTrue avalia comprimento, classes e HIBP a partir do valor
 * enviado, antes de olhar o usuário — e um e-mail já confirmado recebe sucesso
 * ofuscado, nunca `weak_password`. Mantê-la aqui transformava uma senha comum
 * numa espera que nunca termina: com `password_hibp_enabled` ligado no projeto,
 * `Senha1234` passa no filtro do Qoro e é recusada lá, e a pessoa via a tela de
 * espera sem que e-mail algum tivesse saído.
 */
const ACCOUNT_OUTCOMES = new Set(['user_already_exists', 'email_exists', 'user_banned']);

function json(body: { error: string } | { rowVersion: number }, status = 200): NextResponse {
  const response = NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
  if ('error' in body && body.error === 'gone') {
    response.cookies.set(SIGNUP_SESSION_COOKIE, '', SIGNUP_COOKIE_CLEAR_OPTIONS);
  }
  return response;
}

export async function POST(req: Request): Promise<Response> {
  if (!env.SIGNUP_AUTH_ENABLED || !env.SIGNUP_IDENTITY_ENABLED)
    return json({ error: 'unavailable' }, 503);
  let redirectUrl: string;
  try {
    redirectUrl = buildApplicationUrl(env.APP_BASE_URL ?? '', '/auth/confirm', {
      allowInsecureLocalhost: env.NODE_ENV !== 'production',
    });
  } catch {
    return json({ error: 'unavailable' }, 503);
  }
  if (
    req.headers.get('origin') !== new URL(redirectUrl).origin ||
    req.headers.get('sec-fetch-site') === 'cross-site'
  ) {
    return json({ error: 'blocked' }, 403);
  }
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
    const { email, password, captchaToken } = check.data;
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
    let completed = false;
    let rejectedPassword = false;
    try {
      const supabase = await createServerClient({
        newSession: true,
        cookieWrites: 'required',
        sessionWrites: 'reject',
      });
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: redirectUrl, ...captchaOptions(captchaToken) },
      });
      rejectedPassword = !data.session && error?.code === 'weak_password';
      completed = !data.session && (!error || ACCOUNT_OUTCOMES.has(error.code ?? ''));
    } catch {
      completed = false;
    } // Provider/cookies podem ter falhado após envio; não repetir.

    // Senha recusada é o único desfecho em que o provider prova que não enviou
    // nada. Devolver a reserva deixa a pessoa tentar outra senha na hora, em vez
    // de gastar a tentativa e cair no cooldown de reenvio. Se o CAS de devolução
    // perder, a linha continua reservada e o caminho conservador vale: 503, sem
    // afirmar envio. Nenhum detalhe do provider atravessa a resposta.
    if (rejectedPassword) {
      const aborted = await abortSignupAuthAttempt(token, reserved.rowVersion);
      return aborted.ok
        ? json({ error: 'weak_password' }, 422)
        : json({ error: 'unavailable' }, 503);
    }

    const finished = await finishSignupAuthAttempt(
      token,
      reserved.rowVersion,
      completed ? 'completed' : 'uncertain',
    );
    if (!completed || !finished.ok) return json({ error: 'unavailable' }, 503);
    return json({ rowVersion: finished.rowVersion });
  } catch {
    return json({ error: 'unavailable' }, 503);
  }
}
