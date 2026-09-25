import { NextResponse } from 'next/server';

import {
  readSignupDraft,
  resolveReadyOwnedSignupOnboarding,
  signupDraftMutationSchema,
  writeSignupDraft,
} from '@/contexts/onboarding';
import {
  assertSignupDraftReadAllowed,
  assertSignupDraftWriteAllowed,
  getClientIp,
} from '@/lib/auth/rate-limit';
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
  if (
    reason === 'profile_denied' ||
    reason === 'credentials_pending' ||
    reason === 'credentials_invalid'
  ) {
    return json({ error: 'forbidden' }, 403);
  }
  if (reason === 'unavailable') return json({ error: 'unavailable' }, 503);
  return json({ error: 'unauthorized' }, 401);
}

async function readyPreTenant(): Promise<
  | { ok: true; userId: string; email: string; signupRef: string }
  | { ok: false; response: NextResponse }
> {
  const onboarding = await resolveReadyOwnedSignupOnboarding();
  if (!onboarding.ok) return { ok: false, response: authFailure(onboarding.reason) };
  if (onboarding.kind !== 'pretenant') {
    return { ok: false, response: json({ error: 'forbidden' }, 403) };
  }
  return {
    ok: true,
    userId: onboarding.userId,
    email: onboarding.email,
    signupRef: onboarding.signupRef,
  };
}

function limited(reason: 'unavailable' | 'rate_limited', retryAfter?: number): NextResponse {
  const response = json({ error: reason }, reason === 'rate_limited' ? 429 : 503);
  if (reason === 'rate_limited') response.headers.set('Retry-After', String(retryAfter ?? 1));
  return response;
}

/** Leitura exata do draft que Auth e banco já declararam como a mesma posse pronta. */
export async function GET(req: Request): Promise<Response> {
  if (!env.SIGNUP_AUTH_ENABLED || !env.SIGNUP_IDENTITY_ENABLED)
    return json({ error: 'unavailable' }, 503);
  // Fetch Metadata antes da leitura autenticada. Ausência do cabeçalho não
  // bloqueia — só o `cross-site` explícito.
  if (req.headers.get('sec-fetch-site') === 'cross-site') return json({ error: 'blocked' }, 403);
  try {
    const identity = await readyPreTenant();
    if (!identity.ok) return identity.response;
    const limit = await assertSignupDraftReadAllowed(
      getClientIp(req.headers),
      hashSignupUserId(identity.userId),
    );
    if (!limit.ok)
      return limited(limit.reason, 'retryAfter' in limit ? limit.retryAfter : undefined);

    const result = await readSignupDraft(identity.userId, identity.signupRef);
    if (!result.ok) {
      return json({ error: result.reason }, result.reason === 'gone' ? 410 : 503);
    }
    // O cookie anônimo NÃO é apagado aqui. Quem confirma no mesmo navegador
    // costuma deixar a aba do cadastro aberta; apagar o cookie desta resposta
    // faria aquela aba receber 410 e anunciar "sessão expirou" logo depois de
    // uma confirmação bem-sucedida. O cookie também morre sozinho em 60 min
    // (`maxAge`), e o replay já é negado por `consumed_at`, não pela limpeza. A
    // aba original o remove apenas depois que `/sessions/continue` abre a sessão
    // Auth com sucesso.
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
    const identity = await readyPreTenant();
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
