/**
 * Saga de alteração de plano. O estado local é persistido ANTES de qualquer I/O
 * com o Asaas; assim um timeout de POST pode ser conciliado pela
 * `externalReference` sem criar uma cobrança duplicada.
 */
import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';

import type { Tx } from '@/lib/db';
import { withTenant } from '@/lib/db/tenant';
import { publishEvent } from '@/lib/outbox/publish';

import { BILLING_EVENTS } from '../events';
import {
  billingCustomers,
  billingEvents,
  invoiceItems,
  invoices,
  paymentAttempts,
  plans,
  planLimits,
  prices,
  subscriptionChangeRequests,
  subscriptionHistory,
  subscriptions,
} from '../schema';
import { toCents, toReais, toReaisString } from './money';
import { setClinicAccess } from './subscriptions';

const PLAN_RANK: Readonly<Record<string, number>> = { solo: 1, clinica: 2, pro: 3 };
export const PLAN_CHANGE_EXTERNAL_REFERENCE_PREFIX = 'plan-change:';

export class PlanChangeError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'PlanChangeError';
  }
}

export type PlanChangeRequestInput = {
  clinicId: string;
  targetPlanId: string;
  requestedBy: string;
  idempotencyKey: string;
  request: { ip: string | null; origin: string | null; requestId: string };
  now?: Date;
};

export type RequestedPlanChange = {
  id: string;
  kind: 'upgrade' | 'downgrade';
  status: 'pending_payment' | 'scheduled';
  effectiveAt: Date;
  prorationAmount: string | null;
  targetPlanName: string;
};

export type CancellationRequestInput = {
  clinicId: string;
  requestedBy: string;
  idempotencyKey: string;
  request: { ip: string | null; origin: string | null; requestId: string };
  now?: Date;
};

export type RequestedCancellation = {
  id: string;
  kind: 'cancellation';
  status: 'scheduled';
  effectiveAt: Date;
};

export type SubscriptionReactivationContext = {
  asaasSubscriptionId: string;
  value: number;
  nextDueDate: string;
};

type CurrentSubscription = {
  id: string;
  planId: string;
  priceId: string;
  planCode: string;
  planName: string;
  priceAmount: string;
  /** Campanha do preço FIXADO na assinatura. `null` = preço de tabela. */
  campaignCode: string | null;
  billingCycle: 'monthly' | 'annual';
  billingStatus: 'trial' | 'active' | 'past_due' | 'cancelled';
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  asaasSubscriptionId: string | null;
};

type TargetPlan = { id: string; name: string; code: string; priceId: string; priceAmount: string };

function rank(code: string): number {
  const value = PLAN_RANK[code];
  if (!value) throw new PlanChangeError('Plano não suportado para alteração.', 'unsupported_plan');
  return value;
}

export function comparePlans(currentCode: string, targetCode: string): -1 | 0 | 1 {
  const delta = rank(targetCode) - rank(currentCode);
  return delta === 0 ? 0 : delta > 0 ? 1 : -1;
}

/** Rateio em centavos, sempre baseado no período persistido pela assinatura. */
export function calculateUpgradeProration(
  currentAmount: string | number,
  targetAmount: string | number,
  periodStart: Date,
  periodEnd: Date,
  now: Date,
): number {
  const deltaCents = toCents(targetAmount) - toCents(currentAmount);
  if (deltaCents <= 0) return 0;
  const totalMs = periodEnd.getTime() - periodStart.getTime();
  if (totalMs <= 0) throw new PlanChangeError('Período da assinatura inválido.', 'invalid_period');
  const remainingMs = Math.max(0, Math.min(totalMs, periodEnd.getTime() - now.getTime()));
  // Arredonda para cima: a cobrança nunca fica abaixo de um centavo devido ao rateio.
  return Math.ceil((deltaCents * remainingMs) / totalMs);
}

export function planChangeExternalReference(changeId: string): string {
  return `${PLAN_CHANGE_EXTERNAL_REFERENCE_PREFIX}${changeId}`;
}

export function changeIdFromExternalReference(value: string | null): string | null {
  if (!value?.startsWith(PLAN_CHANGE_EXTERNAL_REFERENCE_PREFIX)) return null;
  const id = value.slice(PLAN_CHANGE_EXTERNAL_REFERENCE_PREFIX.length);
  return /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id) ? id : null;
}

async function readCurrentSubscription(tx: Tx, clinicId: string): Promise<CurrentSubscription> {
  const [row] = await tx
    .select({
      id: subscriptions.id,
      planId: subscriptions.planId,
      priceId: subscriptions.priceId,
      planCode: plans.code,
      planName: plans.name,
      priceAmount: prices.amount,
      campaignCode: prices.campaignCode,
      billingCycle: prices.billingCycle,
      billingStatus: subscriptions.billingStatus,
      currentPeriodStart: subscriptions.currentPeriodStart,
      currentPeriodEnd: subscriptions.currentPeriodEnd,
      asaasSubscriptionId: subscriptions.asaasSubscriptionId,
    })
    .from(subscriptions)
    .innerJoin(plans, eq(plans.id, subscriptions.planId))
    .innerJoin(prices, eq(prices.id, subscriptions.priceId))
    .where(eq(subscriptions.clinicId, clinicId))
    .limit(1);
  if (!row) throw new PlanChangeError('Assinatura não encontrada.', 'subscription_not_found');
  return row as CurrentSubscription;
}

/**
 * Escolhe, entre os preços vigentes de um plano, o que respeita a campanha da
 * assinatura. Puro porque é a regra que decide QUANTO a clínica passa a pagar —
 * ela precisa ser afirmável sem banco.
 *
 * Fallback ao preço de tabela é deliberado: se o plano de destino não tem linha
 * da campanha, cobrar o cheio é melhor do que recusar a troca.
 */
export function pickPriceForCampaign<T extends { campaignCode: string | null }>(
  candidates: readonly T[],
  campaignCode: string | null,
): T | undefined {
  if (campaignCode) {
    const promocional = candidates.find((c) => c.campaignCode === campaignCode);
    if (promocional) return promocional;
  }
  return candidates.find((c) => c.campaignCode === null);
}

/**
 * Resolve o preço do plano de destino PRESERVANDO a campanha da assinatura
 * atual. Uma clínica que entrou pelo link paga preço de fundador; se trocar de
 * plano e caísse no preço de tabela, ela perderia o desconto vitalício sem
 * jamais ter pedido isso — e por um caminho que nem menciona preço promocional.
 *
 * Fallback é deliberado: se o plano de destino não tem linha da campanha, o
 * preço de tabela vale. Melhor cobrar o cheio do que recusar a troca.
 */
async function readTargetPlan(
  tx: Tx,
  targetPlanId: string,
  billingCycle: 'monthly' | 'annual',
  campaignCode: string | null,
): Promise<TargetPlan> {
  const candidates = await tx
    .select({
      id: plans.id,
      name: plans.name,
      code: plans.code,
      priceId: prices.id,
      priceAmount: prices.amount,
      campaignCode: prices.campaignCode,
    })
    .from(plans)
    .innerJoin(
      prices,
      and(
        eq(prices.planId, plans.id),
        eq(prices.billingCycle, billingCycle),
        isNull(prices.activeUntil),
        campaignCode
          ? or(isNull(prices.campaignCode), eq(prices.campaignCode, campaignCode))
          : isNull(prices.campaignCode),
      ),
    )
    .where(and(eq(plans.id, targetPlanId), eq(plans.ativo, true)));
  const row = pickPriceForCampaign(candidates, campaignCode);
  if (!row)
    throw new PlanChangeError('Plano indisponível para o ciclo atual.', 'target_plan_unavailable');
  return row;
}

async function assertExactlyOneActiveUser(tx: Tx, clinicId: string): Promise<void> {
  const [row] = await tx.execute<{ active_users: number }>(sql`
    SELECT count(*)::int AS active_users
      FROM public.profiles
     WHERE clinic_id = ${clinicId}::uuid
       AND ativo = true
       AND deleted_at IS NULL
  `);
  if (Number(row?.active_users ?? 0) !== 1) {
    throw new PlanChangeError(
      'O downgrade só é permitido para clínicas com exatamente um usuário ativo.',
      'downgrade_requires_one_active_user',
    );
  }
}

async function cancelScheduledDowngrade(tx: Tx, subscriptionId: string): Promise<void> {
  await tx
    .update(subscriptionChangeRequests)
    .set({ status: 'cancelled', cancelledAt: sql`now()` })
    .where(
      and(
        eq(subscriptionChangeRequests.subscriptionId, subscriptionId),
        eq(subscriptionChangeRequests.kind, 'downgrade'),
        eq(subscriptionChangeRequests.status, 'scheduled'),
      ),
    );
}

async function cancelScheduledCancellation(tx: Tx, subscriptionId: string): Promise<void> {
  await tx
    .update(subscriptionChangeRequests)
    .set({ status: 'cancelled', cancelledAt: sql`now()` })
    .where(
      and(
        eq(subscriptionChangeRequests.subscriptionId, subscriptionId),
        eq(subscriptionChangeRequests.kind, 'cancellation'),
        eq(subscriptionChangeRequests.status, 'scheduled'),
      ),
    );
  await tx
    .update(subscriptions)
    .set({ cancelAtPeriodEnd: false })
    .where(eq(subscriptions.id, subscriptionId));
}

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Mantém o dia do mês quando possível (31/01 -> 28/02, nunca março). */
export function nextPeriodEnd(start: Date, billingCycle: 'monthly' | 'annual'): Date {
  const months = billingCycle === 'annual' ? 12 : 1;
  const year = start.getUTCFullYear();
  const month = start.getUTCMonth() + months;
  const targetYear = year + Math.floor(month / 12);
  const targetMonth = ((month % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(
      targetYear,
      targetMonth,
      Math.min(start.getUTCDate(), lastDay),
      start.getUTCHours(),
      start.getUTCMinutes(),
      start.getUTCSeconds(),
      start.getUTCMilliseconds(),
    ),
  );
}

export async function requestPlanChange(
  tx: Tx,
  input: PlanChangeRequestInput,
): Promise<RequestedPlanChange> {
  const now = input.now ?? new Date();
  const current = await readCurrentSubscription(tx, input.clinicId);
  if (current.billingStatus !== 'active') {
    throw new PlanChangeError(
      'A alteração de plano exige uma assinatura ativa.',
      'subscription_not_active',
    );
  }
  const target = await readTargetPlan(
    tx,
    input.targetPlanId,
    current.billingCycle,
    current.campaignCode,
  );
  const direction = comparePlans(current.planCode, target.code);
  if (direction === 0) throw new PlanChangeError('Este já é o plano atual.', 'same_plan');

  const [existing] = await tx
    .select({
      id: subscriptionChangeRequests.id,
      kind: subscriptionChangeRequests.kind,
      status: subscriptionChangeRequests.status,
    })
    .from(subscriptionChangeRequests)
    .where(
      and(
        eq(subscriptionChangeRequests.subscriptionId, current.id),
        inArray(subscriptionChangeRequests.status, ['pending_payment', 'scheduled']),
      ),
    )
    .orderBy(desc(subscriptionChangeRequests.createdAt))
    .limit(1);
  if (existing) {
    if (direction === 1 && existing.status === 'scheduled') {
      if (existing.kind === 'downgrade') await cancelScheduledDowngrade(tx, current.id);
      if (existing.kind === 'cancellation') await cancelScheduledCancellation(tx, current.id);
    } else {
      throw new PlanChangeError(
        'Já existe uma alteração de plano em andamento.',
        'change_already_pending',
      );
    }
  }

  if (direction === -1) await assertExactlyOneActiveUser(tx, input.clinicId);

  const isUpgrade = direction === 1;
  const periodStart = current.currentPeriodStart;
  const periodEnd = current.currentPeriodEnd;
  if (!periodEnd || (isUpgrade && !periodStart)) {
    throw new PlanChangeError(
      'A assinatura ainda não possui um ciclo de cobrança válido.',
      'period_unavailable',
    );
  }

  const prorationCents = isUpgrade
    ? calculateUpgradeProration(
        current.priceAmount,
        target.priceAmount,
        periodStart!,
        periodEnd,
        now,
      )
    : null;
  const status = isUpgrade ? 'pending_payment' : 'scheduled';
  const [created] = await tx
    .insert(subscriptionChangeRequests)
    .values({
      clinicId: input.clinicId,
      subscriptionId: current.id,
      kind: isUpgrade ? 'upgrade' : 'downgrade',
      status,
      fromPlanId: current.planId,
      fromPriceId: current.priceId,
      toPlanId: target.id,
      toPriceId: target.priceId,
      prorationAmount: prorationCents === null ? null : toReaisString(prorationCents),
      effectiveAt: isUpgrade ? now : periodEnd,
      idempotencyKey: input.idempotencyKey,
      requestedBy: input.requestedBy,
      requestedIp: input.request.ip,
      requestedOrigin: input.request.origin,
      requestId: input.request.requestId,
    })
    .returning({ id: subscriptionChangeRequests.id });
  if (!created)
    throw new PlanChangeError('Não foi possível registrar a alteração.', 'change_not_created');

  await tx.insert(billingEvents).values({
    clinicId: input.clinicId,
    type: 'subscription.change.requested',
    payload: {
      changeId: created.id,
      kind: isUpgrade ? 'upgrade' : 'downgrade',
      fromPlanCode: current.planCode,
      toPlanCode: target.code,
      effectiveAt: (isUpgrade ? now : periodEnd).toISOString(),
      prorationAmount: prorationCents === null ? null : toReais(prorationCents),
    } as never,
  });

  return {
    id: created.id,
    kind: isUpgrade ? 'upgrade' : 'downgrade',
    status,
    effectiveAt: isUpgrade ? now : periodEnd,
    prorationAmount: prorationCents === null ? null : toReaisString(prorationCents),
    targetPlanName: target.name,
  };
}

/** Agenda o cancelamento apenas para o fim do ciclo vigente. */
export async function requestSubscriptionCancellation(
  tx: Tx,
  input: CancellationRequestInput,
): Promise<RequestedCancellation> {
  const current = await readCurrentSubscription(tx, input.clinicId);
  if (current.billingStatus !== 'active') {
    throw new PlanChangeError(
      'O cancelamento exige uma assinatura ativa.',
      'subscription_not_active',
    );
  }
  if (!current.currentPeriodEnd) {
    throw new PlanChangeError(
      'A assinatura ainda não possui um ciclo de cobrança válido.',
      'period_unavailable',
    );
  }

  const [existing] = await tx
    .select({ id: subscriptionChangeRequests.id })
    .from(subscriptionChangeRequests)
    .where(
      and(
        eq(subscriptionChangeRequests.subscriptionId, current.id),
        inArray(subscriptionChangeRequests.status, ['pending_payment', 'scheduled']),
      ),
    )
    .limit(1);
  if (existing) {
    throw new PlanChangeError(
      'Já existe uma alteração de assinatura em andamento.',
      'change_already_pending',
    );
  }

  const [created] = await tx
    .insert(subscriptionChangeRequests)
    .values({
      clinicId: input.clinicId,
      subscriptionId: current.id,
      kind: 'cancellation',
      status: 'scheduled',
      fromPlanId: current.planId,
      fromPriceId: current.priceId,
      effectiveAt: current.currentPeriodEnd,
      idempotencyKey: input.idempotencyKey,
      requestedBy: input.requestedBy,
      requestedIp: input.request.ip,
      requestedOrigin: input.request.origin,
      requestId: input.request.requestId,
    })
    .returning({ id: subscriptionChangeRequests.id });
  if (!created) {
    throw new PlanChangeError('Não foi possível registrar o cancelamento.', 'change_not_created');
  }
  await tx
    .update(subscriptions)
    .set({ cancelAtPeriodEnd: true })
    .where(eq(subscriptions.id, current.id));
  await tx.insert(billingEvents).values({
    clinicId: input.clinicId,
    type: 'subscription.cancellation.requested',
    payload: {
      changeId: created.id,
      effectiveAt: current.currentPeriodEnd.toISOString(),
    } as never,
  });
  return {
    id: created.id,
    kind: 'cancellation',
    status: 'scheduled',
    effectiveAt: current.currentPeriodEnd,
  };
}

/** Revoga um cancelamento antes de sua efetivação no provedor. */
export async function revokeSubscriptionCancellation(
  tx: Tx,
  input: Omit<CancellationRequestInput, 'now'>,
): Promise<{ revoked: true; effectiveAt: Date }> {
  const current = await readCurrentSubscription(tx, input.clinicId);
  const [change] = await tx
    .select({
      id: subscriptionChangeRequests.id,
      effectiveAt: subscriptionChangeRequests.effectiveAt,
    })
    .from(subscriptionChangeRequests)
    .where(
      and(
        eq(subscriptionChangeRequests.subscriptionId, current.id),
        eq(subscriptionChangeRequests.kind, 'cancellation'),
        eq(subscriptionChangeRequests.status, 'scheduled'),
      ),
    )
    .limit(1);
  if (!change) {
    throw new PlanChangeError(
      'Nenhum cancelamento agendado foi encontrado.',
      'cancellation_not_scheduled',
    );
  }
  await cancelScheduledCancellation(tx, current.id);
  await tx.insert(subscriptionHistory).values({
    clinicId: input.clinicId,
    subscriptionId: current.id,
    oldPlanId: current.planId,
    newPlanId: current.planId,
    oldStatus: current.billingStatus,
    newStatus: current.billingStatus,
    changedBy: input.requestedBy,
    reason: 'cancellation_revoked',
  });
  await tx.insert(billingEvents).values({
    clinicId: input.clinicId,
    type: 'subscription.cancellation.revoked',
    payload: { changeId: change.id, effectiveAt: change.effectiveAt.toISOString() } as never,
  });
  return { revoked: true, effectiveAt: change.effectiveAt };
}

/**
 * Lê os dados mínimos para reativar a recorrência preservada como INACTIVE no
 * Asaas. A chamada remota acontece antes da escrita local; se esta falhar, um
 * novo submit repete o PUT idempotente e só então conclui a transação local.
 */
export async function getSubscriptionReactivationContext(
  clinicId: string,
  now: Date = new Date(),
): Promise<SubscriptionReactivationContext> {
  return withTenant(clinicId, async (tx) => {
    const current = await readCurrentSubscription(tx, clinicId);
    if (current.billingStatus !== 'cancelled') {
      throw new PlanChangeError('A assinatura não está cancelada.', 'subscription_not_cancelled');
    }
    if (!current.asaasSubscriptionId) {
      throw new PlanChangeError(
        'Assinatura Asaas não encontrada para reativação.',
        'asaas_subscription_missing',
      );
    }
    const value = Number(current.priceAmount);
    if (!Number.isFinite(value) || value <= 0) {
      throw new PlanChangeError('Valor da assinatura inválido para reativação.', 'invalid_price');
    }
    return {
      asaasSubscriptionId: current.asaasSubscriptionId,
      value,
      nextDueDate: dateOnly(now),
    };
  });
}

/** Confirma localmente uma reativação que o Asaas já aceitou. */
export async function reactivateSubscription(
  tx: Tx,
  input: { clinicId: string; requestedBy: string; now: Date },
): Promise<{ reactivated: true }> {
  const current = await readCurrentSubscription(tx, input.clinicId);
  if (current.billingStatus !== 'cancelled') {
    throw new PlanChangeError('A assinatura não está cancelada.', 'subscription_not_cancelled');
  }
  const periodEnd = nextPeriodEnd(input.now, current.billingCycle);
  await tx
    .update(subscriptions)
    .set({
      billingStatus: 'active',
      cancelAtPeriodEnd: false,
      cancelledAt: null,
      currentPeriodStart: input.now,
      currentPeriodEnd: periodEnd,
      dunningStage: 0,
    })
    .where(eq(subscriptions.id, current.id));
  await tx.insert(subscriptionHistory).values({
    clinicId: input.clinicId,
    subscriptionId: current.id,
    oldPlanId: current.planId,
    newPlanId: current.planId,
    oldStatus: 'cancelled',
    newStatus: 'active',
    changedBy: input.requestedBy,
    reason: 'subscription_reactivated',
  });
  await setClinicAccess(
    tx,
    input.clinicId,
    'enabled',
    'subscription reactivated',
    `subscription-reactivated:${current.id}`,
  );
  await publishEvent(tx, {
    clinicId: input.clinicId,
    eventType: BILLING_EVENTS.SUBSCRIPTION_ACTIVATED,
    payload: {
      clinicId: input.clinicId,
      subscriptionId: current.id,
      planCode: current.planCode as 'solo' | 'clinica' | 'pro',
    },
    idempotencyKey: `subscription-reactivated:${current.id}`,
  });
  await tx.insert(billingEvents).values({
    clinicId: input.clinicId,
    type: 'subscription.reactivated',
    payload: { subscriptionId: current.id, nextDueDate: dateOnly(input.now) } as never,
  });
  return { reactivated: true };
}

export type UpgradePaymentContext = {
  changeId: string;
  clinicId: string;
  customerId: string;
  amountCents: number;
  targetPlanName: string;
  dueDate: string;
  providerPaymentId: string | null;
  providerPaymentUrl: string | null;
};

export async function getUpgradePaymentContext(
  tx: Tx,
  clinicId: string,
  changeId: string,
): Promise<UpgradePaymentContext> {
  const [change] = await tx
    .select({
      id: subscriptionChangeRequests.id,
      status: subscriptionChangeRequests.status,
      kind: subscriptionChangeRequests.kind,
      amount: subscriptionChangeRequests.prorationAmount,
      providerPaymentId: subscriptionChangeRequests.providerPaymentId,
      providerPaymentUrl: subscriptionChangeRequests.providerPaymentUrl,
      targetPlanName: plans.name,
    })
    .from(subscriptionChangeRequests)
    .innerJoin(plans, eq(plans.id, subscriptionChangeRequests.toPlanId))
    .where(
      and(
        eq(subscriptionChangeRequests.id, changeId),
        eq(subscriptionChangeRequests.clinicId, clinicId),
      ),
    )
    .limit(1);
  if (!change || change.kind !== 'upgrade' || change.status !== 'pending_payment') {
    throw new PlanChangeError('Upgrade pendente não encontrado.', 'upgrade_not_pending');
  }
  const [customer] = await tx
    .select({ asaasCustomerId: billingCustomers.asaasCustomerId })
    .from(billingCustomers)
    .where(eq(billingCustomers.clinicId, clinicId))
    .limit(1);
  if (!customer?.asaasCustomerId) {
    throw new PlanChangeError(
      'Cliente de cobrança Asaas não encontrado.',
      'billing_customer_missing',
    );
  }
  const amountCents = toCents(change.amount ?? '0');
  if (amountCents <= 0)
    throw new PlanChangeError('Valor proporcional inválido.', 'invalid_proration');
  return {
    changeId: change.id,
    clinicId,
    customerId: customer.asaasCustomerId,
    amountCents,
    targetPlanName: change.targetPlanName,
    dueDate: new Date().toISOString().slice(0, 10),
    providerPaymentId: change.providerPaymentId,
    providerPaymentUrl: change.providerPaymentUrl,
  };
}

type ProviderPaymentForChange = {
  paymentId: string;
  invoiceUrl: string | null;
  value: number;
  dueDate: string;
  billingType: string | null;
};

async function ensureUpgradeInvoice(
  tx: Tx,
  clinicId: string,
  changeId: string,
  payment: ProviderPaymentForChange,
): Promise<{ id: string; status: 'open' | 'paid' | 'partial' | 'overdue' | 'cancelled' }> {
  const [existing] = await tx
    .select({ id: invoices.id, status: invoices.status })
    .from(invoices)
    .where(eq(invoices.asaasPaymentId, payment.paymentId))
    .limit(1);
  if (existing) return existing;

  const [change] = await tx
    .select({
      subscriptionId: subscriptionChangeRequests.subscriptionId,
      amount: subscriptionChangeRequests.prorationAmount,
    })
    .from(subscriptionChangeRequests)
    .where(
      and(
        eq(subscriptionChangeRequests.id, changeId),
        eq(subscriptionChangeRequests.clinicId, clinicId),
      ),
    )
    .limit(1);
  if (!change) throw new PlanChangeError('Alteração de plano não encontrada.', 'change_not_found');
  const created = await tx
    .insert(invoices)
    .values({
      clinicId,
      subscriptionId: change.subscriptionId,
      totalAmount: change.amount ?? toReaisString(toCents(payment.value)),
      dueDate: payment.dueDate || new Date().toISOString().slice(0, 10),
      asaasPaymentId: payment.paymentId,
    })
    .onConflictDoNothing({
      target: invoices.asaasPaymentId,
      where: sql`asaas_payment_id IS NOT NULL`,
    })
    .returning({ id: invoices.id, status: invoices.status });
  const invoice = created[0];
  if (!invoice) {
    const [again] = await tx
      .select({ id: invoices.id, status: invoices.status })
      .from(invoices)
      .where(eq(invoices.asaasPaymentId, payment.paymentId))
      .limit(1);
    if (!again)
      throw new PlanChangeError('Cobrança proporcional não foi persistida.', 'invoice_not_created');
    return again;
  }
  await tx.insert(invoiceItems).values({
    clinicId,
    invoiceId: invoice.id,
    type: 'plan',
    description: 'Ajuste proporcional de upgrade de plano',
    amount: change.amount ?? toReaisString(toCents(payment.value)),
  });
  await tx.insert(billingEvents).values({
    clinicId,
    type: 'subscription.change.payment_created',
    payload: { changeId, invoiceId: invoice.id, providerPaymentId: payment.paymentId } as never,
  });
  return invoice;
}

export async function linkUpgradePayment(
  tx: Tx,
  clinicId: string,
  changeId: string,
  payment: ProviderPaymentForChange,
): Promise<void> {
  const context = await getUpgradePaymentContext(tx, clinicId, changeId);
  if (toCents(payment.value) !== context.amountCents) {
    throw new PlanChangeError(
      'O valor confirmado pelo Asaas diverge do rateio.',
      'proration_mismatch',
    );
  }
  await tx
    .update(subscriptionChangeRequests)
    .set({ providerPaymentId: payment.paymentId, providerPaymentUrl: payment.invoiceUrl })
    .where(
      and(
        eq(subscriptionChangeRequests.id, changeId),
        eq(subscriptionChangeRequests.clinicId, clinicId),
      ),
    );
  await ensureUpgradeInvoice(tx, clinicId, changeId, payment);
}

function paidStatus(status: string): boolean {
  return status === 'RECEIVED' || status === 'CONFIRMED' || status === 'RECEIVED_IN_CASH';
}

export async function applyPaidUpgradeForPayment(
  tx: Tx,
  payment: ProviderPaymentForChange & { externalReference: string | null; status: string },
  idemSuffix: string,
): Promise<boolean> {
  if (!paidStatus(payment.status)) return false;
  const changeId = changeIdFromExternalReference(payment.externalReference);
  if (!changeId) return false;
  const [change] = await tx
    .select()
    .from(subscriptionChangeRequests)
    .where(
      and(
        eq(subscriptionChangeRequests.id, changeId),
        eq(subscriptionChangeRequests.kind, 'upgrade'),
        eq(subscriptionChangeRequests.status, 'pending_payment'),
      ),
    )
    .limit(1);
  if (!change) return false;
  if (toCents(payment.value) !== toCents(change.prorationAmount ?? '0')) {
    throw new PlanChangeError('Pagamento de upgrade com valor inesperado.', 'proration_mismatch');
  }
  if (!change.toPlanId || !change.toPriceId) {
    throw new PlanChangeError('Upgrade sem plano de destino.', 'upgrade_target_missing');
  }

  const invoice = await ensureUpgradeInvoice(tx, change.clinicId, change.id, payment);
  if (invoice.status !== 'paid') {
    await tx
      .update(invoices)
      .set({ status: 'paid', paidAt: sql`now()`, paymentMethod: payment.billingType })
      .where(eq(invoices.id, invoice.id));
    const [attempt] = await tx
      .select({ id: paymentAttempts.id })
      .from(paymentAttempts)
      .where(
        and(
          eq(paymentAttempts.invoiceId, invoice.id),
          eq(paymentAttempts.providerPaymentId, payment.paymentId),
          eq(paymentAttempts.status, 'confirmed'),
        ),
      )
      .limit(1);
    if (!attempt) {
      await tx.insert(paymentAttempts).values({
        clinicId: change.clinicId,
        invoiceId: invoice.id,
        providerPaymentId: payment.paymentId,
        status: 'confirmed',
      });
    }
  }

  const [current] = await tx
    .select({
      id: subscriptions.id,
      planId: subscriptions.planId,
      planCode: plans.code,
      billingStatus: subscriptions.billingStatus,
    })
    .from(subscriptions)
    .innerJoin(plans, eq(plans.id, subscriptions.planId))
    .where(eq(subscriptions.id, change.subscriptionId))
    .limit(1);
  const [target] = await tx
    .select({ code: plans.code })
    .from(plans)
    .where(eq(plans.id, change.toPlanId))
    .limit(1);
  if (!current || !target)
    throw new PlanChangeError(
      'Assinatura do upgrade não encontrada.',
      'upgrade_subscription_missing',
    );

  await tx
    .update(subscriptions)
    .set({ planId: change.toPlanId, priceId: change.toPriceId, cancelAtPeriodEnd: false })
    .where(eq(subscriptions.id, current.id));
  await tx
    .update(subscriptionChangeRequests)
    .set({
      status: 'applied',
      providerPaymentId: payment.paymentId,
      providerPaymentUrl: payment.invoiceUrl,
      appliedAt: sql`now()`,
    })
    .where(eq(subscriptionChangeRequests.id, change.id));
  await tx.insert(subscriptionHistory).values({
    clinicId: change.clinicId,
    subscriptionId: current.id,
    oldPlanId: current.planId,
    newPlanId: change.toPlanId,
    oldStatus: current.billingStatus,
    newStatus: current.billingStatus,
    changedBy: change.requestedBy,
    reason: 'upgrade_payment_confirmed',
  });
  await publishEvent(tx, {
    clinicId: change.clinicId,
    eventType: BILLING_EVENTS.SUBSCRIPTION_CHANGED,
    payload: {
      clinicId: change.clinicId,
      subscriptionId: current.id,
      oldPlanCode: current.planCode as 'solo' | 'clinica' | 'pro',
      newPlanCode: target.code as 'solo' | 'clinica' | 'pro',
      oldStatus: current.billingStatus,
      newStatus: current.billingStatus,
    },
    idempotencyKey: `subscription-change:upgrade:${change.id}:${idemSuffix}`,
  });
  await tx.insert(billingEvents).values({
    clinicId: change.clinicId,
    type: 'subscription.change.applied',
    payload: {
      changeId: change.id,
      kind: 'upgrade',
      providerPaymentId: payment.paymentId,
    } as never,
  });
  return true;
}

export async function applyScheduledPlanChange(
  tx: Tx,
  changeId: string,
  now: Date = new Date(),
): Promise<{ applied: boolean; kind: 'downgrade' | 'cancellation' | null }> {
  const [change] = await tx
    .select()
    .from(subscriptionChangeRequests)
    .where(
      and(
        eq(subscriptionChangeRequests.id, changeId),
        eq(subscriptionChangeRequests.status, 'scheduled'),
      ),
    )
    .limit(1);
  if (!change || change.effectiveAt > now) return { applied: false, kind: null };
  if (change.kind === 'upgrade')
    throw new PlanChangeError('Upgrade não pode ser agendado.', 'invalid_scheduled_upgrade');

  const [current] = await tx
    .select({
      id: subscriptions.id,
      planId: subscriptions.planId,
      planCode: plans.code,
      billingStatus: subscriptions.billingStatus,
    })
    .from(subscriptions)
    .innerJoin(plans, eq(plans.id, subscriptions.planId))
    .where(eq(subscriptions.id, change.subscriptionId))
    .limit(1);
  if (!current)
    throw new PlanChangeError(
      'Assinatura agendada não encontrada.',
      'scheduled_subscription_missing',
    );

  if (change.kind === 'cancellation') {
    await tx
      .update(subscriptions)
      .set({ billingStatus: 'cancelled', cancelAtPeriodEnd: true, cancelledAt: sql`now()` })
      .where(eq(subscriptions.id, current.id));
    await tx.execute(
      sql`UPDATE public.clinics
             SET status = 'cancelled'::clinic_status, updated_at = now()
           WHERE id = ${change.clinicId}::uuid`,
    );
    await tx.insert(subscriptionHistory).values({
      clinicId: change.clinicId,
      subscriptionId: current.id,
      oldPlanId: current.planId,
      oldStatus: current.billingStatus,
      newStatus: 'cancelled',
      changedBy: change.requestedBy,
      reason: 'cancellation_period_end',
    });
    await publishEvent(tx, {
      clinicId: change.clinicId,
      eventType: BILLING_EVENTS.SUBSCRIPTION_CANCELLED,
      payload: {
        clinicId: change.clinicId,
        subscriptionId: current.id,
        reason: 'cancellation_period_end',
        cancelAtPeriodEnd: true,
      },
      idempotencyKey: `subscription-change:cancel:${change.id}`,
    });
  } else {
    if (!change.toPlanId || !change.toPriceId) {
      throw new PlanChangeError('Downgrade sem plano de destino.', 'downgrade_target_missing');
    }
    await assertExactlyOneActiveUser(tx, change.clinicId);
    const [target] = await tx
      .select({ code: plans.code })
      .from(plans)
      .where(eq(plans.id, change.toPlanId))
      .limit(1);
    if (!target)
      throw new PlanChangeError('Plano de downgrade não encontrado.', 'downgrade_plan_missing');
    await tx
      .update(subscriptions)
      .set({ planId: change.toPlanId, priceId: change.toPriceId, cancelAtPeriodEnd: false })
      .where(eq(subscriptions.id, current.id));
    await tx.insert(subscriptionHistory).values({
      clinicId: change.clinicId,
      subscriptionId: current.id,
      oldPlanId: current.planId,
      newPlanId: change.toPlanId,
      oldStatus: current.billingStatus,
      newStatus: current.billingStatus,
      changedBy: change.requestedBy,
      reason: 'downgrade_period_end',
    });
    await publishEvent(tx, {
      clinicId: change.clinicId,
      eventType: BILLING_EVENTS.SUBSCRIPTION_CHANGED,
      payload: {
        clinicId: change.clinicId,
        subscriptionId: current.id,
        oldPlanCode: current.planCode as 'solo' | 'clinica' | 'pro',
        newPlanCode: target.code as 'solo' | 'clinica' | 'pro',
        oldStatus: current.billingStatus,
        newStatus: current.billingStatus,
      },
      idempotencyKey: `subscription-change:downgrade:${change.id}`,
    });
  }
  await tx
    .update(subscriptionChangeRequests)
    .set({ status: 'applied', appliedAt: sql`now()` })
    .where(eq(subscriptionChangeRequests.id, change.id));
  await tx.insert(billingEvents).values({
    clinicId: change.clinicId,
    type: 'subscription.change.applied',
    payload: { changeId: change.id, kind: change.kind } as never,
  });
  return { applied: true, kind: change.kind };
}

export type PlanChangeOverview = {
  current: {
    planId: string;
    planName: string;
    planCode: string;
    priceAmount: string;
    billingCycle: 'monthly' | 'annual';
    billingStatus: 'trial' | 'active' | 'past_due' | 'cancelled';
    periodEnd: string | null;
  };
  plans: Array<{
    id: string;
    name: string;
    code: string;
    priceAmount: string;
    limits: { users: number; agendamentos: number; ai_messages: number };
  }>;
  activeUsers: number;
  pending: { kind: string; status: string; effectiveAt: string; paymentUrl: string | null } | null;
};

export async function getPlanChangeOverview(clinicId: string): Promise<PlanChangeOverview> {
  return withTenant(clinicId, async (tx) => {
    const current = await readCurrentSubscription(tx, clinicId);
    // O catálogo tem que mostrar o MESMO preço que a troca vai cobrar, senão a
    // tela promete um valor e o débito vem outro. Com campanha vêm DUAS linhas
    // por plano (tabela + campanha); o `DISTINCT ON` fica com a da campanha,
    // que é a ordenada primeiro — filtrar em JS deixaria a dedupe implícita.
    const campaignFilter = current.campaignCode
      ? or(isNull(prices.campaignCode), eq(prices.campaignCode, current.campaignCode))
      : isNull(prices.campaignCode);
    const planRows = await tx
      .selectDistinctOn([plans.id], {
        id: plans.id,
        name: plans.name,
        code: plans.code,
        priceAmount: prices.amount,
      })
      .from(plans)
      .innerJoin(
        prices,
        and(
          eq(prices.planId, plans.id),
          eq(prices.billingCycle, current.billingCycle),
          isNull(prices.activeUntil),
          campaignFilter,
        ),
      )
      .where(eq(plans.ativo, true))
      .orderBy(plans.id, sql`case when ${prices.campaignCode} is null then 1 else 0 end`);
    const planIds = planRows.map((row) => row.id);
    const limits = planIds.length
      ? await tx
          .select({
            planId: planLimits.planId,
            metric: planLimits.metric,
            value: planLimits.limitValue,
          })
          .from(planLimits)
          .where(inArray(planLimits.planId, planIds))
      : [];
    const limitsByPlan = new Map<
      string,
      { users: number; agendamentos: number; ai_messages: number }
    >();
    for (const id of planIds) limitsByPlan.set(id, { users: 0, agendamentos: 0, ai_messages: 0 });
    for (const limit of limits) {
      const target = limitsByPlan.get(limit.planId);
      if (target) target[limit.metric] = Number(limit.value);
    }
    const [active] = await tx.execute<{ active_users: number }>(sql`
      SELECT count(*)::int AS active_users
        FROM public.profiles
       WHERE clinic_id = ${clinicId}::uuid
         AND ativo = true
         AND deleted_at IS NULL
    `);
    const [pending] = await tx
      .select({
        kind: subscriptionChangeRequests.kind,
        status: subscriptionChangeRequests.status,
        effectiveAt: subscriptionChangeRequests.effectiveAt,
        paymentUrl: subscriptionChangeRequests.providerPaymentUrl,
      })
      .from(subscriptionChangeRequests)
      .where(
        and(
          eq(subscriptionChangeRequests.subscriptionId, current.id),
          inArray(subscriptionChangeRequests.status, ['pending_payment', 'scheduled']),
        ),
      )
      .orderBy(desc(subscriptionChangeRequests.createdAt))
      .limit(1);
    return {
      current: {
        planId: current.planId,
        planName: current.planName,
        planCode: current.planCode,
        priceAmount: current.priceAmount,
        billingCycle: current.billingCycle,
        billingStatus: current.billingStatus,
        periodEnd: current.currentPeriodEnd?.toISOString() ?? null,
      },
      plans: planRows.map((plan) => ({
        ...plan,
        limits: limitsByPlan.get(plan.id) ?? { users: 0, agendamentos: 0, ai_messages: 0 },
      })),
      activeUsers: Number(active?.active_users ?? 0),
      pending: pending
        ? {
            kind: pending.kind,
            status: pending.status,
            effectiveAt: pending.effectiveAt.toISOString(),
            paymentUrl: pending.paymentUrl,
          }
        : null,
    };
  });
}
