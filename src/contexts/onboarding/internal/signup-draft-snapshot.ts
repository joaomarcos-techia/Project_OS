import 'server-only';

import { sql } from 'drizzle-orm';
import { z } from 'zod';

import { signupSessions } from '@/contexts/onboarding/schema';
import { hashEmail } from '@/lib/auth/email-hash';
import { dbAdmin } from '@/lib/db';
import { logger } from '@/lib/observability/logger';

import {
  CURRENT_TOOLING,
  DISCOVERY_SOURCES,
  PROFESSIONALS_BANDS,
  WEEKLY_APPOINTMENT_BANDS,
} from './signup-answer-values';
import { readSignupAuthBinding } from './signup-auth-binding';
import { SIGNUP_ABSOLUTE_TTL_SECONDS, signupNameSchema } from './signup-session';

const SNAPSHOT_MAX_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

/** Only the previously protected lead snapshot format. No credential, token or billing payload. */
export const signupDraftSnapshotSchema = z
  .object({
    version: z.literal(1),
    purpose: z.literal('Authorized lead-04 onboarding recovery; not account authority'),
    capturedAt: z.iso.datetime(),
    retainUntil: z.iso.datetime(),
    data: z
      .object({
        user_id: z.string().uuid(),
        auth_created_at: z.iso.datetime(),
        owner_name: signupNameSchema,
        clinic_name: signupNameSchema,
        email_hash: z.string().regex(/^[a-f0-9]{64}$/u),
        accepted_at: z.iso.datetime(),
        professionals_band: z.enum(PROFESSIONALS_BANDS),
        weekly_appointments_band: z.enum(WEEKLY_APPOINTMENT_BANDS),
        current_tooling: z.enum(CURRENT_TOOLING),
        discovery_source: z.enum(DISCOVERY_SOURCES),
        answered_at: z.iso.datetime(),
        // This particular snapshot had no selected plan. Never invent or restore billing.
        selected_plan_id: z.null(),
        selected_billing_cycle: z.literal('monthly'),
      })
      .strict(),
  })
  .strict();

type RestoreOutcome =
  | { ok: true; state: 'restored' | 'already_present' }
  | {
      ok: false;
      reason: 'invalid_snapshot' | 'identity_changed' | 'existing_progress' | 'unavailable';
    };

/**
 * Operator-only seam, not a route or action. The operator must decrypt the approved DPAPI
 * snapshot in memory and have authorization for the target environment before calling it.
 * Never changes Auth, passwords, trial birth, existing drafts or financial records.
 */
export async function restoreSignupDraftSnapshot(input: unknown): Promise<RestoreOutcome> {
  const parsed = signupDraftSnapshotSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: 'invalid_snapshot' };
  const snapshot = parsed.data;
  const data = snapshot.data;
  const now = new Date();
  const capturedAt = new Date(snapshot.capturedAt);
  const retainUntil = new Date(snapshot.retainUntil);
  const authCreatedAt = new Date(data.auth_created_at);
  const acceptedAt = new Date(data.accepted_at);
  const answeredAt = new Date(data.answered_at);
  if (
    capturedAt > now ||
    authCreatedAt > capturedAt ||
    acceptedAt > capturedAt ||
    answeredAt > capturedAt ||
    retainUntil <= now ||
    retainUntil.getTime() > authCreatedAt.getTime() + SNAPSHOT_MAX_RETENTION_MS
  )
    return { ok: false, reason: 'invalid_snapshot' };

  try {
    return await dbAdmin.transaction(async (tx) => {
      await tx.execute(sql`set local lock_timeout = '3s'`);
      await tx.execute(sql`set local statement_timeout = '10s'`);
      // Short, bounded operator transaction: exclude provisioning/draft/invite writers.
      await tx.execute(
        sql`lock table public.signup_sessions, public.profiles, public.clinic_invites in share row exclusive mode`,
      );
      const [user] = await tx.execute<{
        email: string;
        metadata: unknown;
        confirmed: boolean;
        has_password: boolean;
      }>(sql`select email, raw_app_meta_data as metadata,
          email_confirmed_at is not null as confirmed,
          coalesce(length(encrypted_password), 0) > 0
            and invited_at is null and deleted_at is null
            and (banned_until is null or banned_until <= now()) as has_password
        from auth.users where id=${data.user_id}::uuid
          and date_trunc('milliseconds', created_at)=${data.auth_created_at}::timestamptz
        for update`);
      const binding = user ? readSignupAuthBinding({ app_metadata: user.metadata }) : null;
      if (
        !user?.email ||
        !user.confirmed ||
        !user.has_password ||
        binding?.passwordState !== 'set' ||
        hashEmail(user.email) !== data.email_hash
      )
        return { ok: false, reason: 'identity_changed' };

      const [converted] = await tx.execute<{ present: boolean }>(sql`
        select exists(select 1 from public.profiles where id=${data.user_id}::uuid)
          or exists(select 1 from public.clinic_invites
            where lower(trim(email))=lower(trim(${user.email}))) as present`);
      if (converted?.present) return { ok: false, reason: 'existing_progress' };

      const existing = await tx.execute<{ identical: boolean }>(sql`
        select auth_user_id=${data.user_id}::uuid and token_hash=${binding.signupRef}
          and status='email_verified' and consumed_at is not null
          and owner_name=${data.owner_name} and clinic_name=${data.clinic_name}
          and email_hash=${data.email_hash} and accepted_at=${data.accepted_at}::timestamptz
          and professionals_band=${data.professionals_band}
          and weekly_appointments_band=${data.weekly_appointments_band}
          and current_tooling=${data.current_tooling} and discovery_source=${data.discovery_source}
          and answered_at=${data.answered_at}::timestamptz
          and recovery_expires_at=${snapshot.retainUntil}::timestamptz
          and selected_plan_id is null and selected_billing_cycle='monthly'
          and billing_attempt_state is null and billing_attempted_at is null
          and asaas_customer_id is null and asaas_checkout_id is null
          and asaas_checkout_url is null and asaas_subscription_id is null
          and billing_failure_code is null as identical
        from public.signup_sessions where auth_user_id=${data.user_id}::uuid
          or pending_auth_user_id=${data.user_id}::uuid or email_hash=${data.email_hash}
          or token_hash=${binding.signupRef}`);
      if (existing.length > 0)
        return existing.length === 1 && existing[0]?.identical === true
          ? { ok: true, state: 'already_present' }
          : { ok: false, reason: 'existing_progress' };

      const expiresAt = sql`least(now() + make_interval(secs => ${SIGNUP_ABSOLUTE_TTL_SECONDS}), ${snapshot.retainUntil}::timestamptz)`;
      await tx.insert(signupSessions).values({
        tokenHash: binding.signupRef,
        authUserId: data.user_id,
        status: 'email_verified',
        consumedAt: sql`now()`,
        ownerName: data.owner_name,
        clinicName: data.clinic_name,
        emailHash: data.email_hash,
        acceptedAt,
        professionalsBand: data.professionals_band,
        weeklyAppointmentsBand: data.weekly_appointments_band,
        currentTooling: data.current_tooling,
        discoverySource: data.discovery_source,
        answeredAt,
        recoveryExpiresAt: retainUntil,
        idleExpiresAt: expiresAt,
        absoluteExpiresAt: expiresAt,
      });
      return { ok: true, state: 'restored' };
    });
  } catch {
    logger.error('signup.snapshot_restore.failed', { reason: 'transaction_unavailable' });
    return { ok: false, reason: 'unavailable' };
  }
}
