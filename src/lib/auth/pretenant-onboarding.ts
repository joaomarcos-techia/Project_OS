import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

import { env } from '@/lib/env';

import { postLoginRedirect, type PostLoginRoute } from './policies';
import { createServerClient } from './supabase-server';
import { authenticate, readAuthoritativeProfile } from './tenant-context';

const verifiedEmailSchema = z.string().max(160).email();
const authUserIdSchema = z.string().uuid();

export type PreTenantOnboardingResult =
  | { ok: true; kind: 'pretenant'; userId: string; email: string }
  | { ok: true; kind: 'redirect'; route: PostLoginRoute | '/convite' }
  | {
      ok: false;
      reason:
        | 'unavailable'
        | 'invalid_session'
        | 'anonymous'
        | 'email_unverified'
        | 'profile_denied';
    };

/**
 * Única seam que admite uma sessão Auth verificada sem profile.
 * Não concede tenant, role ou permissão; só autoriza continuar o cadastro.
 */
export async function resolvePreTenantOnboarding(
  existingClient?: SupabaseClient,
): Promise<PreTenantOnboardingResult> {
  if (!env.SIGNUP_AUTH_ENABLED) return { ok: false, reason: 'unavailable' };

  try {
    const supabase = existingClient ?? (await createServerClient());
    const { data, error } = await supabase.auth.getUser();
    const user = data.user;
    if (error || !user) return { ok: false, reason: 'invalid_session' };
    const userId = authUserIdSchema.safeParse(user.id);
    if (!userId.success) return { ok: false, reason: 'invalid_session' };
    if (user.is_anonymous === true) return { ok: false, reason: 'anonymous' };

    const email = verifiedEmailSchema.safeParse(user.email);
    const confirmedAt = user.email_confirmed_at;
    if (!email.success || !confirmedAt || !Number.isFinite(Date.parse(confirmedAt))) {
      return { ok: false, reason: 'email_unverified' };
    }

    const profile = await readAuthoritativeProfile(userId.data);
    if (!profile) return { ok: true, kind: 'pretenant', userId: userId.data, email: email.data };

    const identity = await authenticate();
    if (!identity.ok) {
      return identity.reason === 'INVITE_PENDING'
        ? { ok: true, kind: 'redirect', route: '/convite' }
        : { ok: false, reason: 'profile_denied' };
    }
    if (identity.identity.userId !== userId.data) return { ok: false, reason: 'profile_denied' };

    return {
      ok: true,
      kind: 'redirect',
      route: postLoginRedirect({
        role: identity.identity.role,
        mfaEnrolledAt: profile.mfaEnrolledAt,
        aal: identity.identity.aal,
      }),
    };
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}
