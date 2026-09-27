import { NextResponse } from 'next/server';

import {
  adoptVerifiedSignupForContinuation,
  advanceSignupCredentialEpoch,
  checkSignupPasswordExposure,
  finishSignupCredentialEpoch,
  hashSignupToken,
  markSignupPasswordSet,
  readSignupContinuationIdentity,
  readSignupPasswordState,
  rebindPendingSignupAppMetadata,
  signupContinuationSchema,
  verifySignupHandoffCode,
} from '@/contexts/onboarding';
import { hashEmail } from '@/lib/auth/email-hash';
import { resolvePreTenantOnboarding } from '@/lib/auth/pretenant-onboarding';
import { assertSignupContinuationAllowed, getClientIp } from '@/lib/auth/rate-limit';
import { createAdminClient } from '@/lib/auth/supabase-admin';
import { clearSupabaseSessionSelector, createServerClient } from '@/lib/auth/supabase-server';
import { env } from '@/lib/env';
import { isSameOriginMutationRequest } from '@/lib/http/same-origin';
import { readWebhookBodyCapped } from '@/lib/http/webhook-body';

import { readSignupCookie, SIGNUP_COOKIE_CLEAR_OPTIONS, SIGNUP_SESSION_COOKIE } from '../../cookie';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_CONTINUATION_BODY_BYTES = 16_384;

function json(body: { error: string } | { ok: true }, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

function gone(): NextResponse {
  const response = json({ error: 'gone' }, 410);
  response.cookies.set(SIGNUP_SESSION_COOKIE, '', SIGNUP_COOKIE_CLEAR_OPTIONS);
  return response;
}

async function discardAuthSession(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
): Promise<void> {
  try {
    await supabase.auth.signOut({ scope: 'local' });
  } finally {
    await clearSupabaseSessionSelector();
  }
}

/**
 * Instala a sessão Auth na aba que começou o cadastro quando o OTP foi aberto
 * em outro aparelho. A senha cruza apenas este request e nunca é persistida.
 */
export async function POST(req: Request): Promise<Response> {
  if (!env.SIGNUP_AUTH_ENABLED || !env.SIGNUP_IDENTITY_ENABLED)
    return json({ error: 'unavailable' }, 503);
  if (!isSameOriginMutationRequest(req)) return json({ error: 'blocked' }, 403);

  const rawToken = readSignupCookie(req);
  if (!rawToken || !/^[A-Za-z0-9_-]{43}$/u.test(rawToken)) return gone();

  try {
    const raw = await readWebhookBodyCapped(req, MAX_CONTINUATION_BODY_BYTES);
    if (raw === null) return json({ error: 'body_too_large' }, 413);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return json({ error: 'invalid_body' }, 400);
    }
    const input = signupContinuationSchema.safeParse(parsed);
    if (!input.success) return json({ error: 'invalid_body' }, 400);

    const signupRef = hashSignupToken(rawToken);
    const limit = await assertSignupContinuationAllowed(
      getClientIp(req.headers),
      signupRef,
      hashEmail(input.data.email),
    );
    if (!limit.ok) {
      const response = json({ error: limit.reason }, limit.reason === 'rate_limited' ? 429 : 503);
      if (limit.reason === 'rate_limited')
        response.headers.set('Retry-After', String(limit.retryAfter));
      return response;
    }

    const expected = await readSignupContinuationIdentity(rawToken, input.data);
    if (!expected.ok) {
      return expected.reason === 'gone'
        ? gone()
        : json({ error: expected.reason }, expected.reason === 'conflict' ? 409 : 503);
    }

    if (
      !verifySignupHandoffCode(
        expected.codeSignupRef,
        expected.attemptEpoch,
        input.data.verificationCode,
      )
    ) {
      return json({ error: 'unauthorized' }, 401);
    }

    const admin = createAdminClient();
    const { data: found, error: findError } = await admin.auth.admin.getUserById(expected.userId);
    if (findError) return json({ error: 'unavailable' }, 503);
    const authUser = found?.user;
    if (
      !authUser ||
      authUser.id !== expected.userId ||
      authUser.email?.trim().toLowerCase() !== input.data.email.trim().toLowerCase() ||
      !authUser.email_confirmed_at
    ) {
      return json({ error: 'unauthorized' }, 401);
    }

    let canonicalRowVersion = input.data.rowVersion;
    const targetPasswordState = readSignupPasswordState(authUser, signupRef);

    if (expected.adoption) {
      const sourcePasswordState = readSignupPasswordState(authUser, expected.codeSignupRef);
      let sourceReservedVersion = expected.credentialRowVersion;

      if (targetPasswordState !== 'set') {
        if (sourcePasswordState !== 'pending' || expected.credentialState === 'reserved') {
          return json({ error: 'unauthorized' }, 401);
        }
        const exposure = await checkSignupPasswordExposure(input.data.password);
        if (exposure === 'pwned') return json({ error: 'weak_password' }, 422);
        if (exposure === 'unavailable') return json({ error: 'unavailable' }, 503);

        const sourceEpoch = await advanceSignupCredentialEpoch({
          userId: expected.userId,
          signupRef: expected.codeSignupRef,
          expectedRowVersion: expected.credentialRowVersion,
          source: 'adoption',
        });
        if (!sourceEpoch.ok) {
          return sourceEpoch.reason === 'gone'
            ? gone()
            : json({ error: sourceEpoch.reason }, sourceEpoch.reason === 'conflict' ? 409 : 503);
        }
        sourceReservedVersion = sourceEpoch.rowVersion;

        const rebound = rebindPendingSignupAppMetadata(authUser, signupRef);
        const readyMetadata = markSignupPasswordSet(
          { ...authUser, app_metadata: rebound },
          signupRef,
        );
        const { data: updated, error: updateError } = await admin.auth.admin.updateUserById(
          expected.userId,
          { password: input.data.password, app_metadata: readyMetadata },
        );
        if (updateError || readSignupPasswordState(updated.user, signupRef) !== 'set') {
          await finishSignupCredentialEpoch({
            userId: expected.userId,
            signupRef: expected.codeSignupRef,
            expectedRowVersion: sourceReservedVersion,
            outcome: 'uncertain',
          }).catch(() => undefined);
          return json({ error: 'unavailable' }, 503);
        }
      }

      const adopted = await adoptVerifiedSignupForContinuation({
        rawToken,
        email: input.data.email,
        targetRowVersion: expected.adoption.targetRowVersion,
        userId: expected.userId,
        sourceSignupRef: expected.codeSignupRef,
        sourceRowVersion: sourceReservedVersion,
        attemptEpoch: expected.attemptEpoch,
      });
      if (!adopted.ok) {
        return adopted.reason === 'gone'
          ? gone()
          : json({ error: adopted.reason }, adopted.reason === 'conflict' ? 409 : 503);
      }
      canonicalRowVersion = adopted.rowVersion;
    } else if (targetPasswordState === 'pending') {
      const exposure = await checkSignupPasswordExposure(input.data.password);
      if (exposure === 'pwned') return json({ error: 'weak_password' }, 422);
      if (exposure === 'unavailable') return json({ error: 'unavailable' }, 503);

      const epoch = await advanceSignupCredentialEpoch({
        userId: expected.userId,
        signupRef,
        expectedRowVersion: expected.credentialRowVersion,
        source: 'continuation',
      });
      if (!epoch.ok) {
        return epoch.reason === 'gone'
          ? gone()
          : json({ error: epoch.reason }, epoch.reason === 'conflict' ? 409 : 503);
      }
      const { data: updated, error: updateError } = await admin.auth.admin.updateUserById(
        expected.userId,
        {
          password: input.data.password,
          app_metadata: markSignupPasswordSet(authUser, signupRef),
        },
      );
      if (updateError || readSignupPasswordState(updated.user, signupRef) !== 'set') {
        await finishSignupCredentialEpoch({
          userId: expected.userId,
          signupRef,
          expectedRowVersion: epoch.rowVersion,
          outcome: 'uncertain',
        }).catch(() => undefined);
        return json({ error: 'unavailable' }, 503);
      }
      const finished = await finishSignupCredentialEpoch({
        userId: expected.userId,
        signupRef,
        expectedRowVersion: epoch.rowVersion,
        outcome: 'completed',
      });
      if (!finished.ok) return json({ error: 'unavailable' }, 503);
    } else if (targetPasswordState === 'set') {
      // O update Auth pode ter sido aplicado e a resposta/finish ter se perdido.
      // O marker `set` é autoritativo para NÃO escrever a senha outra vez; aqui
      // apenas fechamos idempotentemente a reserva antes do login.
      const repaired = await finishSignupCredentialEpoch({
        userId: expected.userId,
        signupRef,
        expectedRowVersion: canonicalRowVersion,
        outcome: 'completed',
      });
      if (!repaired.ok) return json({ error: 'unavailable' }, 503);
    } else {
      return json({ error: 'unauthorized' }, 401);
    }

    const supabase = await createServerClient({ cookieWrites: 'required', newSession: true });
    const { data, error } = await supabase.auth.signInWithPassword({
      email: input.data.email,
      password: input.data.password,
    });
    if (error || !data.user || !data.session || data.user.id !== expected.userId) {
      await discardAuthSession(supabase);
      return json({ error: 'unauthorized' }, 401);
    }

    const onboarding = await resolvePreTenantOnboarding(supabase);
    if (
      !onboarding.ok ||
      onboarding.kind !== 'pretenant' ||
      onboarding.userId !== expected.userId ||
      onboarding.email.trim().toLowerCase() !== input.data.email.trim().toLowerCase()
    ) {
      await discardAuthSession(supabase);
      return json({ error: 'unauthorized' }, 401);
    }

    const response = json({ ok: true });
    response.cookies.set(SIGNUP_SESSION_COOKIE, '', SIGNUP_COOKIE_CLEAR_OPTIONS);
    return response;
  } catch {
    return json({ error: 'unavailable' }, 503);
  }
}
