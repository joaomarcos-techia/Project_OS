import { NextResponse } from 'next/server';

import {
  claimSignupDraftByVerifiedEmail,
  readSignupDraft,
  signupDraftMutationSchema,
  writeSignupDraft,
} from '@/contexts/onboarding';
import {
  assertSignupDraftReadAllowed,
  assertSignupDraftWriteAllowed,
  getClientIp,
} from '@/lib/auth/rate-limit';
import { resolvePreTenantOnboarding } from '@/lib/auth/pretenant-onboarding';
import { hashSignupUserId } from '@/lib/auth/signup-user-hash';
import { env } from '@/lib/env';
import { buildApplicationUrl } from '@/lib/http/application-url';
import { readWebhookBodyCapped } from '@/lib/http/webhook-body';

import { SIGNUP_COOKIE_CLEAR_OPTIONS, SIGNUP_SESSION_COOKIE } from '../cookie';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const MAX_DRAFT_BODY_BYTES = 4_096;

function json(body: object, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

function authFailure(reason: string): NextResponse {
  if (reason === 'profile_denied') return json({ error: 'forbidden' }, 403);
  if (reason === 'unavailable') return json({ error: 'unavailable' }, 503);
  return json({ error: 'unauthorized' }, 401);
}

async function verifiedPreTenant(): Promise<
  { ok: true; userId: string; email: string } | { ok: false; response: NextResponse }
> {
  const onboarding = await resolvePreTenantOnboarding();
  if (!onboarding.ok) return { ok: false, response: authFailure(onboarding.reason) };
  if (onboarding.kind !== 'pretenant') {
    return { ok: false, response: json({ error: 'forbidden' }, 403) };
  }
  return { ok: true, userId: onboarding.userId, email: onboarding.email };
}

function limited(reason: 'unavailable' | 'rate_limited', retryAfter?: number): NextResponse {
  const response = json({ error: reason }, reason === 'rate_limited' ? 429 : 503);
  if (reason === 'rate_limited') response.headers.set('Retry-After', String(retryAfter ?? 1));
  return response;
}

/**
 * Leitura do próprio draft e, quando ainda não há um, o vínculo pelo e-mail já
 * verificado — o caminho que devolve o cadastro a quem confirmou o link em outro
 * aparelho, sem o cookie anônimo do navegador original.
 *
 * O vínculo é tentado SÓ depois de a leitura devolver `gone`: quem já é dono
 * paga apenas o SELECT, e a transação com `FOR UPDATE` não roda a cada carga.
 * Ele é idempotente, não renova nenhum dos dois prazos e depende exclusivamente
 * da identidade provada por `getUser()` — nunca de e-mail, id ou cookie enviados
 * pelo cliente.
 */
export async function GET(req: Request): Promise<Response> {
  if (!env.SIGNUP_AUTH_ENABLED || !env.SIGNUP_IDENTITY_ENABLED)
    return json({ error: 'unavailable' }, 503);
  // Fetch Metadata antes de qualquer efeito: a leitura passou a poder vincular,
  // e uma navegação de terceiro não deve disparar esse vínculo. Ausência do
  // cabeçalho não bloqueia — só o `cross-site` explícito.
  if (req.headers.get('sec-fetch-site') === 'cross-site') return json({ error: 'blocked' }, 403);
  try {
    const identity = await verifiedPreTenant();
    if (!identity.ok) return identity.response;
    const limit = await assertSignupDraftReadAllowed(
      getClientIp(req.headers),
      hashSignupUserId(identity.userId),
    );
    if (!limit.ok)
      return limited(limit.reason, 'retryAfter' in limit ? limit.retryAfter : undefined);

    let result = await readSignupDraft(identity.userId);
    if (!result.ok && result.reason === 'gone') {
      const claim = await claimSignupDraftByVerifiedEmail(identity.userId, identity.email);
      if (!claim.ok && claim.reason === 'unavailable') return json({ error: 'unavailable' }, 503);
      // Relê mesmo quando o vínculo falhou. Duas abas do mesmo usuário disputando
      // o mesmo cadastro fazem a perdedora receber `conflict` — ou `gone`, porque
      // o `FOR UPDATE` reavalia a linha já vinculada e ela deixa de casar. Nos
      // dois casos o draft EXISTE, e responder 410 mandaria a pessoa redigitar
      // um cadastro que acabou de ser recuperado.
      result = await readSignupDraft(identity.userId);
    }
    if (!result.ok) {
      return json({ error: result.reason }, result.reason === 'gone' ? 410 : 503);
    }
    // O cookie anônimo NÃO é apagado aqui. Quem confirma no mesmo navegador
    // costuma deixar a aba do cadastro aberta; apagar o cookie desta resposta
    // faria aquela aba receber 410 e anunciar "sessão expirou" logo depois de
    // uma confirmação bem-sucedida. Quem limpa é o `GET /me` que reporta
    // `email_verified` — a mesma resposta que conta à aba o que aconteceu. O
    // cookie também morre sozinho em 60 min (`maxAge`), e o replay já é negado
    // por `consumed_at`, não pela limpeza.
    return json(result.draft);
  } catch {
    return json({ error: 'unavailable' }, 503);
  }
}

export async function POST(req: Request): Promise<Response> {
  if (!env.SIGNUP_AUTH_ENABLED || !env.SIGNUP_IDENTITY_ENABLED)
    return json({ error: 'unavailable' }, 503);
  let origin: string;
  try {
    origin = new URL(
      buildApplicationUrl(env.APP_BASE_URL ?? '', '/', {
        allowInsecureLocalhost: env.NODE_ENV !== 'production',
      }),
    ).origin;
  } catch {
    return json({ error: 'unavailable' }, 503);
  }
  if (req.headers.get('origin') !== origin || req.headers.get('sec-fetch-site') === 'cross-site') {
    return json({ error: 'blocked' }, 403);
  }

  try {
    const identity = await verifiedPreTenant();
    if (!identity.ok) return identity.response;
    const limit = await assertSignupDraftWriteAllowed(
      getClientIp(req.headers),
      hashSignupUserId(identity.userId),
    );
    if (!limit.ok)
      return limited(limit.reason, 'retryAfter' in limit ? limit.retryAfter : undefined);

    const raw = await readWebhookBodyCapped(req, MAX_DRAFT_BODY_BYTES);
    if (raw === null) return json({ error: 'body_too_large' }, 413);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return json({ error: 'invalid_body' }, 400);
    }
    const input = signupDraftMutationSchema.safeParse(parsed);
    if (!input.success) return json({ error: 'invalid_body' }, 400);

    const result = await writeSignupDraft({
      userId: identity.userId,
      email: identity.email,
      input: input.data,
    });
    if (!result.ok) {
      return json({ error: result.reason }, result.reason === 'conflict' ? 409 : 503);
    }
    const response = json({ rowVersion: result.rowVersion });
    response.cookies.set(SIGNUP_SESSION_COOKIE, '', SIGNUP_COOKIE_CLEAR_OPTIONS);
    return response;
  } catch {
    return json({ error: 'unavailable' }, 503);
  }
}
