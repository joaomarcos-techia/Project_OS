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
import { metrics } from '@/lib/observability/metrics';
import { publishEvent } from '@/lib/outbox/publish';

import { BILLING_EVENTS, type SubscriptionActivatedPayload } from '../events';
import { isOffer2026PlanCode } from '../proposed-offer';
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
import {
  decideProviderSync,
  type ProviderInvoiceState,
  type ProviderSyncAction,
} from './provider-sync';
import { toCents, toReais, toReaisString } from './money';
import { canTransitionBilling, canTransitionInvoice, type BillingStatus } from './state-machine';

type PlanCode = SubscriptionActivatedPayload['planCode'];

export function toPlanCode(code: string): PlanCode {
  if (code === 'solo' || code === 'clinica' || code === 'pro' || isOffer2026PlanCode(code))
    return code;
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

/**
 * BILLING-002 — reconcilia a invoice local com o estado autoritativo do Asaas.
 *
 * `ensureInvoiceForPayment()` devolve a invoice existente sem olhar `due_date`,
 * `total_amount` ou remoção; sem esta função, uma edição no painel ficava
 * divergente para sempre e uma cobrança excluída seguia `open` local, com o
 * dunning perseguindo algo que não existe mais.
 *
 * NÃO paga nem vence invoice: `paid`/`overdue` continuam saindo do caminho
 * monotônico existente (`markInvoicePaid`/`markInvoiceOverdue`), para que exista
 * UM único lugar que quita uma cobrança. Aqui só se trata o que não tinha dono:
 * data, valor, cancelamento, restauração autoritativa e divergência.
 *
 * Devolve a ação decidida — inclusive as que não aplicou — para o caller rotear
 * e para o teste afirmar sobre a decisão, não sobre o efeito colateral.
 */
export async function syncInvoiceFromProviderPayment(
  tx: Tx,
  clinicId: string,
  invoice: InvoiceRow,
  provider: ProviderInvoiceState,
  opts: { idemSuffix: string; providerConfirmedMissing?: boolean },
): Promise<{ action: ProviderSyncAction; invoice: InvoiceRow }> {
  const action = decideProviderSync(
    {
      status: invoice.status,
      dueDate: invoice.dueDate,
      totalCents: toCents(invoice.totalAmount),
    },
    provider,
    { providerConfirmedMissing: opts.providerConfirmedMissing ?? false },
  );

  if (action.kind === 'noop') return { action, invoice };

  if (action.kind === 'restore') {
    // Exceção estreita ao terminal `cancelled`: o getPayment autoritativo
    // confirmou que a mesma cobrança voltou a existir. O CAS impede duas
    // entregas/eventos concorrentes de restaurarem e auditarem duas vezes.
    const restored = await tx
      .update(invoices)
      .set({
        status: action.status,
        ...(action.dueDate ? { dueDate: action.dueDate } : {}),
        ...(action.totalCents !== undefined
          ? { totalAmount: toReaisString(action.totalCents) }
          : {}),
      })
      .where(and(eq(invoices.id, invoice.id), eq(invoices.status, 'cancelled')))
      .returning();
    if (restored.length === 0) {
      return { action: { kind: 'noop', reason: 'lost_cas' }, invoice };
    }

    await recordBillingEvent(tx, clinicId, 'invoice.restored', {
      invoiceId: invoice.id,
      reason: 'provider_restored',
    });
    metrics.emit('billing.invoice.restored', { clinicId, invoiceId: invoice.id });
    if (action.amountChanged) {
      metrics.emit('billing.invoice.amount_changed', { clinicId, invoiceId: invoice.id });
    }
    return { action, invoice: restored[0]! };
  }

  if (action.kind === 'flag_divergence') {
    // Sem confirmação autoritativa não se decide nada: registra para revisão e
    // alarma. Cancelar aqui seria acreditar num corpo que só tem token estático.
    await recordBillingEvent(tx, clinicId, 'invoice.divergence_detected', {
      invoiceId: invoice.id,
      reason: action.reason,
    });
    metrics.emit('billing.invoice.divergence', { clinicId, invoiceId: invoice.id });
    return { action, invoice };
  }

  if (action.kind === 'terminalize') {
    // Só o cancelamento é aplicado aqui. `paid`/`overdue` voltam ao caller.
    if (action.status !== 'cancelled') return { action, invoice };
    if (!canTransitionInvoice(invoice.status, 'cancelled')) {
      return {
        action: { kind: 'noop', reason: `transition_blocked:${invoice.status}` },
        invoice,
      };
    }
    const cancelled = await tx
      .update(invoices)
      .set({ status: 'cancelled' })
      // CAS pelo status lido: se outra entrega já pagou a invoice entre a
      // decisão e a escrita, esta atualização não encontra a linha.
      .where(and(eq(invoices.id, invoice.id), eq(invoices.status, invoice.status)))
      .returning();
    if (cancelled.length === 0) {
      return { action: { kind: 'noop', reason: 'lost_cas' }, invoice };
    }

    await publishEvent(tx, {
      clinicId,
      eventType: BILLING_EVENTS.INVOICE_CANCELLED,
      payload: { clinicId, invoiceId: invoice.id, reason: 'provider_deleted' },
      idempotencyKey: `invoice-cancelled:${opts.idemSuffix}`,
    });
    await recordBillingEvent(tx, clinicId, 'invoice.cancelled', {
      invoiceId: invoice.id,
      reason: 'provider_deleted',
    });
    return { action, invoice: cancelled[0]! };
  }

  // action.kind === 'update' — data e/ou valor de uma invoice ainda aberta.
  const updated = await tx
    .update(invoices)
    .set({
      ...(action.dueDate ? { dueDate: action.dueDate } : {}),
      ...(action.totalCents !== undefined ? { totalAmount: toReaisString(action.totalCents) } : {}),
    })
    .where(and(eq(invoices.id, invoice.id), eq(invoices.status, invoice.status)))
    .returning();
  if (updated.length === 0) {
    return { action: { kind: 'noop', reason: 'lost_cas' }, invoice };
  }

  await recordBillingEvent(tx, clinicId, 'invoice.synced_from_provider', {
    invoiceId: invoice.id,
    ...(action.dueDate ? { dueDate: action.dueDate } : {}),
    ...(action.totalCents !== undefined ? { totalCents: action.totalCents } : {}),
  });
  if (action.amountChanged) {
    // Mudar quanto o cliente deve nunca passa despercebido.
    metrics.emit('billing.invoice.amount_changed', { clinicId, invoiceId: invoice.id });
  }
  // Devolve a linha ATUALIZADA: quem paga em seguida precisa derivar o período
  // do vencimento novo, não do que estava em memória antes da reconciliação.
  return { action, invoice: updated[0]! };
}

/** Invoice local de um pagamento do provedor (usada quando o GET devolve 404). */
export async function findInvoiceByProviderPayment(
  tx: Tx,
  providerPaymentId: string,
): Promise<InvoiceRow | null> {
  const [row] = await tx
    .select()
    .from(invoices)
    .where(eq(invoices.asaasPaymentId, providerPaymentId))
    .limit(1);
  return row ?? null;
}

/** PAYMENT_RECEIVED: invoice → paid (monotônico) + attempt + reativa acesso. */
export async function markInvoicePaid(
  tx: Tx,
  clinicId: string,
  invoice: InvoiceRow,
  opts: {
    paymentMethod: string | null;
    providerPaymentId: string | null;
    idemSuffix: string;
    deferPeriodAdvance?: boolean;
  },
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
  // Pagamento de uma assinatura CANCELADA não reabre nada. Antes, o caminho
  // abaixo avançava o ciclo, voltava o billing para `active` e liberava o
  // acesso: uma parcela que sobrava no Asaas depois do cancelamento era
  // cobrada E desfazia o cancelamento — a pessoa pedia para sair, pagava e
  // encontrava a assinatura de volta. Reativar é decisão explícita, pelo fluxo
  // auditado de /configuracoes/assinatura. O dinheiro entrou, então a invoice
  // fica `paid` (acima) e o caso vira evento para estorno humano.
  const [sub] = await tx
    .select({
      billingStatus: subscriptions.billingStatus,
      cancelAtPeriodEnd: subscriptions.cancelAtPeriodEnd,
    })
    .from(subscriptions)
    .where(eq(subscriptions.clinicId, clinicId))
    .limit(1);
  if (sub?.billingStatus === 'cancelled') {
    await recordBillingEvent(tx, clinicId, 'invoice.paid_after_cancellation', {
      invoiceId: invoice.id,
      providerPaymentId: opts.providerPaymentId,
    });
    metrics.emit('billing.invoice.paid_after_cancellation', { clinicId, invoiceId: invoice.id });
    return;
  }
  // Cancelamento agendado e ainda assim uma cobrança paga: o cancelamento já
  // devia ter apagado tudo em aberto, então isto é um cartão processado no
  // mesmo instante. Segue o caminho normal (a clínica ainda está ativa), mas
  // sinaliza — ela pagou por um ciclo que o cancelamento não vai entregar.
  if (sub?.cancelAtPeriodEnd) {
    await recordBillingEvent(tx, clinicId, 'invoice.paid_during_scheduled_cancellation', {
      invoiceId: invoice.id,
      providerPaymentId: opts.providerPaymentId,
    });
    metrics.emit('billing.invoice.paid_during_scheduled_cancellation', {
      clinicId,
      invoiceId: invoice.id,
    });
  }

  // BILLING-001 — abre o período que esta cobrança pagou. Roda ANTES de ativar:
  // quem lê a subscription no evento de ativação já vê o ciclo novo, não o
  // trial encerrado.
  if (!opts.deferPeriodAdvance) await advanceBillingPeriod(tx, clinicId, invoice);

  // Pagamento recebido reativa acesso + billing_status (decisão de ClinicaOS).
  await activateSubscription(tx, clinicId, opts.idemSuffix);
  await setClinicAccess(tx, clinicId, 'enabled', 'payment received', opts.idemSuffix);
}

/** Repara pagamento anual antecipado assim que a troca agendada entra em vigor. */
export async function advancePaidCycleChangeInvoicePeriod(
  tx: Tx,
  clinicId: string,
  subscriptionId: string,
  dueDate: string,
  expectedAmount: string,
): Promise<void> {
  const [invoice] = await tx
    .select()
    .from(invoices)
    .where(
      and(
        eq(invoices.subscriptionId, subscriptionId),
        eq(invoices.dueDate, dueDate),
        eq(invoices.status, 'paid'),
      ),
    )
    .limit(1);
  if (!invoice) return;
  if (toCents(invoice.totalAmount) !== toCents(expectedAmount)) {
    throw new Error('[billing] pagamento antecipado diverge do preço do novo ciclo');
  }
  await advanceBillingPeriod(tx, clinicId, invoice);
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
