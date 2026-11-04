import 'server-only';

import { and, eq, gt, inArray, isNull, isNotNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';

import { signupSessions } from '@/contexts/onboarding/schema';
import { hashEmail } from '@/lib/auth/email-hash';
import { createAdminClient } from '@/lib/auth/supabase-admin';
import { dbAdmin } from '@/lib/db';

import { hashSignupToken } from './signup-session';
import { checkSignupEmailCode, SIGNUP_EMAIL_CODE_MAX_ATTEMPTS } from './signup-verification-policy';
import { reconcileSignupEmailDelivery } from './signup-email-delivery';

export const signupEmailCodeSchema = z
  .object({
    email: z.string().trim().max(160).email(),
    code: z.string().regex(/^\d{8}$/u),
  })
  .strict();

export async function bindPendingSignupCodeUser(input: {
  signupRef: string;
  attemptEpoch: number;
  userId: string;
  email: string;
}): Promise<void> {
  if (!z.string().uuid().safeParse(input.userId).success)
    throw new Error('[signup] invalid pending identity');
  const [row] = await dbAdmin
    .update(signupSessions)
    .set({ pendingAuthUserId: input.userId })
    .where(
      and(
        eq(signupSessions.tokenHash, input.signupRef),
        eq(signupSessions.emailHash, hashEmail(input.email)),
        eq(signupSessions.authAttemptedAt, new Date(input.attemptEpoch)),
        eq(signupSessions.verificationFlowVersion, 2),
        eq(signupSessions.status, 'email_pending'),
        eq(signupSessions.authAttemptState, 'reserved'),
        isNull(signupSessions.consumedAt),
      ),
    )
    .returning({ id: signupSessions.id });
  if (!row) throw new Error('[signup] stale pending identity');
}

/** Only the exact short-lived browser cookie may retrieve its own destination. */
export async function readSignupCodeDestination(rawToken: string): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]{43}$/u.test(rawToken)) return null;
  const [row] = await dbAdmin
    .select({ userId: signupSessions.pendingAuthUserId, emailHash: signupSessions.emailHash })
    .from(signupSessions)
    .where(
      and(
        eq(signupSessions.tokenHash, hashSignupToken(rawToken)),
        eq(signupSessions.verificationFlowVersion, 2),
        eq(signupSessions.status, 'email_pending'),
        isNull(signupSessions.consumedAt),
        gt(signupSessions.idleExpiresAt, sql`now()`),
        gt(signupSessions.absoluteExpiresAt, sql`now()`),
      ),
    )
    .limit(1);
  if (!row?.userId || !row.emailHash) return null;
  const account = await createAdminClient().auth.admin.getUserById(row.userId);
  const address = account.data.user?.email;
  if (account.error || !address || hashEmail(address) !== row.emailHash) return null;
  return address;
}

export type SignupCodeReservation =
  | { ok: true; signupRef: string; epoch: number }
  | { ok: false; reason: 'invalid' | 'expired' | 'locked' | 'conflict' | 'gone' };

/** The row lock serializes guessing, verification, resend and duplicate submissions. */
export async function reserveSignupEmailCode(
  rawToken: string,
  input: unknown,
): Promise<SignupCodeReservation> {
  const parsed = signupEmailCodeSchema.safeParse(input);
  if (!parsed.success || !/^[A-Za-z0-9_-]{43}$/u.test(rawToken))
    return { ok: false, reason: 'invalid' };
  const signupRef = hashSignupToken(rawToken);
  return dbAdmin.transaction(async (tx): Promise<SignupCodeReservation> => {
    const [row] = await tx
      .select({
        id: signupSessions.id,
        epoch: signupSessions.authAttemptedAt,
        expiresAt: signupSessions.emailCodeExpiresAt,
        attempts: signupSessions.emailCodeAttempts,
        codeState: signupSessions.emailCodeState,
        now: sql<string>`clock_timestamp()`,
      })
      .from(signupSessions)
      .where(
        and(
          eq(signupSessions.tokenHash, signupRef),
          eq(signupSessions.emailHash, hashEmail(parsed.data.email)),
          eq(signupSessions.verificationFlowVersion, 2),
          or(
            and(eq(signupSessions.status, 'email_pending'), isNull(signupSessions.consumedAt)),
            and(
              eq(signupSessions.status, 'email_verified'),
              isNotNull(signupSessions.authUserId),
              isNotNull(signupSessions.consumedAt),
              eq(signupSessions.emailCodeState, 'uncertain'),
            ),
          ),
          gt(signupSessions.absoluteExpiresAt, sql`now()`),
          inArray(signupSessions.authAttemptState, ['completed', 'uncertain']),
        ),
      )
      .for('update')
      .limit(1);
    if (!row?.epoch || !row.expiresAt) return { ok: false, reason: 'gone' };
    if (row.codeState === 'reserved' || row.codeState === 'verified') {
      return { ok: false, reason: 'conflict' };
    }
    const check = checkSignupEmailCode({
      signupRef,
      issuedAt: row.epoch,
      expiresAt: row.expiresAt,
      attempts: row.attempts,
      code: parsed.data.code,
      consumed: false,
      now: new Date(row.now),
    });
    if (!check.ok) {
      if (check.reason === 'invalid') {
        const attempts = Math.min(row.attempts + 1, SIGNUP_EMAIL_CODE_MAX_ATTEMPTS);
        await tx
          .update(signupSessions)
          .set({
            emailCodeAttempts: attempts,
            emailCodeState: attempts >= SIGNUP_EMAIL_CODE_MAX_ATTEMPTS ? 'locked' : 'issued',
          })
          .where(eq(signupSessions.id, row.id));
        return {
          ok: false,
          reason: attempts >= SIGNUP_EMAIL_CODE_MAX_ATTEMPTS ? 'locked' : 'invalid',
        };
      }
      return { ok: false, reason: check.reason === 'consumed' ? 'conflict' : check.reason };
    }
    await tx
      .update(signupSessions)
      .set({
        emailCodeState: 'reserved',
        emailCodeReservedAt: sql`now()`,
      })
      .where(eq(signupSessions.id, row.id));
    return { ok: true, signupRef, epoch: row.epoch.getTime() };
  });
}

/** A lost external response must not silently release the authority for another attempt. */
export async function finishSignupEmailCode(
  signupRef: string,
  epoch: number,
  outcome: 'verified' | 'uncertain',
): Promise<boolean> {
  const [row] = await dbAdmin
    .update(signupSessions)
    .set({
      emailCodeState: outcome,
      ...(outcome === 'verified' ? { emailCodeVerifiedAt: sql`now()` } : {}),
    })
    .where(
      and(
        eq(signupSessions.tokenHash, signupRef),
        eq(signupSessions.authAttemptedAt, new Date(epoch)),
        eq(signupSessions.emailCodeState, 'reserved'),
      ),
    )
    .returning({ id: signupSessions.id });
  return Boolean(row);
}

export async function readSignupCodeFlow(signupRef: string, epoch: number): Promise<boolean> {
  const [row] = await dbAdmin
    .select({ id: signupSessions.id })
    .from(signupSessions)
    .where(
      and(
        eq(signupSessions.tokenHash, signupRef),
        eq(signupSessions.authAttemptedAt, new Date(epoch)),
        eq(signupSessions.verificationFlowVersion, 2),
      ),
    )
    .limit(1);
  return Boolean(row);
}

export async function recordSignupCodeDelivery(input: {
  signupRef: string;
  attemptEpoch: number;
  messageId: string;
}): Promise<void> {
  if (!z.string().uuid().safeParse(input.messageId).success)
    throw new Error('[signup] invalid email receipt');
  const [row] = await dbAdmin
    .update(signupSessions)
    .set({
      confirmationMessageId: input.messageId,
      confirmationDeliveryStatus: 'sent',
      confirmationDeliveryAt: sql`now()`,
    })
    .where(
      and(
        eq(signupSessions.tokenHash, input.signupRef),
        eq(signupSessions.authAttemptedAt, new Date(input.attemptEpoch)),
      ),
    )
    .returning({ id: signupSessions.id });
  if (!row) throw new Error('[signup] stale email receipt');
  await reconcileSignupEmailDelivery(input.messageId);
}
