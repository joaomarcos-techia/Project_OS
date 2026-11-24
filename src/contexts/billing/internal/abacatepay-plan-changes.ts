import {
  abacatePayEnvironment,
  abacatePayPlanProducts,
  abacatePayProbeProductId,
} from '@/lib/payments/saas/acquisition';
import 'server-only';
import { readConsumedAbacatePayCheckout } from './abacatepay-checkout-closure';

import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { z } from 'zod';

import { env } from '@/lib/env';
import { assertAbacatePayRuntime } from '@/lib/payments/saas/acquisition';
import {
  createPostgresGatewayOperationJournal,
  type BillingGatewaySql,
} from '@/lib/payments/saas/postgres-store';
import { createAbacatePayCommands } from '@/lib/payments/abacatepay/sandbox-commands';

import { OFFER_2026_PLAN_CODES } from '../proposed-offer';
import { getAbacatePayManagementContext, type ManagementDatabase } from './abacatepay-management';
import { assertTargetPlanCapacity } from './plan-changes';
import { recordBillingEvent } from './subscriptions';
import { toCents } from './money';

export class AbacatePayPlanChangeError extends Error {
  constructor(
    readonly code: 'unavailable' | 'not_eligible' | 'pending_change' | 'reconcile_required',
  ) {
    super(`AbacatePay plan change: ${code}`);
    this.name = 'AbacatePayPlanChangeError';
  }
}
const planSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  code: z.enum(OFFER_2026_PLAN_CODES),
  price_id: z.uuid(),
  amount: z.string(),
});
const pendingSchema = z.object({
  id: z.uuid(),
  to_plan_id: z.uuid(),
  from_price_id: z.uuid(),
  to_price_id: z.uuid(),
  product_id: z.string(),
  amount_minor: z.coerce.number().int().positive(),
  effective_not_before: z.coerce.date(),
  external_change_id: z.string().nullable(),
});

export async function abacatePayPlanChangesReady(database: BillingGatewaySql): Promise<boolean> {
  const [row] = z
    .array(z.object({ ready: z.boolean() }))
    .length(1)
    .parse(
      await database.execute(
        sql`SELECT to_regclass('billing_gateway.plan_changes') IS NOT NULL ready`,
      ),
    );
  return row?.ready === true;
}
async function plans(database: BillingGatewaySql) {
  return z.array(planSchema).parse(
    await database.execute(sql`
    SELECT p.id::text,p.name,p.code,pr.id::text price_id,pr.amount::text
    FROM public.plans p JOIN public.prices pr ON pr.plan_id=p.id
    WHERE p.ativo AND pr.active_from<=now() AND pr.active_until IS NULL AND pr.billing_cycle='monthly' AND pr.currency='BRL'
      AND pr.campaign_code IS NULL AND p.code IN (${sql.join(
        OFFER_2026_PLAN_CODES.map((code) => sql`${code}`),
        sql`,`,
      )})
    ORDER BY pr.amount,p.id`),
  );
}
async function pending(database: BillingGatewaySql, subscriptionId: string, remoteId: string) {
  const [row] = z
    .array(pendingSchema)
    .max(1)
    .parse(
      await database.execute(sql`
    SELECT id::text,to_plan_id::text,from_price_id::text,to_price_id::text,product_id,amount_minor::text,
      effective_not_before,external_change_id FROM billing_gateway.plan_changes
    WHERE subscription_id=${subscriptionId}::uuid AND external_subscription_id=${remoteId} AND invoice_id IS NULL`),
    );
  return row ?? null;
}

/** Saves one intent before I/O. PENDING never changes plan, period, invoice or seats. */
export async function requestAbacatePayPlanChange(
  database: ManagementDatabase,
  input: {
    clinicId: string;
    requestedBy: string;
    contractId: string;
    targetPlanId: string;
  },
) {
  assertAbacatePayRuntime();
  for (const id of [input.clinicId, input.requestedBy, input.contractId, input.targetPlanId])
    z.uuid().parse(id);
  if (
    !env.ABACATEPAY_API_KEY ||
    !env.ABACATEPAY_STORE_ID ||
    !abacatePayProbeProductId() ||
    !(await abacatePayPlanChangesReady(database))
  )
    throw new AbacatePayPlanChangeError('unavailable');
  let mapping: Partial<Record<(typeof OFFER_2026_PLAN_CODES)[number], string>>;
  try {
    mapping = z
      .partialRecord(z.enum(OFFER_2026_PLAN_CODES), z.string().regex(/^prod_[A-Za-z0-9_-]+$/))
      .parse(JSON.parse(abacatePayPlanProducts() ?? '{}'));
  } catch {
    throw new AbacatePayPlanChangeError('unavailable');
  }
  const reserved = await database.transaction(async (tx) => {
    const current = await getAbacatePayManagementContext(tx, input.clinicId, true);
    if (
      !current ||
      current.generation_id !== input.contractId ||
      current.billing_status !== 'active' ||
      current.payment_method !== 'CARD' ||
      current.period_ended ||
      current.cancel_at_period_end ||
      current.cancellation_requested
    )
      throw new AbacatePayPlanChangeError('not_eligible');
    const actors = z
      .array(z.object({ id: z.uuid() }))
      .max(1)
      .parse(
        await tx.execute(sql`
      SELECT id::text FROM public.profiles WHERE id=${input.requestedBy}::uuid AND clinic_id=${input.clinicId}::uuid
        AND ativo AND deleted_at IS NULL`),
      );
    if (!actors.length) throw new AbacatePayPlanChangeError('not_eligible');
    const available = await plans(tx),
      target = available.find((p) => p.id === input.targetPlanId);
    if (!target || target.price_id === current.price_id)
      throw new AbacatePayPlanChangeError('not_eligible');
    // Only the approved new catalog is eligible; never reprice a legacy contract.
    const [origin] = z
      .array(z.object({ code: z.string(), monthly: z.boolean() }))
      .max(1)
      .parse(
        await tx.execute(sql`SELECT p.code,(pr.billing_cycle='monthly' AND pr.campaign_code IS NULL) monthly
        FROM public.prices pr JOIN public.plans p ON p.id=pr.plan_id WHERE pr.id=${current.price_id}::uuid`),
      );
    if (!origin?.monthly || !z.enum(OFFER_2026_PLAN_CODES).safeParse(origin.code).success)
      throw new AbacatePayPlanChangeError('not_eligible');
    const existing = await pending(tx, current.subscription_id, current.external_subscription_id);
    if (existing && existing.to_plan_id !== target.id)
      throw new AbacatePayPlanChangeError('pending_change');
    await assertTargetPlanCapacity(tx, input.clinicId, target.id);
    const productId = mapping[target.code];
    if (!productId) throw new AbacatePayPlanChangeError('unavailable');
    if (!existing) {
      await tx.execute(sql`INSERT INTO billing_gateway.plan_changes(account_id,subscription_id,clinic_id,
        external_subscription_id,generation_id,from_price_id,to_price_id,to_plan_id,product_id,amount_minor,
        effective_not_before,requested_by)
        VALUES(${current.account_id}::uuid,${current.subscription_id}::uuid,${input.clinicId}::uuid,
          ${current.external_subscription_id},${current.generation_id}::uuid,${current.price_id}::uuid,
          ${target.price_id}::uuid,${target.id}::uuid,${productId},${toCents(target.amount)},
          ${current.period_end.toISOString()}::timestamptz,${input.requestedBy}::uuid)`);
      await recordBillingEvent(tx, input.clinicId, 'subscription.plan_change.requested', {
        provider: 'abacatepay',
        targetPlanId: target.id,
        effective: 'next_paid_cycle',
      });
    }
    const intent =
      existing ?? (await pending(tx, current.subscription_id, current.external_subscription_id));
    if (!intent) throw new AbacatePayPlanChangeError('reconcile_required');
    if (
      intent.to_price_id !== target.price_id ||
      intent.product_id !== productId ||
      intent.amount_minor !== toCents(target.amount)
    )
      throw new AbacatePayPlanChangeError('reconcile_required');
    return { current, intent };
  });
  const account = {
    provider: 'abacatepay',
    environment: abacatePayEnvironment(),
    accountId: env.ABACATEPAY_STORE_ID,
  } as const;
  const journal = createPostgresGatewayOperationJournal(
    account,
    {
      subscriptionId: reserved.current.subscription_id,
      clinicId: input.clinicId,
      kind: 'change_plan',
      businessKey: `plan:${reserved.intent.id}`,
    },
    database,
  );
  const consumed = await readConsumedAbacatePayCheckout(database, {
    subscriptionId: reserved.current.subscription_id,
    checkoutId: reserved.current.external_checkout_id,
    storeId: env.ABACATEPAY_STORE_ID,
    environment: account.environment,
  });
  if (!consumed) throw new AbacatePayPlanChangeError('reconcile_required');
  const commands = createAbacatePayCommands(
    {
      environment: abacatePayEnvironment(),
      apiKey: env.ABACATEPAY_API_KEY,
      storeId: env.ABACATEPAY_STORE_ID,
      probeProductId: abacatePayProbeProductId(),
    },
    journal,
    fetch,
    {
      subscriptionId: consumed.external_subscription_id,
      customerId: consumed.external_customer_id,
      checkoutId: reserved.current.external_checkout_id,
      productId: consumed.product_id,
    },
  );
  const result = await commands.requestPlanChange({
    operationId: randomUUID(),
    subscriptionId: reserved.current.external_subscription_id,
    customerId: reserved.current.external_customer_id,
    productId: reserved.intent.product_id,
    expectedAmountMinor: reserved.intent.amount_minor,
    expectedCycle: 'MONTHLY',
  });
  await database.transaction(async (tx) => {
    const current = await getAbacatePayManagementContext(tx, input.clinicId, true);
    if (!current || current.generation_id !== input.contractId)
      throw new AbacatePayPlanChangeError('reconcile_required');
    const rows = z
      .array(z.object({ id: z.uuid() }))
      .length(1)
      .parse(
        await tx.execute(sql`
      UPDATE billing_gateway.plan_changes SET external_change_id=${result.changeId}
      WHERE id=${reserved.intent.id}::uuid AND subscription_id=${current.subscription_id}::uuid
        AND invoice_id IS NULL AND (external_change_id IS NULL OR external_change_id=${result.changeId}) RETURNING id::text`),
      );
    if (!rows[0]) throw new AbacatePayPlanChangeError('reconcile_required');
  });
  return {
    state: 'scheduled' as const,
    effectiveNotBefore: reserved.intent.effective_not_before.toISOString(),
  };
}

export async function getAbacatePayPlanChangeOverview(
  database: ManagementDatabase,
  clinicId: string,
) {
  if (!(await abacatePayPlanChangesReady(database))) return null;
  const current = await getAbacatePayManagementContext(database, clinicId);
  if (
    !current ||
    current.billing_status !== 'active' ||
    current.cancel_at_period_end ||
    current.cancellation_requested ||
    current.period_ended
  )
    return null;
  const change = await pending(database, current.subscription_id, current.external_subscription_id);
  const configured = z
    .partialRecord(z.enum(OFFER_2026_PLAN_CODES), z.string().regex(/^prod_[A-Za-z0-9_-]+$/))
    .safeParse(
      (() => {
        try {
          return JSON.parse(abacatePayPlanProducts() ?? '{}');
        } catch {
          return null;
        }
      })(),
    );
  if (!configured.success) return null;
  const options = (await plans(database))
    .filter(
      (p) =>
        current.payment_method === 'CARD' &&
        p.price_id !== current.price_id &&
        configured.data[p.code],
    )
    .map((p) => ({
      id: p.id,
      name: p.name,
      code: p.code,
      amountMinor: toCents(p.amount),
    }));
  return {
    options,
    amountChangeBlocked: current.payment_method !== 'CARD',
    pending: change
      ? {
          planId: change.to_plan_id,
          confirmed: change.external_change_id !== null,
          effectiveNotBefore: change.effective_not_before.toISOString(),
        }
      : null,
  };
}
