import 'server-only';

import { randomBytes } from 'node:crypto';

import { and, eq, gt, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';
import { z } from 'zod';

import { signupSessions } from '@/contexts/onboarding/schema';
import { hashEmail } from '@/lib/auth/email-hash';
import { dbAdmin } from '@/lib/db';
import { env } from '@/lib/env';

import { signupAnswerValuesSchema, type SignupAnswerValues } from './signup-answer-values';
import {
  hashSignupToken,
  SIGNUP_ABSOLUTE_TTL_SECONDS,
  SIGNUP_IDLE_TTL_SECONDS,
  signupNameSchema,
} from './signup-session';

const userIdSchema = z.string().uuid();
const verifiedEmailSchema = z.string().max(160).email();
const confirmedFields = {
  ownerName: signupNameSchema,
  clinicName: signupNameSchema,
  answers: signupAnswerValuesSchema,
  accepted: z.literal(true),
};

export const signupDraftMutationSchema = z.discriminatedUnion('mode', [
  z
    .object({
      mode: z.literal('link'),
      rowVersion: z.number().int().min(1).max(2_147_483_646),
      ...confirmedFields,
    })
    .strict(),
  z.object({ mode: z.literal('restart'), ...confirmedFields }).strict(),
]);

export interface SignupDraftState {
  status: 'email_verified';
  rowVersion: number;
  ownerName: string;
  clinicName: string;
  answers: SignupAnswerValues;
  idleExpiresAt: string;
  absoluteExpiresAt: string;
}

type DraftOutcome =
  | { ok: true; rowVersion: number }
  | { ok: false; reason: 'gone' | 'conflict' | 'unavailable' };
type DraftReadOutcome =
  | { ok: true; draft: SignupDraftState }
  | { ok: false; reason: 'gone' | 'unavailable' };

function enabled(): boolean {
  return env.SIGNUP_AUTH_ENABLED && env.SIGNUP_IDENTITY_ENABLED;
}

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  if ('code' in error && error.code === '23505') return true;
  return (
    'cause' in error &&
    typeof error.cause === 'object' &&
    error.cause !== null &&
    'code' in error.cause &&
    error.cause.code === '23505'
  );
}

function ownerDraftCondition(userId: string) {
  return and(
    eq(signupSessions.authUserId, userId),
    eq(signupSessions.status, 'email_verified'),
    isNotNull(signupSessions.consumedAt),
    gt(signupSessions.idleExpiresAt, sql`now()`),
    gt(signupSessions.absoluteExpiresAt, sql`now()`),
  );
}

/** Leitura autenticada, sem renovar nenhum dos dois TTLs. */
export async function readSignupDraft(userId: string): Promise<DraftReadOutcome> {
  if (!enabled() || !userIdSchema.safeParse(userId).success)
    return { ok: false, reason: 'unavailable' };
  const [row] = await dbAdmin
    .select({
      rowVersion: signupSessions.rowVersion,
      ownerName: signupSessions.ownerName,
      clinicName: signupSessions.clinicName,
      professionalsBand: signupSessions.professionalsBand,
      weeklyAppointmentsBand: signupSessions.weeklyAppointmentsBand,
      currentTooling: signupSessions.currentTooling,
      discoverySource: signupSessions.discoverySource,
      idleExpiresAt: signupSessions.idleExpiresAt,
      absoluteExpiresAt: signupSessions.absoluteExpiresAt,
    })
    .from(signupSessions)
    .where(ownerDraftCondition(userId))
    .limit(1);
  if (!row) return { ok: false, reason: 'gone' };
  const answers = signupAnswerValuesSchema.safeParse({
    professionalsBand: row.professionalsBand,
    weeklyAppointmentsBand: row.weeklyAppointmentsBand,
    currentTooling: row.currentTooling,
    discoverySource: row.discoverySource,
  });
  if (!answers.success || !row.ownerName || !row.clinicName) {
    return { ok: false, reason: 'unavailable' };
  }
  return {
    ok: true,
    draft: {
      status: 'email_verified',
      rowVersion: row.rowVersion,
      ownerName: row.ownerName,
      clinicName: row.clinicName,
      answers: answers.data,
      idleExpiresAt: row.idleExpiresAt.toISOString(),
      absoluteExpiresAt: row.absoluteExpiresAt.toISOString(),
    },
  };
}

export interface WriteSignupDraftInput {
  userId: string;
  email: string;
  rawToken: string | null;
  input: unknown;
}

/** Link CAS ou restart do próprio owner; nunca cria profile, tenant, role ou plano. */
export async function writeSignupDraft(args: WriteSignupDraftInput): Promise<DraftOutcome> {
  if (!enabled()) return { ok: false, reason: 'unavailable' };
  const identity = z
    .object({ userId: userIdSchema, email: verifiedEmailSchema })
    .safeParse({ userId: args.userId, email: args.email });
  const input = signupDraftMutationSchema.safeParse(args.input);
  if (!identity.success || !input.success) throw new Error('[signup] invalid_draft');

  try {
    return await dbAdmin.transaction(async (tx) => {
      const { userId, email } = identity.data;
      const data = input.data;
      if (data.mode === 'link') {
        if (!args.rawToken || !/^[A-Za-z0-9_-]{43}$/u.test(args.rawToken)) {
          return { ok: false, reason: 'gone' };
        }
        const tokenHash = hashSignupToken(args.rawToken);
        const [saved] = await tx
          .update(signupSessions)
          .set({
            status: 'email_verified',
            authUserId: userId,
            consumedAt: sql`now()`,
            ownerName: data.ownerName,
            clinicName: data.clinicName,
            emailHash: hashEmail(email),
            acceptedAt: sql`now()`,
            professionalsBand: data.answers.professionalsBand,
            weeklyAppointmentsBand: data.answers.weeklyAppointmentsBand,
            currentTooling: data.answers.currentTooling,
            discoverySource: data.answers.discoverySource,
            answeredAt: sql`now()`,
            rowVersion: sql`${signupSessions.rowVersion} + 1`,
          })
          .where(
            and(
              eq(signupSessions.tokenHash, tokenHash),
              eq(signupSessions.status, 'email_pending'),
              eq(signupSessions.emailHash, hashEmail(email)),
              eq(signupSessions.rowVersion, data.rowVersion),
              isNull(signupSessions.authUserId),
              isNull(signupSessions.consumedAt),
              gt(signupSessions.idleExpiresAt, sql`now()`),
              gt(signupSessions.absoluteExpiresAt, sql`now()`),
            ),
          )
          .returning({ rowVersion: signupSessions.rowVersion });
        if (saved) return { ok: true, rowVersion: saved.rowVersion };

        const [owned] = await tx
          .select({ id: signupSessions.id })
          .from(signupSessions)
          .where(eq(signupSessions.authUserId, userId))
          .limit(1);
        if (owned) return { ok: false, reason: 'conflict' };
        const [original] = await tx
          .select({ id: signupSessions.id })
          .from(signupSessions)
          .where(
            and(
              eq(signupSessions.tokenHash, tokenHash),
              eq(signupSessions.status, 'email_pending'),
              isNull(signupSessions.consumedAt),
              gt(signupSessions.idleExpiresAt, sql`now()`),
              gt(signupSessions.absoluteExpiresAt, sql`now()`),
            ),
          )
          .limit(1);
        return { ok: false, reason: original ? 'conflict' : 'gone' };
      }

      await tx
        .delete(signupSessions)
        .where(
          and(
            eq(signupSessions.authUserId, userId),
            or(
              lte(signupSessions.idleExpiresAt, sql`now()`),
              lte(signupSessions.absoluteExpiresAt, sql`now()`),
            ),
          ),
        );
      const [owned] = await tx
        .select({ id: signupSessions.id })
        .from(signupSessions)
        .where(eq(signupSessions.authUserId, userId))
        .limit(1);
      if (owned) return { ok: false, reason: 'conflict' };

      const [created] = await tx
        .insert(signupSessions)
        .values({
          tokenHash: hashSignupToken(randomBytes(32).toString('base64url')),
          status: 'email_verified',
          authUserId: userId,
          consumedAt: sql`now()`,
          ownerName: data.ownerName,
          clinicName: data.clinicName,
          emailHash: hashEmail(email),
          acceptedAt: sql`now()`,
          professionalsBand: data.answers.professionalsBand,
          weeklyAppointmentsBand: data.answers.weeklyAppointmentsBand,
          currentTooling: data.answers.currentTooling,
          discoverySource: data.answers.discoverySource,
          answeredAt: sql`now()`,
          idleExpiresAt: sql`now() + make_interval(secs => ${SIGNUP_IDLE_TTL_SECONDS})`,
          absoluteExpiresAt: sql`now() + make_interval(secs => ${SIGNUP_ABSOLUTE_TTL_SECONDS})`,
        })
        .returning({ rowVersion: signupSessions.rowVersion });
      if (!created) throw new Error('[signup] draft_insert_failed');
      return { ok: true, rowVersion: created.rowVersion };
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, reason: 'conflict' };
    throw error;
  }
}
