import 'server-only';

import { and, eq, gt, isNotNull, isNull, lte, sql } from 'drizzle-orm';
import { z } from 'zod';

/* eslint-disable boundaries/element-types -- ADR-027: signup orchestrates the tenant and its internal subscription. */
import { plans, prices, subscriptions } from '@/contexts/billing/schema';
import { OFFER_2026_PLAN_CODES } from '@/contexts/billing/proposed-offer';
import { profiles } from '@/contexts/identity/schema';
/* eslint-enable boundaries/element-types */
import { hashEmail } from '@/lib/auth/email-hash';
import { createServerClient } from '@/lib/auth/supabase-server';
import { dbAdmin, type Tx } from '@/lib/db';
import { hashForLookup } from '@/lib/crypto';
import { env } from '@/lib/env';
import { deferredSaasSignupEnabled } from '@/lib/payments/saas/acquisition';

import { signupSessions } from '../schema';
import { QORO_SELF_SERVICE_TRIAL_DAYS } from '../trial';
import { OnboardingProvisionError, provisionTenantCoreTx } from './saga';
import { resolveAvailableSlug } from './signup-provision';
import { resolveDeferredSignupTrialTerms } from './signup-deferred-trial';

export type FreeSignupTrialOutcome =
  | { ok: true; clinicId: string; state: 'provisioned' }
  | {
      ok: false;
      reason:
        | 'unavailable'
        | 'forbidden'
        | 'gone'
        | 'no_plan'
        | 'invalid_plan'
        | 'trial_used'
        | 'slug_unavailable'
        | 'legacy_checkout';
    };

const identitySchema = z.object({
  userId: z.uuid(),
  email: z.email().max(160),
  authCreatedAt: z.date(),
  storeId: z.string().regex(/^store_[A-Za-z0-9_-]+$/),
});
type TrialIdentity = z.infer<typeof identitySchema>;
const claimsSchema = z.array(z.object({ auth_user_id: z.uuid(), clinic_id: z.uuid().nullable() }));

/**
 * Transactional core for the authenticated signup only. No provider IO.
 * The caller supplies verified Auth/server data, never a request DTO.
 * Advisory locks serialize the same beneficiary across tabs and Auth retries.
 */
export async function provisionFreeSignupTrialTx(
  tx: Tx,
  verifiedIdentity: TrialIdentity,
): Promise<FreeSignupTrialOutcome> {
  const identity = identitySchema.parse(verifiedIdentity);
  const emailHash = hashEmail(identity.email);
  // The persistent eligibility marker uses the stable lookup salt, not the
  // rate-limit pepper (whose rotation intentionally invalidates short windows).
  const beneficiaryHash = await hashForLookup(identity.email.trim().toLowerCase());
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`signup-trial:${beneficiaryHash}`},0))`,
  );
  // Lock the profile identity as well: another session for this Auth user cannot
  // reassign an invited/admin/existing profile through provisionTenantCoreTx.
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`signup-owner:${identity.userId}`},0))`,
  );
  const claims = claimsSchema.parse(
    await tx.execute(sql`SELECT auth_user_id::text,clinic_id::text
      FROM billing_gateway.trial_claims
      WHERE auth_user_id=${identity.userId}::uuid OR email_hash=${beneficiaryHash} FOR UPDATE`),
  );
  const [profile] = await tx
    .select({ clinicId: profiles.clinicId, role: profiles.role, active: profiles.ativo })
    .from(profiles)
    .where(eq(profiles.id, identity.userId))
    .for('update')
    .limit(1);
  if (profile) {
    const ownClaim = claims.find((claim) => claim.auth_user_id === identity.userId);
    if (
      !profile.active ||
      profile.role !== 'owner' ||
      !profile.clinicId ||
      ownClaim?.clinic_id !== profile.clinicId
    )
      return { ok: false, reason: 'forbidden' };
    // Idempotent retry is tied to the same persisted origin, not the flag alone.
    const bound = z.array(z.object({ subscription_id: z.uuid() })).parse(
      await tx.execute(sql`SELECT b.subscription_id::text FROM billing_gateway.bindings b
        JOIN billing_gateway.accounts a ON a.id=b.account_id
        JOIN public.subscriptions s ON s.id=b.subscription_id AND s.clinic_id=b.clinic_id
        WHERE b.clinic_id=${profile.clinicId}::uuid AND a.provider='abacatepay'
          AND a.environment='sandbox' AND a.external_account_id=${identity.storeId}
          AND s.asaas_subscription_id IS NULL`),
    );
    return bound.length === 1
      ? { ok: true, state: 'provisioned', clinicId: profile.clinicId }
      : { ok: false, reason: 'forbidden' };
  }
  if (claims.length > 0) return { ok: false, reason: 'trial_used' };

  const [draft] = await tx
    .select()
    .from(signupSessions)
    .where(
      and(
        eq(signupSessions.authUserId, identity.userId),
        eq(signupSessions.emailHash, emailHash),
        eq(signupSessions.status, 'email_verified'),
        isNotNull(signupSessions.consumedAt),
        gt(signupSessions.absoluteExpiresAt, sql`now()`),
        gt(signupSessions.idleExpiresAt, sql`now()`),
      ),
    )
    .for('update')
    .limit(1);
  if (!draft?.ownerName || !draft.clinicName) return { ok: false, reason: 'gone' };
  if (
    draft.billingAttemptState ||
    draft.billingAttemptedAt ||
    draft.asaasCheckoutId ||
    draft.asaasCustomerId ||
    draft.asaasSubscriptionId
  )
    return { ok: false, reason: 'legacy_checkout' };
  if (!draft.selectedPlanId) return { ok: false, reason: 'no_plan' };
  if (draft.selectedBillingCycle !== 'monthly') return { ok: false, reason: 'invalid_plan' };
  const [price] = await tx
    .select({
      planId: plans.id,
      planCode: plans.code,
      priceId: prices.id,
      amount: prices.amount,
    })
    .from(plans)
    .innerJoin(
      prices,
      and(
        eq(prices.planId, plans.id),
        eq(prices.billingCycle, 'monthly'),
        eq(prices.currency, 'BRL'),
        lte(prices.activeFrom, sql`now()`),
        isNull(prices.activeUntil),
        isNull(prices.campaignCode),
      ),
    )
    .where(and(eq(plans.id, draft.selectedPlanId), eq(plans.ativo, true)))
    .for('share')
    .limit(1);
  if (!price || !OFFER_2026_PLAN_CODES.some((code) => code === price.planCode)) {
    return { ok: false, reason: 'invalid_plan' };
  }
  const terms = resolveDeferredSignupTrialTerms({
    planCode: price.planCode,
    authCreatedAt: identity.authCreatedAt,
    now: new Date(),
  });
  if (!terms) return { ok: false, reason: 'unavailable' };
  const slug = await resolveAvailableSlug(tx, draft.clinicName);
  if (!slug) return { ok: false, reason: 'slug_unavailable' };

  const provisioned = await provisionTenantCoreTx(
    tx,
    {
      clinic: { nome: draft.clinicName, slug },
      owner: { userId: identity.userId, nome: draft.ownerName },
      customer: { name: draft.ownerName, email: identity.email },
      planId: price.planId,
      planCode: price.planCode,
      priceId: price.priceId,
      priceAmount: Number(price.amount),
      billingCycle: 'monthly',
      trialDays: QORO_SELF_SERVICE_TRIAL_DAYS,
      trialEndsAt: terms.trialEndsAt,
      enforceTrialDeadline: true,
      rejectExistingOwner: true,
      billingProvider: 'abacatepay',
      asaasCustomerId: null,
      asaasSubscriptionId: null,
    },
    async (innerTx, clinicId) => {
      const [sub] = await innerTx
        .select({ id: subscriptions.id })
        .from(subscriptions)
        .where(eq(subscriptions.clinicId, clinicId))
        .limit(1);
      if (!sub)
        throw new OnboardingProvisionError(
          'Internal subscription missing',
          'trial_subscription_missing',
        );
      await innerTx.execute(sql`INSERT INTO billing_gateway.accounts(provider,environment,external_account_id)
      VALUES('abacatepay','sandbox',${identity.storeId}) ON CONFLICT DO NOTHING`);
      await innerTx.execute(sql`INSERT INTO billing_gateway.bindings(subscription_id,clinic_id,account_id)
      SELECT ${sub.id}::uuid,${clinicId}::uuid,id FROM billing_gateway.accounts
      WHERE provider='abacatepay' AND environment='sandbox' AND external_account_id=${identity.storeId}`);
      await innerTx.execute(sql`INSERT INTO billing_gateway.trial_claims
      (auth_user_id,email_hash,clinic_id,auth_created_at,trial_ends_at)
      VALUES(${identity.userId}::uuid,${beneficiaryHash},${clinicId}::uuid,
        ${identity.authCreatedAt.toISOString()}::timestamptz,${terms.trialEndsAt.toISOString()}::timestamptz)`);
      const [consumed] = await innerTx
        .delete(signupSessions)
        .where(
          and(
            eq(signupSessions.id, draft.id),
            eq(signupSessions.authUserId, identity.userId),
            isNull(signupSessions.billingAttemptState),
            isNull(signupSessions.billingAttemptedAt),
          ),
        )
        .returning({ id: signupSessions.id });
      if (!consumed)
        throw new OnboardingProvisionError(
          'Signup concurrently changed',
          'signup_already_provisioned',
        );
      if (terms.stage === 'payment_required') {
        // The tenant may be provisioned late, but it never receives a fresh trial.
        await innerTx.execute(sql`UPDATE public.clinics SET status='suspended',updated_at=now()
        WHERE id=${clinicId}::uuid`);
      }
    },
  );
  return { ok: true, state: 'provisioned', clinicId: provisioned.clinicId };
}

export async function provisionFreeSignupTrial(input: {
  userId: string;
  verifiedEmail: string;
}): Promise<FreeSignupTrialOutcome> {
  if (!env.SIGNUP_AUTH_ENABLED || !env.SIGNUP_IDENTITY_ENABLED || !deferredSaasSignupEnabled()) {
    return { ok: false, reason: 'unavailable' };
  }
  const { data, error } = await (await createServerClient()).auth.getUser();
  const user = data.user;
  if (
    error ||
    !user ||
    user.id !== input.userId ||
    !user.email ||
    !user.email_confirmed_at ||
    !Number.isFinite(Date.parse(user.email_confirmed_at)) ||
    user.invited_at ||
    user.banned_until ||
    user.email.trim().toLowerCase() !== input.verifiedEmail.trim().toLowerCase()
  )
    return { ok: false, reason: 'forbidden' };
  const parsed = identitySchema.safeParse({
    userId: user.id,
    email: user.email,
    authCreatedAt: new Date(user.created_at),
    storeId: env.ABACATEPAY_STORE_ID,
  });
  if (!parsed.success) return { ok: false, reason: 'unavailable' };
  return dbAdmin.transaction((tx) => provisionFreeSignupTrialTx(tx, parsed.data));
}
