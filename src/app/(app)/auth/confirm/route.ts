/** Troca OTPs de e-mail por uma sessão isolada e pelo destino autorizado. */
import type { EmailOtpType } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';

import {
  ensureSignupDraftForVerifiedEmail,
  ensureReadyOwnedSignupAuthBinding,
  ensureVerifiedSignupAuthBinding,
  readSignupDraft,
  validateVerifiedSignupAuthUserForClaim,
} from '@/contexts/onboarding';
import {
  RECOVERY_GRANT_COOKIE,
  RECOVERY_GRANT_TTL_SECONDS,
  signRecoveryGrant,
} from '@/lib/auth/recovery-grant';
import {
  SIGNUP_CONFIRMATION_GRANT_COOKIE,
  SIGNUP_CONFIRMATION_GRANT_TTL_SECONDS,
  signSignupConfirmationGrant,
} from '@/lib/auth/signup-confirmation-grant';
import { resolvePreTenantOnboarding } from '@/lib/auth/pretenant-onboarding';
import { clearSupabaseSessionSelector, createServerClient } from '@/lib/auth/supabase-server';
import { readAuthoritativeProfile } from '@/lib/auth/tenant-context';
import { env } from '@/lib/env';
import {
  AUTH_CONFIRM_BRIDGE_SCRIPT,
  AUTH_CONFIRM_BRIDGE_STYLE,
  AUTH_CONFIRM_CONTENT_SECURITY_POLICY,
} from '@/lib/http/auth-confirm-security';
import { buildApplicationUrl } from '@/lib/http/application-url';
import { readWebhookBodyCapped } from '@/lib/http/webhook-body';
import { logger } from '@/lib/observability/logger';

import { isValidOtpType, safeNextForOtp, verifyErrorReason } from './confirm-logic';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SIGNUP_CONFIRMED_PATH = '/cadastro/confirmado';
const RESET_PASSWORD_PATH = '/reset-password';
const INVITE_PATH = '/convite';
const SIGNUP_REFERENCE_PATTERN = /^[a-f0-9]{64}$/u;
const TOKEN_HASH_PATTERN = /^[A-Za-z0-9_-]{1,2048}$/u;
const MAX_CONFIRM_BODY_BYTES = 4_096;
const CONFIRM_FIELDS = new Set(['token_hash', 'type', 'next', 'signup_ref']);

function applyPrivateHeaders(response: Response): Response {
  response.headers.set('Cache-Control', 'no-store, private, max-age=0');
  response.headers.set('Pragma', 'no-cache');
  response.headers.set('Referrer-Policy', 'no-referrer');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
  return response;
}

function redirect303(publicOrigin: string, pathname: string): NextResponse {
  return applyPrivateHeaders(
    NextResponse.redirect(new URL(pathname, publicOrigin), 303),
  ) as NextResponse;
}

function rejectRequest(status: 400 | 403 | 413 | 415): Response {
  return applyPrivateHeaders(new Response(null, { status }));
}

async function preserveSignupConfirmationRepair(userId: string, signupRef: string): Promise<void> {
  const expiresAt = Date.now() + SIGNUP_CONFIRMATION_GRANT_TTL_SECONDS * 1000;
  const jar = await cookies();
  jar.set(
    SIGNUP_CONFIRMATION_GRANT_COOKIE,
    signSignupConfirmationGrant({ userId, signupRef, expiresAt }),
    {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: SIGNUP_CONFIRMATION_GRANT_TTL_SECONDS,
    },
  );
}

/**
 * O segredo novo mora no fragmento, que o navegador não envia no GET. Links já
 * emitidos com query continuam funcionando: este HTML os lê no browser, limpa a
 * barra e faz o mesmo POST. O GET nunca chama `verifyOtp`.
 *
 * Um scanner que executa JavaScript ainda pode submeter o formulário. Exigir um
 * segundo clique seria a única separação forte, mas quebraria o requisito de um
 * clique; a ponte fecha scanners HTTP/prefetch e tira o bearer de URL, Referer e
 * access log para todos os links novos.
 */
function bridgeHtml(): string {
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex,nofollow,noarchive">
  <title>Confirmando e-mail — Qoro</title>
  <style>${AUTH_CONFIRM_BRIDGE_STYLE}</style>
</head>
<body>
  <main class="card" aria-live="polite"><p><span class="dot" aria-hidden="true"></span>Confirmando seu e-mail…</p><noscript>Ative o JavaScript para concluir a confirmação.</noscript></main>
  <script>${AUTH_CONFIRM_BRIDGE_SCRIPT}</script>
</body>
</html>`;
}

export async function GET(_request?: NextRequest): Promise<Response> {
  const response = new Response(bridgeHtml(), {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': AUTH_CONFIRM_CONTENT_SECURITY_POLICY,
    },
  });
  return applyPrivateHeaders(response);
}

function resolveConfirmationPublicOrigin(): string | null {
  try {
    return new URL(
      buildApplicationUrl(env.APP_BASE_URL ?? '', '/', {
        // O gate executa o build de produção em loopback sem TLS. A opção só
        // admite localhost/127.0.0.1/[::1]; hosts externos continuam HTTPS-only.
        allowInsecureLocalhost: true,
      }),
    ).origin;
  } catch {
    return null;
  }
}

type ConfirmationInput = {
  tokenHash: string;
  type: EmailOtpType;
  requestedNext: string | null;
  signupRef: string | null;
};

function single(params: URLSearchParams, key: string): string | null {
  const values = params.getAll(key);
  return values.length === 1 ? values[0]! : null;
}

function readConfirmationInput(raw: string): ConfirmationInput | null {
  const params = new URLSearchParams(raw);
  for (const key of params.keys()) {
    if (!CONFIRM_FIELDS.has(key) || params.getAll(key).length !== 1) return null;
  }
  const tokenHash = single(params, 'token_hash');
  const type = single(params, 'type');
  const requestedNext = params.has('next') ? single(params, 'next') : null;
  const signupRef = params.has('signup_ref') ? single(params, 'signup_ref') : null;
  if (!tokenHash || !TOKEN_HASH_PATTERN.test(tokenHash)) return null;
  if (!isValidOtpType(type)) return null;
  if (requestedNext !== null && requestedNext.length > 256) return null;
  if (signupRef !== null && !SIGNUP_REFERENCE_PATTERN.test(signupRef)) return null;
  return { tokenHash, type, requestedNext, signupRef };
}

async function confirmOtp(publicOrigin: string, input: ConfirmationInput): Promise<Response> {
  const { tokenHash, type, requestedNext, signupRef } = input;
  const fail = (reason: string): NextResponse =>
    redirect303(publicOrigin, `/auth/auth-error?reason=${encodeURIComponent(reason)}`);

  const next = safeNextForOtp(requestedNext, type);
  const signupDestination =
    requestedNext === SIGNUP_CONFIRMED_PATH && next === SIGNUP_CONFIRMED_PATH;
  const recoveryDestination = requestedNext === RESET_PASSWORD_PATH && next === RESET_PASSWORD_PATH;
  const inviteDestination = requestedNext === INVITE_PATH && next === INVITE_PATH;
  const validSignupRef = signupRef !== null && SIGNUP_REFERENCE_PATTERN.test(signupRef);

  // Signup nunca escolhe destino por fallback. Recovery pode ser confirmação
  // autônoma, redefinição de senha ou o convite de usuário existente emitido
  // por `createAuthConfirmationUrl`.
  if (type === 'signup' && !signupDestination) return fail('invalid_token');
  if (type === 'recovery' && !signupDestination && !recoveryDestination && !inviteDestination) {
    return fail('invalid_token');
  }
  if (signupDestination && !validSignupRef) return fail('invalid_token');

  await clearSupabaseSessionSelector();
  const supabase = await createServerClient({ cookieWrites: 'required', newSession: true });
  const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
  if (error) {
    const reason = verifyErrorReason(error.message);
    logger.warn('auth.confirm.verify_failed', { type, reason });
    return fail(reason);
  }

  const rejectVerifiedSession = async (): Promise<NextResponse> => {
    await supabase.auth.signOut({ scope: 'local' });
    await clearSupabaseSessionSelector();
    return fail('invalid_token');
  };

  if (signupDestination) {
    const userId = data.user?.id;
    const email = data.user?.email;
    const boundSignupRef = validSignupRef ? signupRef : null;
    if (!userId || !email || !boundSignupRef) return rejectVerifiedSession();

    const validation = await validateVerifiedSignupAuthUserForClaim({ userId, email });
    if (!validation.ok && validation.reason === 'unavailable') {
      await preserveSignupConfirmationRepair(userId, boundSignupRef);
      return redirect303(publicOrigin, SIGNUP_CONFIRMED_PATH);
    }
    if (!validation.ok) return rejectVerifiedSession();

    const claim = await ensureSignupDraftForVerifiedEmail(userId, email, boundSignupRef);
    if (!claim.ok && claim.reason === 'unavailable') {
      await preserveSignupConfirmationRepair(userId, boundSignupRef);
      return redirect303(publicOrigin, SIGNUP_CONFIRMED_PATH);
    }
    if (!claim.ok) return rejectVerifiedSession();

    const binding = await ensureVerifiedSignupAuthBinding({
      userId,
      email,
      signupRef: boundSignupRef,
    });
    if (!binding.ok && binding.reason === 'unavailable') {
      await preserveSignupConfirmationRepair(userId, boundSignupRef);
      return redirect303(publicOrigin, SIGNUP_CONFIRMED_PATH);
    }
    if (!binding.ok) return rejectVerifiedSession();
    return redirect303(publicOrigin, SIGNUP_CONFIRMED_PATH);
  }

  if (type === 'recovery' && recoveryDestination) {
    const user = data.user;
    if (!user?.id) return rejectVerifiedSession();

    const expiresAt = Date.now() + RECOVERY_GRANT_TTL_SECONDS * 1000;
    const profile = await readAuthoritativeProfile(user.id);
    let signedGrant: string;
    if (profile) {
      signedGrant = signRecoveryGrant({
        kind: 'profile',
        userId: user.id,
        epoch: profile.claimsVersion,
        expiresAt,
      });
    } else {
      if (
        !user.email ||
        !user.email_confirmed_at ||
        !Number.isFinite(Date.parse(user.email_confirmed_at))
      ) {
        return rejectVerifiedSession();
      }
      const readyBinding = await ensureReadyOwnedSignupAuthBinding({
        userId: user.id,
        email: user.email,
      });
      if (!readyBinding.ok) return rejectVerifiedSession();
      if (typeof readyBinding.orphanEpoch === 'number') {
        signedGrant = signRecoveryGrant({
          kind: 'pretenant_orphan',
          userId: user.id,
          epoch: readyBinding.orphanEpoch,
          signupRef: readyBinding.signupRef,
          expiresAt,
        });
      } else {
        const draft = await readSignupDraft(user.id, readyBinding.signupRef);
        if (!draft.ok) return rejectVerifiedSession();
        signedGrant = signRecoveryGrant({
          kind: 'pretenant',
          userId: user.id,
          epoch: draft.draft.rowVersion,
          signupRef: readyBinding.signupRef,
          expiresAt,
        });
      }
    }

    const jar = await cookies();
    jar.set(RECOVERY_GRANT_COOKIE, signedGrant, {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: RECOVERY_GRANT_TTL_SECONDS,
    });
    return redirect303(publicOrigin, RESET_PASSWORD_PATH);
  }

  // Convites e magic links legados preservam os guards já existentes. Eles não
  // emitem grant de recovery nem executam claim de cadastro.
  if (type === 'signup' || type === 'magiclink') {
    const onboarding = await resolvePreTenantOnboarding(supabase);
    if (!onboarding.ok) return rejectVerifiedSession();
    if (onboarding.kind === 'pretenant') return rejectVerifiedSession();
    return redirect303(publicOrigin, onboarding.route);
  }

  return redirect303(publicOrigin, next);
}

export async function POST(request: NextRequest): Promise<Response> {
  const publicOrigin = resolveConfirmationPublicOrigin();
  if (!publicOrigin) return applyPrivateHeaders(new Response(null, { status: 503 }));
  const fetchSite = request.headers.get('sec-fetch-site');
  if (
    request.headers.get('origin') !== publicOrigin ||
    (fetchSite !== null && fetchSite !== 'same-origin')
  ) {
    return rejectRequest(403);
  }
  const contentType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (contentType !== 'application/x-www-form-urlencoded') return rejectRequest(415);

  const raw = await readWebhookBodyCapped(request, MAX_CONFIRM_BODY_BYTES);
  if (raw === null) return rejectRequest(413);
  const input = readConfirmationInput(raw);
  if (!input) return rejectRequest(400);
  return confirmOtp(publicOrigin, input);
}
