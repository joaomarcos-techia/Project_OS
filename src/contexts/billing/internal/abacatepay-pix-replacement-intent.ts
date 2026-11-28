import 'server-only';

import { sql } from 'drizzle-orm';
import { z } from 'zod';

import { assertAbacatePayRuntime } from '@/lib/payments/saas/acquisition';
import type { BillingGatewaySql } from '@/lib/payments/saas/postgres-store';

import { OFFER_2026_PLAN_CODES } from '../proposed-offer';
import { getAbacatePayManagementContext, type ManagementDatabase } from './abacatepay-management';
import { toCents } from './money';
import { assertTargetPlanCapacity } from './plan-changes';
import { recordBillingEvent } from './subscriptions';

export class PixReplacementIntentError extends Error {
  constructor(
    readonly code: 'unavailable' | 'not_eligible' | 'pending_change' | 'reconcile_required',
  ) {
    super(`Pix replacement intent: ${code}`);
    this.name = 'PixReplacementIntentError';
  }
}

const intentSchema = z.object({
  id: z.uuid(),
  to_plan_id: z.uuid(),
  target_amount_minor: z.coerce.number().int().positive(),
  prior_period_end: z.coerce.date(),
  state: z.enum(['requested', 'cancelled', 'requires_review']),
});

async function ready(database: BillingGatewaySql): Promise<boolean> {
  const [row] = z
    .array(z.object({ ready: z.boolean() }))
    .length(1)
    .parse(
      await database.execute(
        sql`SELECT to_regclass('billing_gateway.pix_replacement_intents') IS NOT NULL ready`,
      ),
    );
  return row?.ready === true;
}

async function openIntent(database: BillingGatewaySql, accountId: string, remoteId: string) {
  const [row] = z
    .array(intentSchema)
    .max(1)
    .parse(
      await database.execute(sql`
    SELECT id::text,to_plan_id::text,target_amount_minor::text,prior_period_end,state
    FROM billing_gateway.pix_replacement_intents
    WHERE account_id=${accountId}::uuid AND prior_external_subscription_id=${remoteId}
      AND state='requested'`),
    );
  return row ?? null;
}

/** Records only an assistance request. No gateway command, checkout or cancellation occurs. */
export async function requestPixReplacementIntent(
  database: ManagementDatabase,
  input: { clinicId: string; requestedBy: string; contractId: string; targetPlanId: string },
) {
  assertAbacatePayRuntime();
  for (const id of [input.clinicId, input.requestedBy, input.contractId, input.targetPlanId])
    z.uuid().parse(id);
  if (!(await ready(database))) throw new PixReplacementIntentError('unavailable');
  return database.transaction(async (tx) => {
    const current = await getAbacatePayManagementContext(tx, input.clinicId, true);
    if (
      !current ||
      current.generation_id !== input.contractId ||
      current.billing_status !== 'active' ||
      current.payment_method !== 'PIX' ||
      current.period_ended ||
      current.cancel_at_period_end ||
      current.cancellation_requested
    )
      throw new PixReplacementIntentError('not_eligible');

    const [actor] = z
      .array(z.object({ id: z.uuid() }))
      .max(1)
      .parse(
        await tx.execute(sql`
      SELECT id::text FROM public.profiles WHERE id=${input.requestedBy}::uuid
        AND clinic_id=${input.clinicId}::uuid AND ativo AND deleted_at IS NULL`),
      );
    if (!actor) throw new PixReplacementIntentError('not_eligible');

    const [target] = z
      .array(
        z.object({
          plan_id: z.uuid(),
          price_id: z.uuid(),
          amount: z.string(),
        }),
      )
      .max(1)
      .parse(
        await tx.execute(sql`
      SELECT p.id::text plan_id,pr.id::text price_id,pr.amount::text
      FROM public.plans p JOIN public.prices pr ON pr.plan_id=p.id
      WHERE p.id=${input.targetPlanId}::uuid AND p.ativo
        AND p.code IN (${sql.join(
          OFFER_2026_PLAN_CODES.map((code) => sql`${code}`),
          sql`,`,
        )})
        AND pr.active_from<=now() AND pr.active_until IS NULL
        AND pr.billing_cycle='monthly' AND pr.currency='BRL' AND pr.campaign_code IS NULL`),
      );
    if (!target || target.price_id === current.price_id)
      throw new PixReplacementIntentError('not_eligible');

    const [origin] = z
      .array(z.object({ code: z.string(), eligible: z.boolean() }))
      .max(1)
      .parse(
        await tx.execute(sql`
        SELECT p.code,(pr.billing_cycle='monthly' AND pr.campaign_code IS NULL) eligible
        FROM public.prices pr JOIN public.plans p ON p.id=pr.plan_id
        WHERE pr.id=${current.price_id}::uuid`),
      );
    if (!origin?.eligible || !z.enum(OFFER_2026_PLAN_CODES).safeParse(origin.code).success)
      throw new PixReplacementIntentError('not_eligible');

    const existing = await openIntent(tx, current.account_id, current.external_subscription_id);
    if (existing) {
      if (existing.to_plan_id !== target.plan_id)
        throw new PixReplacementIntentError('pending_change');
      return { state: 'requested' as const, intentId: existing.id };
    }
    await assertTargetPlanCapacity(tx, input.clinicId, target.plan_id);
    const inserted = z
      .array(z.object({ id: z.uuid() }))
      .max(1)
      .parse(
        await tx.execute(sql`
      INSERT INTO billing_gateway.pix_replacement_intents(
        account_id,subscription_id,clinic_id,generation_id,prior_external_subscription_id,
        prior_period_end,from_price_id,to_price_id,to_plan_id,target_amount_minor,requested_by)
      VALUES(${current.account_id}::uuid,${current.subscription_id}::uuid,${input.clinicId}::uuid,
        ${current.generation_id}::uuid,${current.external_subscription_id},
        ${current.period_end.toISOString()}::timestamptz,${current.price_id}::uuid,
        ${target.price_id}::uuid,${target.plan_id}::uuid,${toCents(target.amount)},
        ${input.requestedBy}::uuid)
      ON CONFLICT DO NOTHING RETURNING id::text`),
      );
    const intent = inserted[0]
      ? { id: inserted[0].id, to_plan_id: target.plan_id }
      : await openIntent(tx, current.account_id, current.external_subscription_id);
    if (!intent) throw new PixReplacementIntentError('reconcile_required');
    if (intent.to_plan_id !== target.plan_id) throw new PixReplacementIntentError('pending_change');
    if (inserted[0])
      await recordBillingEvent(tx, input.clinicId, 'subscription.pix_replacement.requested', {
        intentId: intent.id,
        targetPlanId: target.plan_id,
        requestedBy: input.requestedBy,
        financialAction: false,
      });
    return { state: 'requested' as const, intentId: intent.id };
  });
}

/** Cancels the request only. It never cancels the paid subscription or Pix mandate. */
export async function cancelPixReplacementIntent(
  database: ManagementDatabase,
  input: { clinicId: string; requestedBy: string; contractId: string; intentId: string },
) {
  for (const id of [input.clinicId, input.requestedBy, input.contractId, input.intentId])
    z.uuid().parse(id);
  if (!(await ready(database))) throw new PixReplacementIntentError('unavailable');
  return database.transaction(async (tx) => {
    const current = await getAbacatePayManagementContext(tx, input.clinicId, true);
    if (!current || current.generation_id !== input.contractId || current.payment_method !== 'PIX')
      throw new PixReplacementIntentError('not_eligible');
    const [actor] = z
      .array(z.object({ id: z.uuid() }))
      .max(1)
      .parse(
        await tx.execute(sql`
      SELECT id::text FROM public.profiles WHERE id=${input.requestedBy}::uuid
        AND clinic_id=${input.clinicId}::uuid AND ativo AND deleted_at IS NULL`),
      );
    if (!actor) throw new PixReplacementIntentError('not_eligible');
    const [updated] = z
      .array(z.object({ id: z.uuid() }))
      .max(1)
      .parse(
        await tx.execute(sql`
      UPDATE billing_gateway.pix_replacement_intents
      SET state='cancelled',state_changed_at=now()
      WHERE id=${input.intentId}::uuid AND clinic_id=${input.clinicId}::uuid
        AND subscription_id=${current.subscription_id}::uuid
        AND generation_id=${input.contractId}::uuid AND state='requested'
      RETURNING id::text`),
      );
    if (updated) {
      await recordBillingEvent(tx, input.clinicId, 'subscription.pix_replacement.cancelled', {
        intentId: updated.id,
        requestedBy: input.requestedBy,
        financialAction: false,
      });
      return { state: 'cancelled' as const };
    }
    const [prior] = z
      .array(intentSchema)
      .max(1)
      .parse(
        await tx.execute(sql`
      SELECT id::text,to_plan_id::text,target_amount_minor::text,prior_period_end,state
      FROM billing_gateway.pix_replacement_intents
      WHERE id=${input.intentId}::uuid AND clinic_id=${input.clinicId}::uuid
        AND subscription_id=${current.subscription_id}::uuid AND generation_id=${input.contractId}::uuid`),
      );
    if (prior?.state === 'cancelled') return { state: 'cancelled' as const };
    throw new PixReplacementIntentError('not_eligible');
  });
}

export async function getPixReplacementIntentOverview(
  database: BillingGatewaySql,
  clinicId: string,
) {
  z.uuid().parse(clinicId);
  if (!(await ready(database))) return null;
  const current = await getAbacatePayManagementContext(database, clinicId);
  if (!current || current.payment_method !== 'PIX' || current.billing_status !== 'active')
    return null;
  const pending = await openIntent(database, current.account_id, current.external_subscription_id);
  return pending
    ? {
        available: true as const,
        pending: {
          id: pending.id,
          targetPlanId: pending.to_plan_id,
          amountMinor: pending.target_amount_minor,
          priorPeriodEnd: pending.prior_period_end.toISOString(),
        },
      }
    : { available: true as const, pending: null };
}
