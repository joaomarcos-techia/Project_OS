import { NextResponse } from 'next/server';
import { z } from 'zod';

import {
  advanceSignupCredentialEpoch,
  checkSignupPasswordExposure,
  finishSignupCredentialEpoch,
  markSignupPasswordSet,
  readOwnedSignupReference,
  readSignupDraft,
  readSignupPasswordState,
  resolveReadyOwnedSignupOnboarding,
} from '@/contexts/onboarding';
import { resolvePreTenantOnboarding } from '@/lib/auth/pretenant-onboarding';
import { assertSignupDraftWriteAllowed, getClientIp } from '@/lib/auth/rate-limit';
import { hashSignupUserId } from '@/lib/auth/signup-user-hash';
import { signupPasswordSchema } from '@/lib/auth/signup-password';
import { createAdminClient } from '@/lib/auth/supabase-admin';
import { clearSupabaseSessionSelector, createServerClient } from '@/lib/auth/supabase-server';
import { env } from '@/lib/env';
import { resolveTrustedApplicationOrigin } from '@/lib/http/application-url';
import { readWebhookBodyCapped } from '@/lib/http/webhook-body';
import { logger } from '@/lib/observability/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 16_384;
const schema = z.object({ password: signupPasswordSchema }).strict();
function json(body: { error: string } | { ok: true }, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

/** Only the authenticated recipient of the confirmation link can choose this password. */
export async function POST(req: Request): Promise<Response> {
  if (!env.SIGNUP_AUTH_ENABLED || !env.SIGNUP_IDENTITY_ENABLED)
    return json({ error: 'unavailable' }, 503);
  const origin = resolveTrustedApplicationOrigin(req);
  if (origin === undefined) return json({ error: 'unavailable' }, 503);
  if (origin === null) return json({ error: 'blocked' }, 403);

  let reservation: { userId: string; signupRef: string; expectedRowVersion: number } | null = null;
  let authWriteCompleted = false;
  try {
    const identity = await resolvePreTenantOnboarding();
    if (!identity.ok)
      return json(
        { error: identity.reason === 'unavailable' ? 'unavailable' : 'unauthorized' },
        identity.reason === 'unavailable' ? 503 : 401,
      );
    if (identity.kind !== 'pretenant' || !identity.signupRef)
      return json({ error: 'unauthorized' }, 403);

    const limit = await assertSignupDraftWriteAllowed(
      getClientIp(req.headers),
      hashSignupUserId(identity.userId),
    );
    if (!limit.ok) {
      const response = json({ error: limit.reason }, limit.reason === 'rate_limited' ? 429 : 503);
      if (limit.reason === 'rate_limited')
        response.headers.set('Retry-After', String(limit.retryAfter));
      return response;
    }

    const raw = await readWebhookBodyCapped(req, MAX_BODY_BYTES);
    if (raw === null) return json({ error: 'body_too_large' }, 413);
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return json({ error: 'invalid_body' }, 400);
    }
    const input = schema.safeParse(body);
    if (!input.success) return json({ error: 'invalid_body' }, 400);

    const owner = await readOwnedSignupReference(identity.userId, identity.email);
    if (!owner.ok) return json({ error: owner.reason }, owner.reason === 'gone' ? 410 : 503);
    if (owner.signupRef !== identity.signupRef || owner.checkoutRecovery)
      return json({ error: 'unauthorized' }, 403);
    const draft = await readSignupDraft(identity.userId, owner.signupRef);
    if (!draft.ok) return json({ error: draft.reason }, draft.reason === 'gone' ? 410 : 503);

    const admin = createAdminClient();
    const { data: found, error: lookupError } = await admin.auth.admin.getUserById(identity.userId);
    const user = found.user;
    if (lookupError) return json({ error: 'unavailable' }, 503);
    if (
      !user ||
      user.id !== identity.userId ||
      !user.email_confirmed_at ||
      user.email?.trim().toLowerCase() !== identity.email.trim().toLowerCase()
    )
      return json({ error: 'unauthorized' }, 403);
    const state = readSignupPasswordState(user, owner.signupRef);
    if (state === null) return json({ error: 'unauthorized' }, 403);

    if (state === 'pending') {
      const exposure = await checkSignupPasswordExposure(input.data.password);
      if (exposure === 'pwned') return json({ error: 'weak_password' }, 422);
      if (exposure === 'unavailable') return json({ error: 'unavailable' }, 503);
      const epoch = await advanceSignupCredentialEpoch({
        userId: identity.userId,
        signupRef: owner.signupRef,
        expectedRowVersion: draft.draft.rowVersion,
        source: 'continuation',
      });
      if (!epoch.ok)
        return json(
          { error: epoch.reason },
          epoch.reason === 'gone' ? 410 : epoch.reason === 'unavailable' ? 503 : 409,
        );
      reservation = {
        userId: identity.userId,
        signupRef: owner.signupRef,
        expectedRowVersion: epoch.rowVersion,
      };
      const { data: updated, error: updateError } = await admin.auth.admin.updateUserById(
        identity.userId,
        {
          password: input.data.password,
          app_metadata: markSignupPasswordSet(user, owner.signupRef),
        },
      );
      if (updateError || readSignupPasswordState(updated.user, owner.signupRef) !== 'set') {
        const rejected = updateError?.code === 'weak_password';
        const settled = await finishSignupCredentialEpoch({
          ...reservation,
          outcome: rejected ? 'completed' : 'uncertain',
        });
        reservation = null;
        if (!settled.ok) return json({ error: 'unavailable' }, 503);
        return json({ error: rejected ? 'weak_password' : 'unavailable' }, rejected ? 422 : 503);
      }
      authWriteCompleted = true;
    }

    // A successful Auth marker permits repair after a lost response, never another password write.
    const finished = await finishSignupCredentialEpoch({
      userId: identity.userId,
      signupRef: owner.signupRef,
      expectedRowVersion: reservation?.expectedRowVersion ?? draft.draft.rowVersion,
      outcome: 'completed',
    });
    reservation = null;
    if (!finished.ok) return json({ error: 'unavailable' }, 503);

    const supabase = await createServerClient({ cookieWrites: 'required', newSession: true });
    const { data, error } = await supabase.auth.signInWithPassword({
      email: identity.email,
      password: input.data.password,
    });
    if (error || !data.session || data.user?.id !== identity.userId) {
      try {
        await supabase.auth.signOut({ scope: 'local' });
      } finally {
        await clearSupabaseSessionSelector();
      }
      return json({ error: 'unauthorized' }, 401);
    }
    const ready = await resolveReadyOwnedSignupOnboarding(supabase);
    if (!ready.ok || ready.kind !== 'pretenant' || ready.userId !== identity.userId) {
      try {
        await supabase.auth.signOut({ scope: 'local' });
      } finally {
        await clearSupabaseSessionSelector();
      }
      return json({ error: 'unavailable' }, 503);
    }
    return json({ ok: true });
  } catch {
    if (reservation && !authWriteCompleted) {
      try {
        await finishSignupCredentialEpoch({ ...reservation, outcome: 'uncertain' });
      } catch {
        logger.warn('signup.password.reconcile_failed', {});
      }
    }
    logger.warn('signup.password.unavailable', {});
    return json({ error: 'unavailable' }, 503);
  }
}
