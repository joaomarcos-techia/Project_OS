import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

import { env } from '@/lib/env';

import { postLoginRedirect, type PostLoginRoute } from './policies';
import { createServerClient } from './supabase-server';
import { authenticate, readAuthoritativeProfile } from './tenant-context';

const verifiedEmailSchema = z.string().max(160).email();
const authUserIdSchema = z.string().uuid();
const signupReferenceSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const selfServiceSignupBindingSchema = z
  .object({
    version: z.literal(1),
    kind: z.literal('self_service'),
    signup_ref: signupReferenceSchema,
    password_state: z.enum(['pending', 'set']),
  })
  .strict();

const SELF_SERVICE_SIGNUP_METADATA_KEY = 'qoro_self_service_signup';

export type PreTenantOnboardingResult =
  | {
      ok: true;
      kind: 'pretenant';
      userId: string;
      email: string;
      signupRef: string | null;
      pendingSignupRef: string | null;
    }
  | { ok: true; kind: 'redirect'; route: PostLoginRoute | '/convite' }
  | {
      ok: false;
      reason:
        | 'unavailable'
        | 'invalid_session'
        | 'anonymous'
        | 'email_unverified'
        | 'profile_denied'
        | 'credentials_pending'
        | 'credentials_invalid';
    };

type ResolvePreTenantOptions = {
  requireReadyCredentials: boolean;
};

function readSelfServiceSignupBinding(appMetadata: unknown) {
  if (typeof appMetadata !== 'object' || appMetadata === null || Array.isArray(appMetadata)) {
    return null;
  }
  const candidate = (appMetadata as Record<string, unknown>)[SELF_SERVICE_SIGNUP_METADATA_KEY];
  const parsed = selfServiceSignupBindingSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

/**
 * Única seam que admite uma sessão Auth verificada sem profile.
 * Não concede tenant, role ou permissão; só autoriza continuar o cadastro.
 */
async function resolvePreTenantOnboardingWithOptions(
  options: ResolvePreTenantOptions,
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
    if (!profile) {
      const binding = readSelfServiceSignupBinding(user.app_metadata);
      if (options.requireReadyCredentials) {
        if (!binding) return { ok: false, reason: 'credentials_invalid' };
        if (binding.password_state !== 'set') {
          return { ok: false, reason: 'credentials_pending' };
        }
      }
      return {
        ok: true,
        kind: 'pretenant',
        userId: userId.data,
        email: email.data,
        signupRef: binding?.signup_ref ?? null,
        pendingSignupRef: binding?.password_state === 'pending' ? binding.signup_ref : null,
      };
    }

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

/**
 * Seam permissiva usada somente enquanto o fluxo ainda precisa concluir a
 * credencial (callback, handoff e recuperação). Ela não deve proteger etapas
 * que leem ou alteram o cadastro depois da confirmação.
 */
export async function resolvePreTenantOnboarding(
  existingClient?: SupabaseClient,
): Promise<PreTenantOnboardingResult> {
  return resolvePreTenantOnboardingWithOptions({ requireReadyCredentials: false }, existingClient);
}

/**
 * Gate das etapas posteriores ao handoff. Além da sessão e do e-mail
 * autoritativos, exige o marcador gravado pela Admin API depois de a senha ter
 * sido instalada. Uma sessão criada pelo clique no e-mail, ainda `pending`, não
 * consegue ler o draft, escolher plano nem iniciar cobrança.
 */
export async function resolveReadyPreTenantOnboarding(
  existingClient?: SupabaseClient,
): Promise<PreTenantOnboardingResult> {
  return resolvePreTenantOnboardingWithOptions({ requireReadyCredentials: true }, existingClient);
}
