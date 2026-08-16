/**
 * Orquestração de subscription/invoice (C13). Aplica transições MONOTÔNICAS
 * (state-machine.ts), grava billing_events (timeline da conta — sem consumidores),
 * payment_attempts, e emite billing.* via outbox. Usado pelo webhook e crons.
 *
 * ADR-016/025: Asaas atualiza billing; ClinicaOS DECIDE acesso. A escrita de
 * `clinics.status` aqui é o ponto sancionado dessa decisão (control write de
 * tabela única, não import de schema cross-context).
 */
import { and, eq, isNull, lt, or, sql } from 'drizzle-orm';

import type { Tx } from '@/lib/db';
import { publishEvent } from '@/lib/outbox/publish';

import { BILLING_EVENTS, type SubscriptionActivatedPayload } from '../events';
import {
  billingEvents,
  invoices,
  paymentAttempts,
  plans,
  prices,
  subscriptionHistory,
  subscriptions,
  type InvoiceRow,
} from '../schema';
import { type AccessMode, accessModeToClinicStatus } from './access';
import { billingPeriodFor, shouldAdvanceSubscriptionPeriod } from './billing-period';
import { toCents, toReais, toReaisString } from './money';
import { canTransitionBilling, canTransitionInvoice, type BillingStatus } from './state-machine';

type PlanCode = SubscriptionActivatedPayload['planCode'];

function toPlanCode(code: string): PlanCode {
  if (code === 'solo' || code === 'clinica' || code === 'pro') return code;
  throw new Error(`[billing] plano não suportado na ativação: ${code}`);
}

/** Timeline append-only da conta (G1) — legível, sem consumidores. */
export async function recordBillingEvent(
  tx: Tx,
  clinicId: string,
  type: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await tx.insert(billingEvents).values({ clinicId, type, payload: payload as never });
}

/** Decisão de acesso (ClinicaOS) → clinics.status + evento. Idempotente por suffix. */
export async function setClinicAccess(
  tx: Tx,
  clinicId: string,
  mode: AccessMode,
  reason: string,
  idemSuffix: string,
): Promise<void> {
  const status = accessModeToClinicStatus(mode);
  await tx.execute(
    sql`UPDATE clinics SET status = ${status}::clinic_status, updated_at = now() WHERE id = ${clinicId}::uuid`,
  );
  if (mode === 'enabled') {
    await publishEvent(tx, {
      clinicId,
      eventType: BILLING_EVENTS.CLINIC_REACTIVATED,
      payload: { clinicId },
      idempotencyKey: `clinic-reactivated:${idemSuffix}`,
    });
    await recordBillingEvent(tx, clinicId, 'clinic.reactivated', { reason });
  } else {
    await publishEvent(tx, {
      clinicId,
      eventType: BILLING_EVENTS.CLINIC_SUSPENDED,
      payload: { clinicId, mode: mode === 'readonly' ? 'readonly' : 'blocked', reason },
      idempotencyKey: `clinic-suspended:${mode}:${idemSuffix}`,
    });
    await recordBillingEvent(tx, clinicId, 'clinic.suspended', { mode, reason });
  }
}

/** Transiciona billing_status da subscription (monotônico) + history + evento. */
export async function setBillingStatus(
  tx: Tx,
  clinicId: string,
  to: BillingStatus,
  reason: string,
  idemSuffix: string,
): Promise<boolean> {
  const [sub] = await tx
    .select({ id: subscriptions.id, status: subscriptions.billingStatus })
    .from(subscriptions)
    .where(eq(subscriptions.clinicId, clinicId))
    .limit(1);
  if (!sub) return false;
  const from = sub.status as BillingStatus;
  if (from === to) return false;
  if (!canTransitionBilling(from, to)) return false;

  await tx.update(subscriptions).set({ billingStatus: to }).where(eq(subscriptions.id, sub.id));
  await tx.insert(subscriptionHistory).values({
    clinicId,
    subscriptionId: sub.id,
    oldStatus: from,
    newStatus: to,
    reason,
  });
  if (to === 'active' && from === 'trial') {
    await publishEvent(tx, {
      clinicId,
      eventType: BILLING_EVENTS.TRIAL_CONVERTED,
      payload: { clinicId, subscriptionId: sub.id },
      idempotencyKey: `trial-converted:${idemSuffix}`,
    });
  }
  await publishEvent(tx, {
    clinicId,
    eventType: BILLING_EVENTS.SUBSCRIPTION_CHANGED,
    payload: {
      clinicId,
      subscriptionId: sub.id,
      oldPlanCode: null,
      newPlanCode: null,
      oldStatus: from,
      newStatus: to,
    },
    idempotencyKey: `sub-changed:${to}:${idemSuffix}`,
  });
  return true;
}

/** Ativa subscription (trial/past_due → active) + emite subscription.activated. */
export async function activateSubscription(
  tx: Tx,
  clinicId: string,
  idemSuffix: string,
): Promise<void> {
  const [sub] = await tx
    .select({
      id: subscriptions.id,
      status: subscriptions.billingStatus,
      planCode: plans.code,
    })
    .from(subscriptions)
    .innerJoin(plans, eq(plans.id, subscriptions.planId))
    .where(eq(subscriptions.clinicId, clinicId))
    .limit(1);
  if (!sub) return;
  await setBillingStatus(tx, clinicId, 'active', 'payment received', idemSuffix);
  // Reseta dunning ao regularizar.
  await tx.update(subscriptions).set({ dunningStage: 0 }).where(eq(subscriptions.id, sub.id));
  await publishEvent(tx, {
    clinicId,
    eventType: BILLING_EVENTS.SUBSCRIPTION_ACTIVATED,
    payload: { clinicId, subscriptionId: sub.id, planCode: toPlanCode(sub.planCode) },
    idempotencyKey: `sub-activated:${idemSuffix}`,
  });
}

/**
 * Materializa a invoice local a partir de um pagamento do Asaas (out-of-order
 * safe). Se já existe (por asaas_payment_id) retorna; senão resolve a subscription
 * por asaas_subscription_id e cria a invoice `open` + emite invoice.generated.
 * Retorna null se não há subscription local atribuível (evento ignorável).
 */
export async function ensureInvoiceForPayment(
  tx: Tx,
  p: {
    paymentId: string;
    subscriptionId: string | null;
    value: number | null;
    dueDate: string | null;
  },
): Promise<InvoiceRow | null> {
  const [existing] = await tx
    .select()
    .from(invoices)
    .where(eq(invoices.asaasPaymentId, p.paymentId))
    .limit(1);
  if (existing) return existing;
  if (!p.subscriptionId) return null;

  const [sub] = await tx
    .select({ id: subscriptions.id, clinicId: subscriptions.clinicId })
    .from(subscriptions)
    .where(eq(subscriptions.asaasSubscriptionId, p.subscriptionId))
    .limit(1);
  if (!sub) return null;

  const due = p.dueDate ?? new Date().toISOString().slice(0, 10);
  const [created] = await tx
    .insert(invoices)
    .values({
      clinicId: sub.clinicId,
      subscriptionId: sub.id,
      totalAmount: toReaisString(toCents(p.value ?? 0)),
      status: 'open',
      dueDate: due,
      asaasPaymentId: p.paymentId,
    })
    .onConflictDoNothing({
      target: invoices.asaasPaymentId,
      where: sql`asaas_payment_id IS NOT NULL`,
    })
    .returning();
  if (!created) {
    // corrida: outra entrega criou a invoice — re-seleciona (idempotente).
    const [again] = await tx
      .select()
      .from(invoices)
      .where(eq(invoices.asaasPaymentId, p.paymentId))
      .limit(1);
    return again ?? null;
  }
  await publishEvent(tx, {
    clinicId: sub.clinicId,
    eventType: BILLING_EVENTS.INVOICE_GENERATED,
    payload: {
      clinicId: sub.clinicId,
      invoiceId: created.id,
      subscriptionId: sub.id,
      totalAmount: toReais(toCents(created.totalAmount)),
      dueDate: due,
    },
    idempotencyKey: `invoice-generated:${p.paymentId}`,
  });
  await recordBillingEvent(tx, sub.clinicId, 'invoice.generated', { invoiceId: created.id });
  return created;
}

/** PAYMENT_RECEIVED: invoice → paid (monotônico) + attempt + reativa acesso. */
export async function markInvoicePaid(
  tx: Tx,
  clinicId: string,
  invoice: InvoiceRow,
  opts: { paymentMethod: string | null; providerPaymentId: string | null; idemSuffix: string },
): Promise<void> {
  await tx.insert(paymentAttempts).values({
    clinicId,
    invoiceId: invoice.id,
    providerPaymentId: opts.providerPaymentId,
    status: 'confirmed',
  });
  if (canTransitionInvoice(invoice.status, 'paid') && invoice.status !== 'paid') {
    await tx
      .update(invoices)
      .set({ status: 'paid', paidAt: sql`now()`, paymentMethod: opts.paymentMethod })
      .where(eq(invoices.id, invoice.id));
    await publishEvent(tx, {
      clinicId,
      eventType: BILLING_EVENTS.INVOICE_PAID,
      payload: {
        clinicId,
        invoiceId: invoice.id,
        totalAmount: toReais(toCents(invoice.totalAmount)),
        paidAt: new Date().toISOString(),
        paymentMethod: opts.paymentMethod,
      },
      idempotencyKey: `invoice-paid:${opts.idemSuffix}`,
    });
    await recordBillingEvent(tx, clinicId, 'invoice.paid', { invoiceId: invoice.id });
  }
  // BILLING-001 — abre o período que esta cobrança pagou. Roda ANTES de ativar:
  // quem lê a subscription no evento de ativação já vê o ciclo novo, não o
  // trial encerrado.
  await advanceBillingPeriod(tx, clinicId, invoice);

  // Pagamento recebido reativa acesso + billing_status (decisão de ClinicaOS).
  await activateSubscription(tx, clinicId, opts.idemSuffix);
  await setClinicAccess(tx, clinicId, 'enabled', 'payment received', opts.idemSuffix);
}

/**
 * BILLING-001 — preenche o período da invoice paga e avança o ciclo da
 * subscription.
 *
 * Fica fora do `if` da transição de propósito: uma reentrega do webhook sobre
 * uma invoice já `paid` REPARA um período ausente em vez de ignorá-lo — que é
 * exatamente o estado que uma cobrança paga antes desta correção deixaria.
 * Continua idempotente porque só escreve o que ainda falta.
 */
async function advanceBillingPeriod(tx: Tx, clinicId: string, invoice: InvoiceRow): Promise<void> {
  const [sub] = await tx
    .select({
      id: subscriptions.id,
      cycle: prices.billingCycle,
      currentPeriodEnd: subscriptions.currentPeriodEnd,
    })
    .from(subscriptions)
    .innerJoin(prices, eq(prices.id, subscriptions.priceId))
    .where(eq(subscriptions.clinicId, clinicId))
    .limit(1);
  // Sem subscription/preço não há ciclo a derivar (cobrança avulsa, upgrade
  // one-off): a invoice permanece sem período, como já era.
  if (!sub) return;

  const period = billingPeriodFor(invoice.dueDate, sub.cycle);

  if (invoice.periodStart === null || invoice.periodEnd === null) {
    await tx
      .update(invoices)
      .set({ periodStart: period.start, periodEnd: period.end })
      .where(eq(invoices.id, invoice.id));
  }

  if (!shouldAdvanceSubscriptionPeriod(sub.currentPeriodEnd, period.end)) return;
  // O predicado no WHERE fecha a corrida entre webhook e reconcile: dois
  // caminhos concorrentes chegam ao mesmo estado final, e o pagamento tardio de
  // uma invoice antiga não regride o ciclo corrente.
  await tx
    .update(subscriptions)
    .set({
      currentPeriodStart: sql`${period.start}::date`,
      currentPeriodEnd: sql`${period.end}::date`,
    })
    .where(
      and(
        eq(subscriptions.id, sub.id),
        or(
          isNull(subscriptions.currentPeriodEnd),
          lt(subscriptions.currentPeriodEnd, sql`${period.end}::date`),
        ),
      ),
    );
  await recordBillingEvent(tx, clinicId, 'subscription.period_advanced', {
    invoiceId: invoice.id,
    periodStart: period.start,
    periodEnd: period.end,
  });
}

/** PAYMENT_OVERDUE: invoice → overdue + attempt declined + eventos. */
export async function markInvoiceOverdue(
  tx: Tx,
  clinicId: string,
  invoice: InvoiceRow,
  opts: { providerPaymentId: string | null; idemSuffix: string; daysOverdue: number },
): Promise<void> {
  const [attempt] = await tx
    .insert(paymentAttempts)
    .values({
      clinicId,
      invoiceId: invoice.id,
      providerPaymentId: opts.providerPaymentId,
      status: 'declined',
      failureReason: 'overdue',
    })
    .returning({ id: paymentAttempts.id });

  if (canTransitionInvoice(invoice.status, 'overdue') && invoice.status !== 'overdue') {
    await tx.update(invoices).set({ status: 'overdue' }).where(eq(invoices.id, invoice.id));
    await publishEvent(tx, {
      clinicId,
      eventType: BILLING_EVENTS.INVOICE_OVERDUE,
      payload: { clinicId, invoiceId: invoice.id, daysOverdue: Math.max(0, opts.daysOverdue) },
      idempotencyKey: `invoice-overdue:${opts.idemSuffix}`,
    });
  }
  await publishEvent(tx, {
    clinicId,
    eventType: BILLING_EVENTS.PAYMENT_FAILED,
    payload: { clinicId, invoiceId: invoice.id, attemptId: attempt!.id, reason: 'overdue' },
    idempotencyKey: `payment-failed:${opts.idemSuffix}`,
  });
  await setBillingStatus(tx, clinicId, 'past_due', 'payment overdue', opts.idemSuffix);
  await recordBillingEvent(tx, clinicId, 'invoice.overdue', { invoiceId: invoice.id });
}

/** PAYMENT_REFUNDED: attempt refunded + evento (invoice permanece 'paid'). */
export async function markInvoiceRefunded(
  tx: Tx,
  clinicId: string,
  invoice: InvoiceRow,
  opts: { providerPaymentId: string | null; idemSuffix: string },
): Promise<void> {
  await tx.insert(paymentAttempts).values({
    clinicId,
    invoiceId: invoice.id,
    providerPaymentId: opts.providerPaymentId,
    status: 'refunded',
  });
  await publishEvent(tx, {
    clinicId,
    eventType: BILLING_EVENTS.INVOICE_REFUNDED,
    payload: { clinicId, invoiceId: invoice.id, amount: toReais(toCents(invoice.totalAmount)) },
    idempotencyKey: `invoice-refunded:${opts.idemSuffix}`,
  });
  await recordBillingEvent(tx, clinicId, 'invoice.refunded', { invoiceId: invoice.id });
}

/** Test-only: mantém a validação do contrato do evento sem mockar o banco. */
// `advanceBillingPeriod` é privado (só `markInvoicePaid` deve abrir período),
// mas precisa de teste próprio: é onde mora a regra de BILLING-001.
export const __testing__ = { toPlanCode, advanceBillingPeriod };
