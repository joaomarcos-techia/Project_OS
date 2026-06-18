/**
 * Orquestração de subscription/invoice (C13). Aplica transições MONOTÔNICAS
 * (state-machine.ts), grava billing_events (timeline da conta — sem consumidores),
 * payment_attempts, e emite billing.* via outbox. Usado pelo webhook e crons.
 *
 * ADR-016/025: Asaas atualiza billing; ClinicaOS DECIDE acesso. A escrita de
 * `clinics.status` aqui é o ponto sancionado dessa decisão (control write de
 * tabela única, não import de schema cross-context).
 */
import { eq, sql } from 'drizzle-orm';

import type { Tx } from '@/lib/db';
import { publishEvent } from '@/lib/outbox/publish';

import { BILLING_EVENTS } from '../events';
import {
  billingEvents,
  invoices,
  paymentAttempts,
  subscriptionHistory,
  subscriptions,
  type InvoiceRow,
} from '../schema';
import { type AccessMode, accessModeToClinicStatus } from './access';
import { toCents, toReais } from './money';
import { canTransitionBilling, canTransitionInvoice, type BillingStatus } from './state-machine';

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
    .select({ id: subscriptions.id, status: subscriptions.billingStatus, planId: subscriptions.planId })
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
    payload: { clinicId, subscriptionId: sub.id, oldPlanCode: null, newPlanCode: null, oldStatus: from, newStatus: to },
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
    .select({ id: subscriptions.id, status: subscriptions.billingStatus, planId: subscriptions.planId })
    .from(subscriptions)
    .where(eq(subscriptions.clinicId, clinicId))
    .limit(1);
  if (!sub) return;
  await setBillingStatus(tx, clinicId, 'active', 'payment received', idemSuffix);
  // Reseta dunning ao regularizar.
  await tx.update(subscriptions).set({ dunningStage: 0 }).where(eq(subscriptions.id, sub.id));
  await publishEvent(tx, {
    clinicId,
    eventType: BILLING_EVENTS.SUBSCRIPTION_ACTIVATED,
    payload: { clinicId, subscriptionId: sub.id, planCode: 'solo' as const },
    idempotencyKey: `sub-activated:${idemSuffix}`,
  });
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
  // Pagamento recebido reativa acesso + billing_status (decisão de ClinicaOS).
  await activateSubscription(tx, clinicId, opts.idemSuffix);
  await setClinicAccess(tx, clinicId, 'enabled', 'payment received', opts.idemSuffix);
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
