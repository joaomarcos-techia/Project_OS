import 'server-only';

import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import { dbAdmin, type Tx } from '@/lib/db';
import type { User } from '@supabase/supabase-js';
import { createServerClient } from '@/lib/auth/supabase-server';
import { hashEmail } from '@/lib/auth/email-hash';
import { env } from '@/lib/env';
import { clinicInvites, signupSessions } from '../schema';
import { hashToken } from './token';
import {
  createSignupSession,
  hashSignupToken,
  readSignupSession,
  type CreateSignupSessionInput,
} from './signup-session';
import { provisionFreeSignupTrialTx } from './signup-free-trial';
import { readSignupAuthBinding } from './signup-auth-binding';
import { readSignupPlan, signupPlanMutationSchema } from './signup-draft';
import {
  assertLivePilot,
  parsePilot,
  pilotForUser,
  PilotSignupError,
} from './signup-pilot-repository';

export const PILOT_INVITE_COOKIE = '__Host-qoro_pilot';
const inviteTokenSchema = z.string().regex(/^[a-f0-9]{64}$/u);

/** One invite admits one random browser session; possession of the link never proves email. */
export async function bootstrapPilotSignup(input: {
  inviteToken: string;
  existingSession: string | null;
  request: CreateSignupSessionInput;
}) {
  const raw = inviteTokenSchema.parse(input.inviteToken);
  if (!env.SIGNUP_AUTH_ENABLED || !env.SIGNUP_IDENTITY_ENABLED)
    throw new PilotSignupError('unavailable');
  return dbAdmin
    .transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(clinicInvites)
        .where(eq(clinicInvites.tokenHash, hashToken(raw)))
        .for('update', { noWait: true })
        .limit(1);
      if (!row) throw new PilotSignupError('forbidden');
      const grant = parsePilot(row);
      assertLivePilot(grant);
      const identity = {
        ownerName: grant.metadata.ownerName,
        clinicName: grant.metadata.clinicName,
        email: grant.email,
      };
      if (grant.metadata.signupRef) {
        if (
          !input.existingSession ||
          !/^[A-Za-z0-9_-]{43}$/u.test(input.existingSession) ||
          hashSignupToken(input.existingSession) !== grant.metadata.signupRef
        )
          throw new PilotSignupError('conflict');
        const state = await readSignupSession(input.existingSession, { tx });
        if (!state) throw new PilotSignupError('expired');
        return { ok: true as const, rawToken: input.existingSession, state, identity };
      }
      const session = await createSignupSession(input.request, { tx });
      if (!session.ok) return session;
      await tx
        .update(clinicInvites)
        .set({
          status: 'started',
          startedAt: sql`now()`,
          version: sql`${clinicInvites.version}+1`,
          metadata: { ...grant.metadata, signupRef: hashSignupToken(session.rawToken) },
        })
        .where(eq(clinicInvites.id, grant.id));
      return { ...session, identity };
    })
    .catch((error: unknown) => {
      const cause = error instanceof Error && error.cause ? error.cause : error;
      if (typeof cause === 'object' && cause !== null && 'code' in cause && cause.code === '55P03')
        throw new PilotSignupError('conflict');
      throw error;
    });
}

/** Additive DTO: the usual plan screen and mutation remain in use, with a server-pinned choice. */
export async function readPilotSignupPlan(userId: string) {
  const grant = await pilotForUser(userId);
  if (!grant) return null;
  const result = await readSignupPlan(userId);
  if (!result.ok) return result;
  const selected = result.state.plans.filter(
    (p) =>
      p.id === grant.price.planId &&
      p.code === grant.price.code &&
      p.cycle === 'monthly' &&
      p.priceCents === grant.price.amountMinor,
  );
  if (selected.length !== 1) throw new PilotSignupError('unavailable');
  return {
    ok: true as const,
    state: {
      ...result.state,
      plans: selected,
      signupFlow: 'trial_first' as const,
      pilot: true as const,
    },
  };
}

export async function pilotPlanSelectionAllowed(userId: string, input: unknown): Promise<boolean> {
  const grant = await pilotForUser(userId);
  if (!grant) return true;
  const parsed = signupPlanMutationSchema.safeParse(input);
  return (
    parsed.success && parsed.data.planId === grant.price.planId && parsed.data.cycle === 'monthly'
  );
}

/** No provider IO. The normal code/password proof must be complete before this transaction. */
export async function provisionPilotSignup(inviteToken: string) {
  inviteTokenSchema.parse(inviteToken);
  if (!env.SIGNUP_AUTH_ENABLED || !env.SIGNUP_IDENTITY_ENABLED || !env.ABACATEPAY_STORE_ID)
    throw new PilotSignupError('unavailable');
  const { data, error } = await (await createServerClient()).auth.getUser();
  const user = data.user;
  if (error || !user) throw new PilotSignupError('forbidden');
  return dbAdmin.transaction((tx) => provisionPilotSignupTx(tx, inviteToken, user));
}

/** Trusted server core, also exercised against the real isolated PostgreSQL schema. */
export async function provisionPilotSignupTx(
  tx: Tx,
  inviteToken: string,
  user: Pick<
    User,
    | 'id'
    | 'email'
    | 'email_confirmed_at'
    | 'created_at'
    | 'invited_at'
    | 'banned_until'
    | 'app_metadata'
  >,
) {
  inviteTokenSchema.parse(inviteToken);
  if (env.ABACATEPAY_PILOT_PROVISIONING_ENABLED !== true || !env.ABACATEPAY_STORE_ID)
    throw new PilotSignupError('unavailable');
  if (
    !user?.email ||
    !user.email_confirmed_at ||
    !Number.isFinite(Date.parse(user.email_confirmed_at)) ||
    user.invited_at ||
    user.banned_until ||
    readSignupAuthBinding(user)?.passwordState !== 'set'
  )
    throw new PilotSignupError('forbidden');
  {
    const [row] = await tx
      .select()
      .from(clinicInvites)
      .where(eq(clinicInvites.tokenHash, hashToken(inviteToken)))
      .for('update')
      .limit(1);
    if (!row) throw new PilotSignupError('forbidden');
    const grant = parsePilot(row);
    if (
      grant.metadata.emailHash !== hashEmail(user.email!) ||
      grant.metadata.signupRef !== readSignupAuthBinding(user)?.signupRef
    )
      throw new PilotSignupError('forbidden');
    if (grant.status === 'completed') {
      if (grant.metadata.authUserId !== user.id || !grant.provisionedClinicId)
        throw new PilotSignupError('forbidden');
    } else {
      assertLivePilot(grant);
      const [draft] = await tx
        .select()
        .from(signupSessions)
        .where(
          and(
            eq(signupSessions.authUserId, user.id),
            eq(signupSessions.tokenHash, grant.metadata.signupRef),
          ),
        )
        .for('update')
        .limit(1);
      if (
        !draft ||
        draft.clinicName !== grant.metadata.clinicName ||
        draft.ownerName !== grant.metadata.ownerName ||
        draft.emailHash !== grant.metadata.emailHash ||
        draft.selectedPlanId !== grant.price.planId ||
        draft.selectedBillingCycle !== 'monthly'
      )
        throw new PilotSignupError('forbidden');
      const current =
        await tx.execute(sql`SELECT 1 FROM public.prices WHERE id=${grant.price.priceId}::uuid
        AND plan_id=${grant.price.planId}::uuid AND amount*100=${grant.price.amountMinor}
        AND currency='BRL' AND billing_cycle='monthly' AND campaign_code IS NULL AND active_until IS NULL AND active_from<=now() FOR SHARE`);
      if (current.length !== 1) throw new PilotSignupError('unavailable');
    }
    const outcome = await provisionFreeSignupTrialTx(tx, {
      userId: user.id,
      email: user.email!,
      authCreatedAt: new Date(user.created_at),
      storeId: env.ABACATEPAY_STORE_ID!,
    });
    if (!outcome.ok)
      throw new PilotSignupError(outcome.reason === 'forbidden' ? 'forbidden' : 'conflict');
    if (grant.status !== 'completed') {
      const consistent = await tx.execute(sql`SELECT 1 FROM public.subscriptions s
        JOIN public.prices pr ON pr.id=s.price_id JOIN public.plan_seat_limits sl ON sl.plan_id=s.plan_id
        WHERE s.clinic_id=${outcome.clinicId}::uuid AND s.plan_id=${grant.price.planId}::uuid
          AND s.price_id=${grant.price.priceId}::uuid AND s.billing_provider='abacatepay'
          AND s.asaas_subscription_id IS NULL AND s.billing_status='trial'
          AND pr.amount*100=${grant.price.amountMinor} AND sl.doctors=1 AND sl.staff=3`);
      if (consistent.length !== 1) throw new PilotSignupError('conflict');
    }
    if (grant.status === 'completed' && grant.provisionedClinicId !== outcome.clinicId)
      throw new PilotSignupError('conflict');
    if (grant.status !== 'completed')
      await tx
        .update(clinicInvites)
        .set({
          status: 'completed',
          completedAt: sql`now()`,
          provisionedClinicId: outcome.clinicId,
          version: sql`${clinicInvites.version}+1`,
          metadata: { ...grant.metadata, authUserId: user.id },
        })
        .where(eq(clinicInvites.id, grant.id));
    return { state: 'provisioned' as const };
  }
}
