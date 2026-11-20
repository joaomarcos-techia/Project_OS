import 'server-only';

import { and, eq, isNull, lte, sql } from 'drizzle-orm';
import { z } from 'zod';

/* eslint-disable boundaries/element-types -- approved onboarding reads the SaaS catalog. */
import { plans, prices } from '@/contexts/billing/schema';
import { PROPOSED_OFFER } from '@/contexts/billing/proposed-offer';
/* eslint-enable boundaries/element-types */
import { dbAdmin, type Tx } from '@/lib/db';
import { hashEmail } from '@/lib/auth/email-hash';
import { env } from '@/lib/env';
import { isAbacatePayRuntime } from '@/lib/payments/saas/acquisition';
import { clinicInvites, signupSessions } from '../schema';

export const PILOT_KIND = 'abacatepay_pilot_v1';
export const pilotIdentitySchema = z
  .object({
    ownerName: z.string().trim().min(1).max(120),
    clinicName: z.string().trim().min(1).max(120),
    email: z
      .email()
      .max(160)
      .transform((v) => v.trim().toLowerCase()),
  })
  .strict();
export const pilotMetadataSchema = z
  .object({
    kind: z.literal(PILOT_KIND),
    ownerName: z.string().min(1).max(120),
    clinicName: z.string().min(1).max(120),
    emailHash: z.string().regex(/^[a-f0-9]{64}$/u),
    signupRef: z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .nullable(),
    authUserId: z.uuid().nullable(),
  })
  .strict();
export const pilotPriceSchema = z
  .object({
    planId: z.uuid(),
    priceId: z.uuid(),
    code: z.literal('consultorio_2026'),
    amountMinor: z.literal(PROPOSED_OFFER.consultorioMonthly * 100),
    currency: z.literal('BRL'),
    cycle: z.literal('monthly'),
  })
  .strict();

export class PilotSignupError extends Error {
  constructor(readonly code: 'unavailable' | 'invalid' | 'expired' | 'conflict' | 'forbidden') {
    super(`Pilot signup: ${code}`);
    this.name = 'PilotSignupError';
  }
}

export function parsePilot(row: typeof clinicInvites.$inferSelect) {
  const metadata = pilotMetadataSchema.safeParse(row.metadata);
  const price = pilotPriceSchema.safeParse(row.planSnapshot);
  if (
    !metadata.success ||
    !price.success ||
    !row.email ||
    hashEmail(row.email) !== metadata.data.emailHash
  )
    throw new PilotSignupError('invalid');
  return { ...row, email: row.email, metadata: metadata.data, price: price.data };
}
export type PilotGrant = ReturnType<typeof parsePilot>;

export function assertLivePilot(grant: PilotGrant): void {
  if (env.ABACATEPAY_PILOT_PROVISIONING_ENABLED !== true || !isAbacatePayRuntime())
    throw new PilotSignupError('unavailable');
  if (grant.expiresAt.getTime() <= Date.now()) throw new PilotSignupError('expired');
  if (!['pending', 'started'].includes(grant.status)) throw new PilotSignupError('forbidden');
}

/** Runs inside the audited superadmin transaction. A global lock pins this to one pilot. */
export async function issuePilotInviteTx(
  tx: Tx,
  input: {
    identity: z.infer<typeof pilotIdentitySchema>;
    createdBy: string;
    tokenHash: string;
  },
) {
  if (env.ABACATEPAY_PILOT_PROVISIONING_ENABLED !== true || !isAbacatePayRuntime())
    throw new PilotSignupError('unavailable');
  const identity = pilotIdentitySchema.parse(input.identity);
  z.uuid().parse(input.createdBy);
  z.string()
    .regex(/^[a-f0-9]{64}$/u)
    .parse(input.tokenHash);
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('qoro:saas-pilot:v1',0))`);
  const existing = await tx
    .select()
    .from(clinicInvites)
    .where(
      sql`${clinicInvites.metadata}->>'kind'=${PILOT_KIND} AND ${clinicInvites.status} <> 'cancelled'`,
    )
    .for('update')
    .limit(1);
  if (existing[0]) {
    const grant = parsePilot(existing[0]);
    if (
      grant.email.toLowerCase() !== identity.email ||
      grant.metadata.clinicName !== identity.clinicName ||
      grant.metadata.ownerName !== identity.ownerName
    )
      throw new PilotSignupError('conflict');
    return { id: grant.id, created: false };
  }
  const occupied = await tx.execute(
    sql`SELECT 1 FROM auth.users WHERE lower(email)=${identity.email} LIMIT 1`,
  );
  if (occupied.length) throw new PilotSignupError('conflict');
  const duplicate = await tx
    .select({ id: clinicInvites.id })
    .from(clinicInvites)
    .where(
      sql`lower(${clinicInvites.email})=${identity.email} AND ${clinicInvites.status} IN ('pending','started') AND ${clinicInvites.expiresAt}>now()`,
    )
    .limit(1);
  const clinic = await tx.execute(
    sql`SELECT 1 FROM public.clinics WHERE lower(nome)=lower(${identity.clinicName}) LIMIT 1`,
  );
  if (duplicate.length || clinic.length) throw new PilotSignupError('conflict');
  const catalog = await tx
    .select({ planId: plans.id, priceId: prices.id, code: plans.code, amount: prices.amount })
    .from(plans)
    .innerJoin(prices, eq(prices.planId, plans.id))
    .where(
      and(
        eq(plans.code, 'consultorio_2026'),
        eq(plans.ativo, true),
        eq(prices.billingCycle, 'monthly'),
        eq(prices.currency, 'BRL'),
        isNull(prices.campaignCode),
        isNull(prices.activeUntil),
        lte(prices.activeFrom, sql`now()`),
      ),
    )
    .for('share');
  if (catalog.length !== 1 || Number(catalog[0]!.amount) !== PROPOSED_OFFER.consultorioMonthly)
    throw new PilotSignupError('unavailable');
  const item = catalog[0]!;
  const price = pilotPriceSchema.parse({
    planId: item.planId,
    priceId: item.priceId,
    code: item.code,
    amountMinor: PROPOSED_OFFER.consultorioMonthly * 100,
    currency: 'BRL',
    cycle: 'monthly',
  });
  const [row] = await tx
    .insert(clinicInvites)
    .values({
      tokenHash: input.tokenHash,
      createdBy: input.createdBy,
      email: identity.email,
      expiresAt: sql`now()+interval '24 hours'`,
      planSnapshot: price,
      metadata: {
        kind: PILOT_KIND,
        ownerName: identity.ownerName,
        clinicName: identity.clinicName,
        emailHash: hashEmail(identity.email),
        signupRef: null,
        authUserId: null,
      },
    })
    .returning({ id: clinicInvites.id });
  if (!row) throw new PilotSignupError('unavailable');
  return { id: row.id, created: true };
}

/** The existing draft mutation remains authoritative; a pilot cannot rename its beneficiary. */
export function pilotIdentityCondition(
  signupRef: string,
  input: { email: string; ownerName?: string; clinicName?: string },
) {
  return sql`NOT EXISTS(SELECT 1 FROM public.clinic_invites i
    WHERE i.metadata->>'kind'=${PILOT_KIND} AND i.metadata->>'signupRef'=${signupRef}
    AND (i.status NOT IN('pending','started') OR i.expires_at<=now()
      OR ${env.ABACATEPAY_PILOT_PROVISIONING_ENABLED !== true}
      OR i.metadata->>'emailHash' IS DISTINCT FROM ${hashEmail(input.email)}
      ${input.ownerName === undefined ? sql`` : sql`OR i.metadata->>'ownerName' IS DISTINCT FROM ${input.ownerName}`}
      ${input.clinicName === undefined ? sql`` : sql`OR i.metadata->>'clinicName' IS DISTINCT FROM ${input.clinicName}`}))`;
}

export async function pilotForUser(userId: string, tx: Tx | typeof dbAdmin = dbAdmin) {
  const rows = await tx
    .select({ invite: clinicInvites })
    .from(clinicInvites)
    .innerJoin(
      signupSessions,
      sql`${clinicInvites.metadata}->>'signupRef'=${signupSessions.tokenHash}`,
    )
    .where(
      and(
        eq(signupSessions.authUserId, userId),
        sql`${clinicInvites.metadata}->>'kind'=${PILOT_KIND}`,
      ),
    )
    .limit(2);
  if (rows.length > 1) throw new PilotSignupError('conflict');
  if (!rows[0]) return null;
  const grant = parsePilot(rows[0].invite);
  assertLivePilot(grant);
  return grant;
}
