import { abacatePayEnvironment, abacatePayProbeProductId } from '@/lib/payments/saas/acquisition';
import 'server-only';

import { createHash, randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import stringify from 'safe-stable-stringify';
import { z } from 'zod';

import type { Tx } from '@/lib/db';
import { env } from '@/lib/env';
import { metrics } from '@/lib/observability/metrics';
import {
  assertAbacatePayRuntime,
  isAbacatePayRuntime,
  abacatePayCheckoutAllowed,
} from '@/lib/payments/saas/acquisition';
import { billingResourceKey } from '@/lib/payments/saas/contracts';
import {
  createPostgresGatewayOperationJournal,
  type BillingGatewaySql,
} from '@/lib/payments/saas/postgres-store';
import { createAbacatePayCommands } from '@/lib/payments/abacatepay/sandbox-commands';
import { createAbacatePayReadClient } from '@/lib/payments/abacatepay/reader';
import { CommandOperationError } from '@/lib/payments/saas/command-operation';
import type { RecoveredCheckout } from '@/lib/payments/abacatepay/checkout-recovery';
import {
  createAbacatePayInitialPaymentReader,
  type InitialPaymentEvidence,
} from '@/lib/payments/abacatepay/initial-payment';

import { invoices } from '../schema';
import { initialAbacatePayAccessPeriod } from './abacatepay-period';
import { DUNNING_READONLY_DAYS } from './dunning';
import { toCents, toReaisString } from './money';
import { markInvoicePaid, recordBillingEvent } from './subscriptions';
import { recoverAbacatePayCheckout } from './abacatepay-checkout-recovery';
const READBACK_BUDGET_MS = 20_000;

export interface ManagementDatabase extends BillingGatewaySql {
  transaction<T>(work: (tx: Tx) => Promise<T>): Promise<T>;
}
export class AbacatePayManagementError extends Error {
  constructor(
    readonly code:
      | 'unavailable'
      | 'not_eligible'
      | 'period_active'
      | 'already_paid'
      | 'reconcile_required',
  ) {
    super(`AbacatePay management: ${code}`);
    this.name = 'AbacatePayManagementError';
  }
}
const contextSchema = z.object({
  subscription_id: z.uuid(),
  clinic_id: z.uuid(),
  account_id: z.uuid(),
  generation_id: z.uuid(),
  external_account_id: z.string(),
  external_subscription_id: z.string(),
  external_customer_id: z.string(),
  external_checkout_id: z.string(),
  price_id: z.uuid(),
  amount: z.string(),
  payment_method: z.enum(['CARD', 'PIX']).nullable(),
  billing_status: z.enum(['trial', 'active', 'past_due', 'cancelled']),
  cancel_at_period_end: z.boolean(),
  period_start: z.coerce.date(),
  period_end: z.coerce.date(),
  cancellation_requested: z.boolean(),
  cancellation_confirmed: z.boolean(),
  period_ended: z.boolean(),
});
type Context = z.infer<typeof contextSchema>;
const recontractSchema = z.object({
  id: z.uuid(),
  subscription_id: z.uuid(),
  clinic_id: z.uuid(),
  account_id: z.uuid(),
  prior_external_subscription_id: z.string(),
  prior_period_end: z.coerce.date(),
  price_id: z.uuid(),
  product_id: z.string(),
  amount_minor: z.coerce.number().int().positive(),
  external_checkout_id: z.string().nullable(),
  external_customer_id: z.string().nullable(),
  external_subscription_id: z.string().nullable(),
  invoice_id: z.uuid().nullable(),
});
const READ_TIMEOUT_MS = 2000;
function config() {
  assertAbacatePayRuntime();
  if (!env.ABACATEPAY_API_KEY || !env.ABACATEPAY_STORE_ID || !abacatePayProbeProductId())
    throw new AbacatePayManagementError('unavailable');
  return {
    apiKey: env.ABACATEPAY_API_KEY,
    storeId: env.ABACATEPAY_STORE_ID,
    probeProductId: abacatePayProbeProductId(),
    environment: abacatePayEnvironment(),
    timeoutMs: READ_TIMEOUT_MS,
  };
}
export async function abacatePayManagementReady(database: BillingGatewaySql): Promise<boolean> {
  if (!isAbacatePayRuntime() || !env.ABACATEPAY_STORE_ID) return false;
  const [row] = z
    .array(z.object({ ready: z.boolean() }))
    .length(1)
    .parse(
      await database.execute(sql`
    SELECT to_regclass('billing_gateway.cancellations') IS NOT NULL
      AND to_regclass('billing_gateway.recontracts') IS NOT NULL ready`),
    );
  return row?.ready === true;
}
export async function getAbacatePayManagementContext(
  database: BillingGatewaySql,
  clinicId: string,
  lock = false,
): Promise<Context | null> {
  z.uuid().parse(clinicId);
  const [row] = z
    .array(contextSchema)
    .max(1)
    .parse(
      await database.execute(sql`
    SELECT s.id::text subscription_id,s.clinic_id::text,b.account_id::text,
      coalesce(r.id,s.id)::text generation_id,a.external_account_id,
      coalesce(r.external_subscription_id,b.external_subscription_id) external_subscription_id,
      coalesce(r.external_customer_id,b.external_customer_id) external_customer_id,
      coalesce(r.external_checkout_id,b.external_checkout_id) external_checkout_id,
      s.price_id::text,pr.amount::text,s.billing_status,s.cancel_at_period_end,
      (SELECT invoice.payment_method FROM public.invoices invoice
        WHERE invoice.id=coalesce(r.invoice_id,(SELECT paid.invoice_id FROM billing_gateway.paid_checkouts paid
          WHERE paid.account_id=b.account_id AND paid.checkout_id=b.external_checkout_id
            AND paid.subscription_id=s.id AND paid.clinic_id=s.clinic_id))) payment_method,
      s.current_period_start period_start,s.current_period_end period_end,
      (c.requested_at IS NOT NULL) cancellation_requested,(c.confirmed_at IS NOT NULL) cancellation_confirmed,
      (s.current_period_end <= now()) period_ended
    FROM public.subscriptions s JOIN public.prices pr ON pr.id=s.price_id
    JOIN billing_gateway.bindings b ON b.subscription_id=s.id AND b.clinic_id=s.clinic_id
    JOIN billing_gateway.accounts a ON a.id=b.account_id
    LEFT JOIN LATERAL (SELECT * FROM billing_gateway.recontracts latest
      WHERE latest.subscription_id=s.id AND latest.invoice_id IS NOT NULL
      ORDER BY latest.created_at DESC,latest.id DESC LIMIT 1) r ON true
    LEFT JOIN billing_gateway.cancellations c ON c.account_id=a.id
      AND c.external_subscription_id=coalesce(r.external_subscription_id,b.external_subscription_id)
    WHERE s.clinic_id=${clinicId}::uuid AND s.billing_provider='abacatepay' AND s.asaas_subscription_id IS NULL
      AND a.provider='abacatepay' AND a.environment=${abacatePayEnvironment()} AND a.external_account_id=${env.ABACATEPAY_STORE_ID}
      AND s.current_period_start IS NOT NULL AND s.current_period_end IS NOT NULL
      AND coalesce(r.external_subscription_id,b.external_subscription_id) IS NOT NULL
    ${lock ? sql`FOR UPDATE OF s,b` : sql``}
  `),
    );
  return row ?? null;
}
async function verifyStopped(context: Context, deadlineMs = Date.now() + READBACK_BUDGET_MS) {
  const read = createAbacatePayReadClient({ ...config(), deadlineMs });
  if ((await read.readStore()).id !== context.external_account_id)
    throw new AbacatePayManagementError('reconcile_required');
  const remote = await read.readSubscription(context.external_subscription_id);
  if (
    remote.customerId !== context.external_customer_id ||
    remote.checkoutId !== context.external_checkout_id
  )
    throw new AbacatePayManagementError('reconcile_required');
  return remote.status === 'CANCELLED';
}
async function confirmCancellation(database: ManagementDatabase, original: Context) {
  return database.transaction(async (tx) => {
    const current = await getAbacatePayManagementContext(tx, original.clinic_id, true);
    if (
      !current ||
      current.generation_id !== original.generation_id ||
      current.period_end.getTime() !== original.period_end.getTime()
    )
      throw new AbacatePayManagementError('reconcile_required');
    const encoded = stringify({
      kind: 'cancel_subscription',
      parameters: {
        subscriptionId: current.external_subscription_id,
        customerId: current.external_customer_id,
      },
    });
    if (!encoded) throw new AbacatePayManagementError('reconcile_required');
    const fingerprint = createHash('sha256').update(encoded).digest('hex');
    const result = JSON.stringify({
      subscriptionId: current.external_subscription_id,
      customerId: current.external_customer_id,
      recurrence: 'stopped',
    });
    await tx.execute(sql`UPDATE billing_gateway.operations SET state='confirmed',result=${result}::jsonb,updated_at=now()
      WHERE account_id=${current.account_id}::uuid AND subscription_id=${current.subscription_id}::uuid AND clinic_id=${current.clinic_id}::uuid
        AND kind='cancel_subscription' AND business_key=${`cancel:${current.generation_id}`} AND request_hash=${fingerprint} AND state IN ('running','unknown')`);
    const confirmed = z.array(z.object({ confirmed_at: z.coerce.date() })).parse(
      await tx.execute(sql`
      UPDATE billing_gateway.cancellations SET confirmed_at=now() WHERE account_id=${current.account_id}::uuid
        AND external_subscription_id=${current.external_subscription_id} AND confirmed_at IS NULL RETURNING confirmed_at`),
    );
    if (confirmed.length) {
      await tx.execute(sql`UPDATE public.subscriptions SET cancel_at_period_end=true,
        grace_period_until=current_period_end,cancelled_by=c.requested_by,cancel_reason='abacatepay_renewal_cancelled',updated_at=now()
        FROM billing_gateway.cancellations c WHERE subscriptions.id=${current.subscription_id}::uuid
          AND c.account_id=${current.account_id}::uuid AND c.external_subscription_id=${current.external_subscription_id}`);
      await recordBillingEvent(tx, current.clinic_id, 'subscription.renewal_cancelled', {
        provider: 'abacatepay',
        contractId: current.generation_id,
        accessUntil: current.period_end.toISOString(),
      });
    }
    await finishAbacatePayCancellationTx(tx, current.clinic_id);
    return { state: 'renewal_cancelled' as const, accessUntil: current.period_end.toISOString() };
  });
}
/** Does not revoke a profile, erase records, refund or shorten a paid period. */
export async function requestAbacatePayCancellation(
  database: ManagementDatabase,
  input: { clinicId: string; requestedBy: string; contractId: string },
) {
  const settings = config();
  z.uuid().parse(input.contractId);
  z.uuid().parse(input.requestedBy);
  if (!(await abacatePayManagementReady(database)))
    throw new AbacatePayManagementError('unavailable');
  const current = await database.transaction(async (tx) => {
    const context = await getAbacatePayManagementContext(tx, input.clinicId, true);
    if (!context || context.generation_id !== input.contractId)
      throw new AbacatePayManagementError('not_eligible');
    const actor = z.array(z.object({ id: z.uuid() })).parse(
      await tx.execute(sql`
      SELECT id::text FROM public.profiles WHERE id=${input.requestedBy}::uuid AND clinic_id=${input.clinicId}::uuid AND ativo`),
    );
    if (actor.length !== 1) throw new AbacatePayManagementError('not_eligible');
    const inserted = z.array(z.object({ external_subscription_id: z.string() })).parse(
      await tx.execute(sql`
      INSERT INTO billing_gateway.cancellations(account_id,external_subscription_id,subscription_id,clinic_id,
        external_customer_id,external_checkout_id,paid_period_start,paid_period_end,requested_by)
      SELECT ${context.account_id}::uuid,${context.external_subscription_id},s.id,s.clinic_id,
        ${context.external_customer_id},${context.external_checkout_id},s.current_period_start,
        s.current_period_end,${input.requestedBy}::uuid FROM public.subscriptions s
      WHERE s.id=${context.subscription_id}::uuid AND s.clinic_id=${context.clinic_id}::uuid
      ON CONFLICT DO NOTHING RETURNING external_subscription_id`),
    );
    if (inserted.length)
      await recordBillingEvent(
        tx,
        context.clinic_id,
        'subscription.renewal_cancellation_requested',
        {
          provider: 'abacatepay',
          contractId: context.generation_id,
          requestedBy: input.requestedBy,
        },
      );
    return context;
  });
  if (current.cancellation_confirmed) return confirmCancellation(database, current);
  // Read first: also recovers a command whose response/journal acknowledgement
  // was lost. A confirmed cancellation is irreversible, so no second POST.
  if (!(await verifyStopped(current))) {
    const account = {
      provider: 'abacatepay',
      environment: abacatePayEnvironment(),
      accountId: current.external_account_id,
    } as const;
    const journal = createPostgresGatewayOperationJournal(
      account,
      {
        subscriptionId: current.subscription_id,
        clinicId: current.clinic_id,
        kind: 'cancel_subscription',
        businessKey: `cancel:${current.generation_id}`,
      },
      database,
    );
    try {
      await createAbacatePayCommands(settings, journal).cancelSubscription({
        operationId: randomUUID(),
        subscriptionId: current.external_subscription_id,
        customerId: current.external_customer_id,
      });
    } catch {
      if (!(await verifyStopped(current))) {
        metrics.emit('billing.abacatepay.cancellation_pending', {
          reason: 'authoritative_reconciliation_required',
        });
        throw new AbacatePayManagementError('reconcile_required');
      }
    }
  }
  return confirmCancellation(database, current);
}
export async function finishAbacatePayCancellationTx(tx: Tx, clinicId: string): Promise<boolean> {
  const current = await getAbacatePayManagementContext(tx, clinicId, true);
  if (
    !current?.cancellation_confirmed ||
    !current.period_ended ||
    !current.cancel_at_period_end ||
    current.billing_status === 'cancelled'
  )
    return false;
  await tx.execute(sql`INSERT INTO public.subscription_history(clinic_id,subscription_id,old_plan_id,new_plan_id,old_status,new_status,reason)
    SELECT clinic_id,id,plan_id,plan_id,billing_status::text,'cancelled','abacatepay_cancelled_period_end'
    FROM public.subscriptions WHERE id=${current.subscription_id}::uuid`);
  await tx.execute(sql`UPDATE public.subscriptions SET billing_status='cancelled',cancelled_at=now(),updated_at=now()
    WHERE id=${current.subscription_id}::uuid`);
  await tx.execute(
    sql`UPDATE public.clinics SET status='cancelled',updated_at=now() WHERE id=${clinicId}::uuid`,
  );
  await recordBillingEvent(tx, clinicId, 'subscription.cancelled_period_end', {
    provider: 'abacatepay',
    contractId: current.generation_id,
  });
  return true;
}

export async function createAbacatePayRecontractCheckout(
  database: ManagementDatabase,
  input: { clinicId: string; productId: string | undefined; callbackUrl: string },
) {
  if (!abacatePayCheckoutAllowed(input.clinicId))
    throw new AbacatePayManagementError('unavailable');
  const settings = config();
  if (!(await abacatePayManagementReady(database)))
    throw new AbacatePayManagementError('unavailable');
  const current = await getAbacatePayManagementContext(database, input.clinicId);
  if (!current?.cancellation_confirmed || !current.cancel_at_period_end)
    throw new AbacatePayManagementError('not_eligible');
  if (!current.period_ended) throw new AbacatePayManagementError('period_active');
  if (!input.productId || !/^prod_[A-Za-z0-9_-]+$/.test(input.productId))
    throw new AbacatePayManagementError('unavailable');
  const productId = input.productId;
  if (!(await verifyStopped(current))) throw new AbacatePayManagementError('reconcile_required');
  const read = createAbacatePayReadClient(settings);
  const old = await read.listSubscriptionsForCheckout(current.external_checkout_id);
  if (
    old.length !== 1 ||
    old[0]?.id !== current.external_subscription_id ||
    old[0]?.status !== 'CANCELLED'
  )
    throw new AbacatePayManagementError('reconcile_required');
  const reserved = await database.transaction(async (tx) => {
    const fresh = await getAbacatePayManagementContext(tx, input.clinicId, true);
    if (
      !fresh ||
      fresh.generation_id !== current.generation_id ||
      !fresh.cancellation_confirmed ||
      !fresh.period_ended
    )
      throw new AbacatePayManagementError('reconcile_required');
    await finishAbacatePayCancellationTx(tx, input.clinicId);
    await tx.execute(sql`INSERT INTO billing_gateway.recontracts(subscription_id,clinic_id,account_id,prior_external_subscription_id,
      prior_period_end,prior_external_customer_id,price_id,product_id,amount_minor)
      SELECT c.subscription_id,c.clinic_id,c.account_id,c.external_subscription_id,
        c.paid_period_end,c.external_customer_id,${fresh.price_id}::uuid,${productId},${toCents(fresh.amount)}
      FROM billing_gateway.cancellations c WHERE c.account_id=${fresh.account_id}::uuid
        AND c.external_subscription_id=${fresh.external_subscription_id} AND c.confirmed_at IS NOT NULL
      ON CONFLICT DO NOTHING`);
    const [row] = z
      .array(recontractSchema)
      .length(1)
      .parse(
        await tx.execute(sql`
      SELECT id::text,subscription_id::text,clinic_id::text,account_id::text,prior_external_subscription_id,prior_period_end,
        price_id::text,product_id,amount_minor::text,external_checkout_id,external_customer_id,external_subscription_id,invoice_id
      FROM billing_gateway.recontracts WHERE account_id=${fresh.account_id}::uuid AND prior_external_subscription_id=${fresh.external_subscription_id}`),
      );
    if (!row || row.price_id !== fresh.price_id || row.amount_minor !== toCents(fresh.amount))
      throw new AbacatePayManagementError('reconcile_required');
    return row;
  });
  const account = {
    provider: 'abacatepay',
    environment: abacatePayEnvironment(),
    accountId: current.external_account_id,
  } as const;
  const journal = createPostgresGatewayOperationJournal(
    account,
    {
      subscriptionId: current.subscription_id,
      clinicId: current.clinic_id,
      kind: 'recontract_checkout',
      businessKey: `recontract:${reserved.id}`,
    },
    database,
  );
  let checkout: RecoveredCheckout;
  try {
    checkout = await createAbacatePayCommands(settings, journal).createSubscriptionCheckout({
      operationId: randomUUID(),
      externalId: `qoro-recontract-${reserved.id}`,
      productId: reserved.product_id,
      expectedAmountMinor: reserved.amount_minor,
      expectedCycle: 'MONTHLY',
      expectedNativeTrialDays: null,
      methods: ['CARD', 'PIX'],
      returnUrl: input.callbackUrl,
      completionUrl: input.callbackUrl,
    });
  } catch (error) {
    if (!(error instanceof CommandOperationError) || error.code === 'invalid_input') throw error;
    const recovered = await recoverAbacatePayCheckout(database, {
      subscriptionId: reserved.subscription_id,
      clinicId: reserved.clinic_id,
      recontractId: reserved.id,
    });
    if (recovered.state !== 'recovered') throw new AbacatePayManagementError('reconcile_required');
    checkout = recovered.result;
  }
  await database.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT id FROM public.subscriptions WHERE id=${reserved.subscription_id}::uuid FOR UPDATE`,
    );
    const attached = z
      .array(z.object({ id: z.uuid() }))
      .length(1)
      .parse(
        await tx.execute(sql`
      UPDATE billing_gateway.recontracts SET external_checkout_id=${checkout.checkoutId}
      WHERE id=${reserved.id}::uuid AND invoice_id IS NULL AND (external_checkout_id IS NULL OR external_checkout_id=${checkout.checkoutId}) RETURNING id::text`),
      );
    if (!attached[0]) throw new AbacatePayManagementError('reconcile_required');
  });
  const remote = await read.readSubscriptionCheckoutFinancials(checkout.checkoutId);
  if (remote.status === 'PAID') {
    const result = await recoverAbacatePayRecontract(database, { clinicId: current.clinic_id });
    if (result.applied || result.duplicate) throw new AbacatePayManagementError('already_paid');
  }
  if (
    remote.status !== 'PENDING' ||
    remote.amount !== reserved.amount_minor ||
    (remote.paidAmount !== null && remote.paidAmount !== 0) ||
    remote.items.length !== 1 ||
    remote.items[0]?.id !== reserved.product_id ||
    remote.items[0]?.quantity !== 1
  )
    throw new AbacatePayManagementError('reconcile_required');
  return { state: 'checkout_pending' as const, checkoutUrl: checkout.checkoutUrl };
}

export async function applyAbacatePayRecontractPaymentTx(
  tx: Tx,
  evidence: InitialPaymentEvidence,
): Promise<'applied' | 'duplicate' | 'review'> {
  if (
    evidence.account.provider !== 'abacatepay' ||
    !['sandbox', 'production'].includes(evidence.account.environment) ||
    evidence.currency !== 'BRL' ||
    !['card', 'pix'].includes(evidence.method) ||
    evidence.state !== 'paid' ||
    evidence.recurrence !== 'running' ||
    evidence.amountMinor <= 0 ||
    evidence.paidAmountMinor !== evidence.amountMinor
  )
    return 'review';
  const [row] = z
    .array(recontractSchema)
    .max(1)
    .parse(
      await tx.execute(sql`
    SELECT r.id::text,r.subscription_id::text,r.clinic_id::text,r.account_id::text,r.prior_external_subscription_id,r.prior_period_end,
      r.price_id::text,r.product_id,r.amount_minor::text,r.external_checkout_id,r.external_customer_id,r.external_subscription_id,r.invoice_id
    FROM billing_gateway.recontracts r JOIN billing_gateway.accounts a ON a.id=r.account_id
    JOIN public.subscriptions s ON s.id=r.subscription_id AND s.clinic_id=r.clinic_id
    WHERE a.provider='abacatepay' AND a.environment=${evidence.account.environment} AND a.external_account_id=${evidence.account.accountId}
      AND r.external_checkout_id=${evidence.checkoutId} AND s.billing_provider='abacatepay' AND s.asaas_subscription_id IS NULL
    FOR UPDATE OF s,r`),
    );
  if (!row || row.amount_minor !== evidence.amountMinor) return 'review';
  if (
    row.external_subscription_id !== null &&
    (row.external_subscription_id !== evidence.subscriptionId ||
      row.external_customer_id !== evidence.customerId)
  )
    return 'review';
  if (row.invoice_id) return 'duplicate';
  const current = await getAbacatePayManagementContext(tx, row.clinic_id, true);
  if (
    !current?.cancellation_confirmed ||
    !current.period_ended ||
    !current.cancel_at_period_end ||
    current.external_subscription_id !== row.prior_external_subscription_id ||
    current.period_end.getTime() !== row.prior_period_end.getTime() ||
    current.price_id !== row.price_id ||
    toCents(current.amount) !== row.amount_minor
  )
    return 'review';
  const period = initialAbacatePayAccessPeriod({
    subscriptionCreatedAt: evidence.subscriptionCreatedAt,
    trialEndsAt: row.prior_period_end,
    now: new Date(),
  });
  if (!period) return 'review';
  const [invoice] = await tx
    .insert(invoices)
    .values({
      clinicId: row.clinic_id,
      subscriptionId: row.subscription_id,
      totalAmount: toReaisString(row.amount_minor),
      status: 'open',
      dueDate: period.start.toISOString().slice(0, 10),
      periodStart: period.start.toISOString().slice(0, 10),
      periodEnd: period.end.toISOString().slice(0, 10),
      paymentMethod: evidence.method === 'pix' ? 'PIX' : 'CARD',
    })
    .returning();
  if (!invoice) throw new Error('Recontract invoice persistence failed');
  await tx.execute(sql`UPDATE billing_gateway.recontracts SET external_subscription_id=${evidence.subscriptionId},external_customer_id=${evidence.customerId},
    invoice_id=${invoice.id}::uuid,period_start=${period.start.toISOString()}::timestamptz,period_end=${period.end.toISOString()}::timestamptz WHERE id=${row.id}::uuid`);
  // Explicit, approved recontract only; generic late payments stay terminal.
  await tx.execute(sql`INSERT INTO public.subscription_history(clinic_id,subscription_id,old_plan_id,new_plan_id,old_status,new_status,reason)
    SELECT clinic_id,id,plan_id,plan_id,billing_status::text,'active','abacatepay_verified_recontract' FROM public.subscriptions WHERE id=${row.subscription_id}::uuid`);
  await tx.execute(sql`UPDATE public.subscriptions SET billing_status='active',cancel_at_period_end=false,cancelled_at=NULL,cancel_reason=NULL,cancelled_by=NULL,
    current_period_start=${period.start.toISOString()}::timestamptz,current_period_end=${period.end.toISOString()}::timestamptz,
    grace_period_until=${new Date(period.end.getTime() + DUNNING_READONLY_DAYS * 86_400_000).toISOString()}::timestamptz,dunning_stage=0,updated_at=now()
    WHERE id=${row.subscription_id}::uuid`);
  await markInvoicePaid(tx, row.clinic_id, invoice, {
    provider: 'abacatepay',
    paymentMethod: evidence.method === 'pix' ? 'PIX' : 'CARD',
    providerPaymentId: billingResourceKey(evidence.account, 'checkout', evidence.checkoutId),
    idemSuffix: `abacatepay-recontract:${row.id}`,
    deferPeriodAdvance: true,
  });
  await recordBillingEvent(tx, row.clinic_id, 'subscription.recontract_paid', {
    provider: 'abacatepay',
    contractId: row.id,
    invoiceId: invoice.id,
  });
  return 'applied';
}

export async function recoverAbacatePayRecontract(
  database: ManagementDatabase,
  input: { clinicId?: string } = {},
) {
  const idle = { applied: 0, duplicate: 0, review: 0, scanned: 0 };
  if (
    !isAbacatePayRuntime() ||
    !env.ABACATEPAY_API_KEY ||
    !env.ABACATEPAY_STORE_ID ||
    !(await abacatePayManagementReady(database))
  )
    return idle;
  const clinicId = input.clinicId === undefined ? null : z.uuid().parse(input.clinicId);
  const [row] = z
    .array(recontractSchema)
    .max(1)
    .parse(
      await database.execute(sql`
    SELECT r.id::text,r.subscription_id::text,r.clinic_id::text,r.account_id::text,r.prior_external_subscription_id,r.prior_period_end,
      r.price_id::text,r.product_id,r.amount_minor::text,r.external_checkout_id,r.external_customer_id,r.external_subscription_id,r.invoice_id
    FROM billing_gateway.recontracts r JOIN billing_gateway.accounts a ON a.id=r.account_id
    LEFT JOIN LATERAL (SELECT max(e.created_at) checked_at FROM public.billing_events e
      WHERE e.clinic_id=r.clinic_id AND e.type='subscription.recontract.checked' AND e.payload->>'contractId'=r.id::text) checked ON true
    WHERE a.provider='abacatepay' AND a.environment=${abacatePayEnvironment()} AND a.external_account_id=${env.ABACATEPAY_STORE_ID}
      AND r.external_checkout_id IS NOT NULL AND r.invoice_id IS NULL AND (${clinicId}::uuid IS NULL OR r.clinic_id=${clinicId}::uuid)
      AND (${clinicId}::uuid IS NOT NULL OR checked.checked_at IS NULL OR checked.checked_at < now()-interval '1 hour')
    ORDER BY checked.checked_at NULLS FIRST,r.created_at LIMIT 1`),
    );
  if (!row?.external_checkout_id) return idle;
  await database.transaction((tx) =>
    recordBillingEvent(tx, row.clinic_id, 'subscription.recontract.checked', {
      provider: 'abacatepay',
      contractId: row.id,
    }),
  );
  try {
    const settings = config(),
      read = createAbacatePayReadClient(settings);
    if ((await read.readStore()).id !== settings.storeId)
      throw new AbacatePayManagementError('reconcile_required');
    const matches = await read.listSubscriptionsForCheckout(row.external_checkout_id);
    if (!matches.length) return { ...idle, scanned: 1 };
    const remote = matches[0];
    if (!remote) throw new AbacatePayManagementError('reconcile_required');
    const product = await read.readProduct(row.product_id);
    if (
      product.price !== row.amount_minor ||
      product.cycle !== 'MONTHLY' ||
      product.trialDays != null
    )
      throw new AbacatePayManagementError('reconcile_required');
    const evidence = await createAbacatePayInitialPaymentReader(
      { provider: 'abacatepay', environment: abacatePayEnvironment(), accountId: settings.storeId },
      settings,
    ).readInitialPayment({
      subscriptionId: remote.id,
      customerId: remote.customerId,
      checkoutId: row.external_checkout_id,
      productId: row.product_id,
      expectedAmountMinor: row.amount_minor,
    });
    if (evidence.state !== 'paid')
      return { ...idle, scanned: 1, review: Number(evidence.state !== 'pending') };
    const outcome = await database.transaction((tx) =>
      applyAbacatePayRecontractPaymentTx(tx, evidence),
    );
    return {
      scanned: 1,
      applied: Number(outcome === 'applied'),
      duplicate: Number(outcome === 'duplicate'),
      review: Number(outcome === 'review'),
    };
  } catch {
    metrics.emit('billing.abacatepay.recontract_pending', {
      reason: 'authoritative_readback_or_transaction',
    });
    return { ...idle, scanned: 1, review: 1 };
  }
}

/** Fresh reads only: a missing acknowledgement is not permission to resend. */
export async function reconcileAbacatePayCancellation(
  database: ManagementDatabase,
  externalSubscriptionId?: string,
  deadlineMs = Date.now() + READBACK_BUDGET_MS,
) {
  const idle = { scanned: 0, confirmed: 0, review: 0 };
  if (
    !isAbacatePayRuntime() ||
    !env.ABACATEPAY_API_KEY ||
    !env.ABACATEPAY_STORE_ID ||
    !(await abacatePayManagementReady(database))
  )
    return idle;
  const externalId =
    externalSubscriptionId === undefined
      ? null
      : z
          .string()
          .regex(/^subs_[A-Za-z0-9_-]+$/)
          .parse(externalSubscriptionId);
  const [row] = z
    .array(z.object({ clinic_id: z.uuid(), external_subscription_id: z.string() }))
    .max(1)
    .parse(
      await database.execute(sql`
    SELECT c.clinic_id::text,c.external_subscription_id FROM billing_gateway.cancellations c
    JOIN billing_gateway.accounts a ON a.id=c.account_id
    LEFT JOIN LATERAL (SELECT max(e.created_at) checked_at FROM public.billing_events e
      WHERE e.clinic_id=c.clinic_id AND e.type='subscription.cancellation.checked'
        AND e.payload->>'externalSubscriptionId'=c.external_subscription_id) checked ON true
    WHERE a.provider='abacatepay' AND a.environment=${abacatePayEnvironment()} AND a.external_account_id=${env.ABACATEPAY_STORE_ID}
      AND (${externalId}::text IS NULL OR c.external_subscription_id=${externalId})
      AND (${externalId}::text IS NOT NULL OR c.confirmed_at IS NULL)
      AND (${externalId}::text IS NOT NULL OR checked.checked_at IS NULL OR checked.checked_at < now()-interval '1 hour')
    ORDER BY checked.checked_at NULLS FIRST,c.requested_at LIMIT 1`),
    );
  if (!row) return idle;
  await database.transaction((tx) =>
    recordBillingEvent(tx, row.clinic_id, 'subscription.cancellation.checked', {
      provider: 'abacatepay',
      externalSubscriptionId: row.external_subscription_id,
    }),
  );
  const current = await getAbacatePayManagementContext(database, row.clinic_id);
  if (!current || current.external_subscription_id !== row.external_subscription_id)
    return { ...idle, scanned: 1 };
  try {
    if (!(await verifyStopped(current, deadlineMs))) return { ...idle, scanned: 1, review: 1 };
    await confirmCancellation(database, current);
    return { ...idle, scanned: 1, confirmed: 1 };
  } catch {
    metrics.emit('billing.abacatepay.cancellation_pending', {
      reason: 'authoritative_reconciliation_required',
    });
    return { ...idle, scanned: 1, review: 1 };
  }
}

export async function reconcileAbacatePayManagement(database: ManagementDatabase) {
  if (!(await abacatePayManagementReady(database))) return;
  await reconcileAbacatePayCancellation(database);
  const rows = z
    .array(z.object({ clinic_id: z.uuid() }))
    .max(10)
    .parse(
      await database.execute(sql`
    SELECT DISTINCT s.clinic_id::text FROM public.subscriptions s
    JOIN billing_gateway.bindings b ON b.subscription_id=s.id JOIN billing_gateway.accounts a ON a.id=b.account_id
    WHERE s.billing_provider='abacatepay' AND s.cancel_at_period_end AND s.billing_status<>'cancelled'
      AND s.current_period_end <= now() AND a.provider='abacatepay' AND a.environment=${abacatePayEnvironment()}
      AND a.external_account_id=${env.ABACATEPAY_STORE_ID} LIMIT 10`),
    );
  for (const row of rows)
    await database.transaction((tx) => finishAbacatePayCancellationTx(tx, row.clinic_id));
  await recoverAbacatePayRecontract(database);
}
