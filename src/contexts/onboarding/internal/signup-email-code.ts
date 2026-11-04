import 'server-only';

import { createAdminClient, findAdminUserByEmail } from '@/lib/auth/supabase-admin';
import { clearSupabaseSessionSelector, createServerClient } from '@/lib/auth/supabase-server';
import { readAuthoritativeProfile } from '@/lib/auth/tenant-context';
import { resolveReadyPreTenantOnboarding } from '@/lib/auth/pretenant-onboarding';
import { logger } from '@/lib/observability/logger';
import { hashSignupToken, readSignupReferenceLiveness } from './signup-session';
import { readSignupBilling } from './signup-billing';

import {
  hasInitialSignupPassword,
  markSignupPasswordSet,
  readSignupAuthBinding,
} from './signup-auth-binding';
import {
  ensureVerifiedSignupAuthBinding,
  resolveReadyOwnedSignupOnboarding,
  validateVerifiedSignupAuthUserForClaim,
} from './signup-auth-admin';
import {
  ensureSignupDraftForVerifiedEmail,
  readSignupPlan,
  readOwnedSignupReference,
} from './signup-draft';
import {
  finishSignupEmailCode,
  reserveSignupEmailCode,
  signupEmailCodeSchema,
} from './signup-email-code-repository';

type Outcome =
  | { ok: true; next: string; mailProof?: { userId: string; signupRef: string } }
  | { ok: false; reason: 'invalid' | 'expired' | 'locked' | 'conflict' | 'gone' | 'unavailable' };

/** All proven signup entry points converge on this resolver; it never creates a charge. */
export async function resolveSignupContinuation(): Promise<
  { ok: true; next: string } | { ok: false }
> {
  const ready = await resolveReadyPreTenantOnboarding();
  if (!ready.ok) return { ok: false };
  if (ready.kind === 'redirect') return { ok: true, next: ready.route };
  const owned = await readOwnedSignupReference(ready.userId, ready.email);
  if (!owned.ok)
    return owned.reason === 'gone' ? { ok: true, next: '/cadastro/continuar' } : { ok: false };
  if (
    owned.signupRef !== ready.signupRef ||
    (owned.credentialState !== null && owned.credentialState !== 'completed')
  )
    return { ok: false };
  if (owned.checkoutRecovery) return { ok: true, next: '/cadastro/pagamento?resultado=pending' };
  const billing = await readSignupBilling(ready.userId);
  if (!billing.ok) return { ok: false };
  if (billing.snapshot.state !== null && billing.snapshot.state !== 'failed')
    return { ok: true, next: '/cadastro/pagamento?resultado=pending' };
  const plan = await readSignupPlan(ready.userId);
  if (!plan.ok) return { ok: false };
  // The existing plan page preserves the selected plan and reuses a pending checkout.
  return { ok: true, next: '/cadastro/plano' };
}

/**
 * A code alone is insufficient: cookie, email HMAC, current epoch, expiry and
 * bounded attempts must all match. The provider token exists only in this call.
 */
export async function confirmSignupEmailCode(rawToken: string, input: unknown): Promise<Outcome> {
  const parsed = signupEmailCodeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: 'invalid' };
  if (!/^[A-Za-z0-9_-]{43}$/u.test(rawToken)) return { ok: false, reason: 'gone' };
  // A repeated click after a committed confirmation reuses the authenticated
  // result, never another OTP, password mutation, account or checkout.
  const ready = await resolveReadyOwnedSignupOnboarding();
  if (
    ready.ok &&
    ready.kind === 'pretenant' &&
    ready.signupRef === hashSignupToken(rawToken) &&
    ready.email.toLowerCase() === parsed.data.email.toLowerCase()
  ) {
    return resolveSignupContinuation().then(
      (result): Outcome => (result.ok ? result : { ok: false, reason: 'unavailable' }),
    );
  }
  const reservation = await reserveSignupEmailCode(rawToken, parsed.data);
  if (!reservation.ok) return reservation;
  let client: Awaited<ReturnType<typeof createServerClient>> | undefined;
  try {
    const account = await findAdminUserByEmail(parsed.data.email);
    if (account.kind !== 'found' || (await readAuthoritativeProfile(account.user.id))) {
      throw new Error('signup_code_identity_unavailable');
    }
    const binding = readSignupAuthBinding(account.user);
    // No adoption or credential replacement through an anonymous email/code request.
    if (
      !binding ||
      (binding.passwordState === 'set' && binding.signupRef !== reservation.signupRef)
    ) {
      throw new Error('signup_code_identity_mismatch');
    }
    const alreadyReady = binding.passwordState === 'set';
    if (
      binding.signupRef !== reservation.signupRef &&
      (await readSignupReferenceLiveness({
        userId: account.user.id,
        email: parsed.data.email,
        signupRef: binding.signupRef,
      })) !== 'gone'
    )
      throw new Error('signup_code_other_session_live');
    const initialPassword = hasInitialSignupPassword(account.user, reservation.signupRef);
    const admin = createAdminClient();
    const generated = await admin.auth.admin.generateLink({
      type: 'recovery',
      email: parsed.data.email,
    });
    if (
      generated.error ||
      generated.data.user.id !== account.user.id ||
      !generated.data.properties.hashed_token
    ) {
      throw new Error('signup_code_proof_unavailable');
    }
    await clearSupabaseSessionSelector();
    client = await createServerClient({ cookieWrites: 'required', newSession: true });
    const proof = await client.auth.verifyOtp({
      token_hash: generated.data.properties.hashed_token,
      type: 'recovery',
    });
    if (
      proof.error ||
      proof.data.user?.id !== account.user.id ||
      proof.data.user.email?.toLowerCase() !== parsed.data.email.toLowerCase() ||
      !proof.data.user.email_confirmed_at
    ) {
      throw new Error('signup_code_proof_rejected');
    }
    const identity = { userId: account.user.id, email: parsed.data.email };
    if (!alreadyReady) {
      const validation = await validateVerifiedSignupAuthUserForClaim(identity);
      if (!validation.ok) throw new Error('signup_code_claim_rejected');
    }
    const claimed = await ensureSignupDraftForVerifiedEmail(
      identity.userId,
      identity.email,
      reservation.signupRef,
    );
    if (!claimed.ok) throw new Error('signup_code_claim_unavailable');
    const bound = await ensureVerifiedSignupAuthBinding({
      ...identity,
      signupRef: reservation.signupRef,
    });
    if (!bound.ok) throw new Error('signup_code_binding_unavailable');
    if (initialPassword) {
      const current = await admin.auth.admin.getUserById(identity.userId);
      if (
        current.error ||
        !current.data.user ||
        !hasInitialSignupPassword(current.data.user, reservation.signupRef)
      ) {
        throw new Error('signup_code_credential_changed');
      }
      // No password reaches SQL or metadata. Auth already stored its bcrypt hash.
      const updated = await admin.auth.admin.updateUserById(identity.userId, {
        app_metadata: markSignupPasswordSet(current.data.user, reservation.signupRef),
      });
      if (updated.error || readSignupAuthBinding(updated.data.user)?.passwordState !== 'set') {
        throw new Error('signup_code_credential_unavailable');
      }
    }
    if (!(await finishSignupEmailCode(reservation.signupRef, reservation.epoch, 'verified'))) {
      throw new Error('signup_code_finalization_unavailable');
    }
    if (!initialPassword && !alreadyReady)
      return {
        ok: true,
        next: '/cadastro/confirmado',
        mailProof: { userId: identity.userId, signupRef: reservation.signupRef },
      };
    const continuation = await resolveSignupContinuation();
    if (!continuation.ok) throw new Error('signup_code_continuation_unavailable');
    return continuation;
  } catch {
    if (client) await client.auth.signOut({ scope: 'local' });
    await clearSupabaseSessionSelector();
    await finishSignupEmailCode(reservation.signupRef, reservation.epoch, 'uncertain');
    logger.warn('signup.code.confirmation_failed', { stage: 'confirmation' });
    return { ok: false, reason: 'unavailable' };
  }
}
