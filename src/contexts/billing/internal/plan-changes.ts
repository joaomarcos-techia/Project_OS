/**
 * Saga de alteração de plano. O estado local é persistido ANTES de qualquer I/O
 * com o Asaas; assim um timeout de POST pode ser conciliado pela
 * `externalReference` sem criar uma cobrança duplicada.
 */
import { and, desc, eq, inArray, isNull, lt, sql } from 'drizzle-orm';

import type { Tx } from '@/lib/db';
import type { ProviderPayment } from '@/lib/payments/asaas';
import { withTenant } from '@/lib/db/tenant';
import { env } from '@/lib/env';
import { publishEvent } from '@/lib/outbox/publish';

import { BILLING_EVENTS } from '../events';
import { isOffer2026PlanCode, OFFER_2026_PLAN_CODES } from '../proposed-offer';
import { PROPOSED_OFFER } from '../proposed-offer';
import {
  billingCustomers,
  billingEvents,
  invoiceItems,
  invoices,
  paymentAttempts,
  plans,
  planLimits,
  planSeatLimits,
  prices,
  subscriptionChangeRequests,
  subscriptionHistory,
  subscriptions,
} from '../schema';
import { toCents, toReais, toReaisString } from './money';
import { currentPeriod, readUsage } from './quota';
import { setClinicAccess, syncInvoiceFromProviderPayment, toPlanCode } from './subscriptions';

const LEGACY_PLAN_RANK: Readonly<Record<string, number>> = { solo: 1, clinica: 2, pro: 3 };
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

export type RequestedCycleChange = {
  id: string;
  targetCycle: 'monthly' | 'annual';
  targetAmount: string;
  effectiveAt: Date;
};

export type CancellationRequestInput = {
  clinicId: string;
  requestedBy: string;
  idempotencyKey: string;
  request: { ip: string | null; origin: string | null; requestId: string };
  now?: Date;
};

/**
 * O registro local de um cancelamento cujo lado Asaas JÁ foi feito.
 *
 * Os ids vêm de `removeSubscriptionCharges`, e só dele: é a prova de que a
 * recorrência parou e de que aquelas cobranças deixaram de existir. O registro
 * local nunca é gravado antes disso — um cancelamento "só no app" era o defeito.
 */
export type ConfirmedCancellationInput = CancellationRequestInput & {
  removedPaymentIds: readonly string[];
  paidPaymentIds: readonly string[];
};

export type RequestedCancellation = {
  id: string;
  kind: 'cancellation';
  status: 'scheduled';
  effectiveAt: Date;
  removedCharges: number;
};

/** O que o lado Asaas do cancelamento precisa, lido antes de qualquer chamada remota. */
export type SubscriptionCancellationContext = {
  asaasSubscriptionId: string | null;
  /** Cobranças avulsas conhecidas: rateio de upgrade pendente e invoices em aberto. */
  extraPaymentIds: string[];
  effectiveAt: Date;
};

export type SubscriptionRevocationContext = {
  asaasSubscriptionId: string | null;
  value: number;
  nextDueDate: string;
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
  trialEndsAt: Date | null;
  asaasSubscriptionId: string | null;
};

type TargetPlan = { id: string; name: string; code: string; priceId: string; priceAmount: string };

function rank(code: string): number {
  const value = isOffer2026PlanCode(code)
    ? OFFER_2026_PLAN_CODES.indexOf(code) + 1
    : LEGACY_PLAN_RANK[code];
  if (!value) throw new PlanChangeError('Plano não suportado para alteração.', 'unsupported_plan');
  return value;
}

export function comparePlans(currentCode: string, targetCode: string): -1 | 0 | 1 {
  if (isOffer2026PlanCode(currentCode) !== isOffer2026PlanCode(targetCode)) {
    throw new PlanChangeError(
      'Troca entre tabelas de contrato indisponível.',
      'offer_generation_mismatch',
    );
  }
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

/** Snapshot verificado antes do I/O remoto; a transação de aplicação relê o estado. */
export async function getPaidUpgradeSyncContext(
  tx: Tx,
  payment: ProviderPayment,
): Promise<{
  subscriptionId: string;
  previousAmount: string;
  amount: string;
  firstDueDate: string;
  expectedCycle: 'MONTHLY' | 'YEARLY';
} | null> {
  if (!paidStatus(payment.status)) return null;
  const changeId = await upgradeChangeIdForPayment(tx, payment);
  if (!changeId) return null;
  const [change] = await tx
    .select({
      status: subscriptionChangeRequests.status,
      kind: subscriptionChangeRequests.kind,
      fromPriceId: subscriptionChangeRequests.fromPriceId,
      providerPaymentId: subscriptionChangeRequests.providerPaymentId,
      providerCheckoutId: subscriptionChangeRequests.providerCheckoutId,
      prorationAmount: subscriptionChangeRequests.prorationAmount,
      currentPriceId: subscriptions.priceId,
      previousAmount: sql<string>`(SELECT amount FROM public.prices WHERE id = ${subscriptions.priceId})`,
      billingStatus: subscriptions.billingStatus,
      asaasSubscriptionId: subscriptions.asaasSubscriptionId,
      currentPeriodEnd: subscriptions.currentPeriodEnd,
      targetAmount: prices.amount,
      targetBillingCycle: prices.billingCycle,
    })
    .from(subscriptionChangeRequests)
    .innerJoin(subscriptions, eq(subscriptions.id, subscriptionChangeRequests.subscriptionId))
    .innerJoin(prices, eq(prices.id, subscriptionChangeRequests.toPriceId))
    .where(eq(subscriptionChangeRequests.id, changeId))
    .limit(1);
  if (!change || change.status !== 'pending_payment') return null;
  if (
    change.kind !== 'upgrade' ||
    change.currentPriceId !== change.fromPriceId ||
    change.billingStatus !== 'active' ||
    (change.providerPaymentId && change.providerPaymentId !== payment.paymentId) ||
    (change.providerCheckoutId && change.providerCheckoutId !== payment.checkoutSessionId) ||
    toCents(change.prorationAmount ?? '0') !== toCents(payment.value) ||
    !change.asaasSubscriptionId ||
    !change.previousAmount ||
    !change.currentPeriodEnd
  ) {
    throw new PlanChangeError(
      'Upgrade pago não corresponde à assinatura ativa.',
      'upgrade_sync_preflight_failed',
    );
  }
  return {
    subscriptionId: change.asaasSubscriptionId,
    previousAmount: change.previousAmount,
    amount: change.targetAmount,
    firstDueDate: change.currentPeriodEnd.toISOString().slice(0, 10),
    expectedCycle: change.targetBillingCycle === 'annual' ? 'YEARLY' : 'MONTHLY',
  };
}

/** Checkout não propaga necessariamente externalReference para a cobrança. */
async function upgradeChangeIdForPayment(
  tx: Tx,
  payment: Pick<ProviderPayment, 'externalReference' | 'checkoutSessionId'>,
): Promise<string | null> {
  const referenceId = changeIdFromExternalReference(payment.externalReference);
  if (!payment.checkoutSessionId) return referenceId;
  const [linked] = await tx
    .select({ id: subscriptionChangeRequests.id })
    .from(subscriptionChangeRequests)
    .where(eq(subscriptionChangeRequests.providerCheckoutId, payment.checkoutSessionId))
    .limit(1);
  if (linked && referenceId && linked.id !== referenceId) {
    throw new PlanChangeError(
      'Checkout e pagamento apontam para upgrades diferentes.',
      'upgrade_checkout_mismatch',
    );
  }
  return linked?.id ?? null;
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
      trialEndsAt: subscriptions.trialEndsAt,
      asaasSubscriptionId: subscriptions.asaasSubscriptionId,
      billingProvider: subscriptions.billingProvider,
    })
    .from(subscriptions)
    .innerJoin(plans, eq(plans.id, subscriptions.planId))
    .innerJoin(prices, eq(prices.id, subscriptions.priceId))
    .where(eq(subscriptions.clinicId, clinicId))
    .limit(1);
  if (!row) throw new PlanChangeError('Assinatura não encontrada.', 'subscription_not_found');
  if (row.billingProvider === 'abacatepay') {
    throw new PlanChangeError(
      'Esta assinatura usa a nova integração. Alterações de plano ainda estão em validação.',
      'provider_operation_unavailable',
    );
  }
  return row as CurrentSubscription;
}

/**
 * Escolhe, entre os preços vigentes de um plano, o que respeita a campanha da
 * assinatura. Puro porque é a regra que decide QUANTO a clínica passa a pagar —
 * ela precisa ser afirmável sem banco.
 *
 * Sem preço da mesma campanha no destino, a troca é recusada. Um desconto
 * vitalício não pode desaparecer silenciosamente em uma mudança de plano.
 */
export function pickPriceForCampaign<T extends { campaignCode: string | null }>(
  candidates: readonly T[],
  campaignCode: string | null,
): T | undefined {
  return candidates.find((c) => c.campaignCode === campaignCode);
}

/**
 * Resolve o preço do plano de destino PRESERVANDO a campanha da assinatura
 * atual. Uma clínica que entrou pelo link paga preço de fundador; se trocar de
 * plano e caísse no preço de tabela, ela perderia o desconto vitalício sem
 * jamais ter pedido isso — e por um caminho que nem menciona preço promocional.
 *
 * Sem preço da mesma campanha no destino, não existe troca automática segura.
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
        campaignCode ? eq(prices.campaignCode, campaignCode) : isNull(prices.campaignCode),
      ),
    )
    .where(and(eq(plans.id, targetPlanId), eq(plans.ativo, true)));
  const row = pickPriceForCampaign(candidates, campaignCode);
  if (!row)
    throw new PlanChangeError('Plano indisponível para o ciclo atual.', 'target_plan_unavailable');
  return row;
}

export function fitsPlanUserLimit(activeUsers: number, limit: number | null): boolean {
  return Number.isInteger(activeUsers) && activeUsers > 0 && limit !== null && activeUsers <= limit;
}

export async function assertTargetPlanCapacity(
  tx: Tx,
  clinicId: string,
  targetPlanId: string,
): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${clinicId}))`);
  const [limit] = await tx
    .select({ value: planLimits.limitValue })
    .from(planLimits)
    .where(and(eq(planLimits.planId, targetPlanId), eq(planLimits.metric, 'users')))
    .limit(1);
  const [row] = await tx.execute<{ active_users: number }>(sql`
    SELECT count(*)::int AS active_users
      FROM public.profiles
     WHERE clinic_id = ${clinicId}::uuid
       AND ativo = true
       AND deleted_at IS NULL
  `);
  if (!fitsPlanUserLimit(Number(row?.active_users ?? 0), limit?.value ?? null)) {
    throw new PlanChangeError(
      'A clínica possui mais usuários ativos do que o plano de destino permite.',
      'downgrade_capacity_exceeded',
    );
  }

  const [seats] = await tx
    .select({ doctors: planSeatLimits.doctors, staff: planSeatLimits.staff })
    .from(planSeatLimits)
    .where(eq(planSeatLimits.planId, targetPlanId))
    .limit(1);
  if (!seats) return; // Planos legados só têm teto total de usuários.

  const [usage] = await tx.execute<{ doctors: number; staff: number }>(sql`
    SELECT count(*) FILTER (WHERE role = 'doctor'
      OR (role IN ('owner', 'gestor') AND nullif(btrim(crm), '') IS NOT NULL))::int AS doctors,
      count(*) FILTER (WHERE role <> 'doctor'
        AND NOT (role IN ('owner', 'gestor') AND nullif(btrim(crm), '') IS NOT NULL))::int AS staff
    FROM public.profiles
    WHERE clinic_id = ${clinicId}::uuid AND ativo IS TRUE
      AND deleted_at IS NULL AND role <> 'super_admin'
  `);
  if (Number(usage?.doctors ?? 0) > seats.doctors || Number(usage?.staff ?? 0) > seats.staff) {
    throw new PlanChangeError(
      'A clínica excede as vagas de médicos ou equipe do plano de destino.',
      'downgrade_capacity_exceeded',
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

/**
 * O vencimento mais cedo que o Asaas aceita ao RELIGAR uma recorrência.
 *
 * Medido no sandbox em 28/09/2026: `PUT /subscriptions/{id}` com `status:
 * 'ACTIVE'` e vencimento hoje (ou antes) responde `400 invalid_nextDueDate` —
 * "Para reativar a assinatura, é necessário que a data do próximo vencimento
 * seja maior que hoje". A reativação usava "hoje" e por isso NUNCA funcionou
 * contra o Asaas de verdade; só o E2E de ponta a ponta mostrou.
 *
 * Amanhã em UTC é sempre maior que "hoje" tanto em UTC quanto no Brasil (o dia
 * UTC nunca está atrás do dia de Brasília), então serve qualquer que seja o
 * relógio que o Asaas usa.
 */
export function earliestReactivationDueDate(now: Date): string {
  return dateOnly(new Date(now.getTime() + 86_400_000));
}

/** O maior entre uma data desejada e o mínimo que o Asaas aceita ao religar. */
function reactivationDueDate(desired: Date, now: Date): string {
  const minimum = earliestReactivationDueDate(now);
  const wanted = dateOnly(desired);
  return wanted > minimum ? wanted : minimum;
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
  if (!current.asaasSubscriptionId) {
    throw new PlanChangeError(
      'Assinatura ainda não foi provisionada no Asaas.',
      'subscription_not_provisioned',
    );
  }
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
    // Um cancelamento agendado já pausou a recorrência e apagou as cobranças no
    // Asaas. Revogá-lo aqui, só no banco, deixaria a clínica ativa no Qoro e
    // SEM cobrança nenhuma no provedor. Quem desfaz um cancelamento é o
    // "Manter assinatura", que reativa o lado Asaas antes.
    if (existing.kind === 'cancellation') {
      throw new PlanChangeError(
        'Há um cancelamento agendado. Use "Manter assinatura" antes de trocar de plano.',
        'cancellation_scheduled',
      );
    }
    if (direction === 1 && existing.status === 'scheduled') {
      if (existing.kind === 'downgrade') await cancelScheduledDowngrade(tx, current.id);
    } else {
      throw new PlanChangeError(
        'Já existe uma alteração de plano em andamento.',
        'change_already_pending',
      );
    }
  }

  if (direction === -1) await assertTargetPlanCapacity(tx, input.clinicId, target.id);

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
  if (isUpgrade && prorationCents === 0) {
    throw new PlanChangeError(
      'O ciclo está terminando. Tente novamente após a renovação para calcular o novo valor.',
      'upgrade_proration_unavailable',
    );
  }
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

/**
 * A troca de ciclo conserva o plano, a campanha e o acesso atual. A intenção
 * local precede qualquer PUT remoto; `providerSyncedAt` só é preenchido depois
 * do readback completo da recorrência E da parcela já emitida.
 */
export async function requestBillingCycleChange(
  tx: Tx,
  input: Omit<PlanChangeRequestInput, 'targetPlanId'>,
): Promise<RequestedCycleChange> {
  const now = input.now ?? new Date();
  const current = await readCurrentSubscription(tx, input.clinicId);
  if (!isOffer2026PlanCode(current.planCode)) {
    throw new PlanChangeError(
      'Troca de ciclo indisponível para contratos antigos.',
      'legacy_cycle_change',
    );
  }
  if (current.billingCycle === 'monthly' && !env.OFFER_2026_ANNUAL_NEW_SALES_ENABLED) {
    throw new PlanChangeError(
      'Novas contratações anuais ainda não estão disponíveis.',
      'annual_new_sales_disabled',
    );
  }
  if (current.billingStatus !== 'active' || !current.asaasSubscriptionId) {
    throw new PlanChangeError('Assinatura ativa no Asaas necessária.', 'cycle_change_not_active');
  }
  if (!current.currentPeriodEnd || current.currentPeriodEnd <= now) {
    throw new PlanChangeError(
      'O ciclo atual já terminou; aguarde a renovação.',
      'cycle_change_period_ended',
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
      'Já existe alteração de assinatura em andamento.',
      'change_already_pending',
    );
  }

  const targetCycle = current.billingCycle === 'monthly' ? 'annual' : 'monthly';
  const target = await readTargetPlan(tx, current.planId, targetCycle, current.campaignCode);
  const [created] = await tx
    .insert(subscriptionChangeRequests)
    .values({
      clinicId: input.clinicId,
      subscriptionId: current.id,
      kind: 'cycle_change',
      status: 'scheduled',
      fromPlanId: current.planId,
      fromPriceId: current.priceId,
      toPlanId: current.planId,
      toPriceId: target.priceId,
      effectiveAt: current.currentPeriodEnd,
      idempotencyKey: input.idempotencyKey,
      requestedBy: input.requestedBy,
      requestedIp: input.request.ip,
      requestedOrigin: input.request.origin,
      requestId: input.request.requestId,
    })
    .returning({ id: subscriptionChangeRequests.id });
  if (!created) throw new PlanChangeError('Troca não registrada.', 'cycle_change_not_created');
  await tx.insert(billingEvents).values({
    clinicId: input.clinicId,
    type: 'subscription.cycle_change.requested',
    payload: {
      changeId: created.id,
      fromCycle: current.billingCycle,
      targetCycle,
      effectiveAt: current.currentPeriodEnd.toISOString(),
      targetAmount: target.priceAmount,
    } as never,
  });
  return {
    id: created.id,
    targetCycle,
    targetAmount: target.priceAmount,
    effectiveAt: current.currentPeriodEnd,
  };
}

export async function getCurrentCycleProviderContext(clinicId: string): Promise<{
  subscriptionId: string;
  amount: string;
  cycle: 'MONTHLY' | 'YEARLY';
}> {
  return withTenant(clinicId, async (tx) => {
    const current = await readCurrentSubscription(tx, clinicId);
    if (!isOffer2026PlanCode(current.planCode) || !current.asaasSubscriptionId) {
      throw new PlanChangeError('Troca de ciclo indisponível.', 'cycle_change_unavailable');
    }
    return {
      subscriptionId: current.asaasSubscriptionId,
      amount: current.priceAmount,
      cycle: current.billingCycle === 'annual' ? 'YEARLY' : 'MONTHLY',
    };
  });
}

export async function getCycleChangeSyncContext(
  clinicId: string,
  changeId: string,
): Promise<{
  subscriptionId: string;
  previousAmount: string;
  amount: string;
  firstDueDate: string;
  fromCycle: 'MONTHLY' | 'YEARLY';
  toCycle: 'MONTHLY' | 'YEARLY';
}> {
  return withTenant(clinicId, async (tx) => {
    const [change] = await tx
      .select({
        kind: subscriptionChangeRequests.kind,
        status: subscriptionChangeRequests.status,
        fromPriceId: subscriptionChangeRequests.fromPriceId,
        toPriceId: subscriptionChangeRequests.toPriceId,
        currentPriceId: subscriptions.priceId,
        billingStatus: subscriptions.billingStatus,
        asaasSubscriptionId: subscriptions.asaasSubscriptionId,
        effectiveAt: subscriptionChangeRequests.effectiveAt,
        currentPeriodEnd: subscriptions.currentPeriodEnd,
        oldAmount: sql<string>`(SELECT amount FROM public.prices WHERE id = ${subscriptionChangeRequests.fromPriceId})`,
        newAmount: sql<string>`(SELECT amount FROM public.prices WHERE id = ${subscriptionChangeRequests.toPriceId})`,
        oldCycle: sql<
          'monthly' | 'annual'
        >`(SELECT billing_cycle FROM public.prices WHERE id = ${subscriptionChangeRequests.fromPriceId})`,
        newCycle: sql<
          'monthly' | 'annual'
        >`(SELECT billing_cycle FROM public.prices WHERE id = ${subscriptionChangeRequests.toPriceId})`,
      })
      .from(subscriptionChangeRequests)
      .innerJoin(subscriptions, eq(subscriptions.id, subscriptionChangeRequests.subscriptionId))
      .where(
        and(
          eq(subscriptionChangeRequests.id, changeId),
          eq(subscriptionChangeRequests.clinicId, clinicId),
        ),
      )
      .limit(1);
    if (
      !change ||
      change.kind !== 'cycle_change' ||
      change.status !== 'scheduled' ||
      change.fromPriceId !== change.currentPriceId ||
      !['active', 'past_due'].includes(change.billingStatus) ||
      !change.asaasSubscriptionId ||
      !change.currentPeriodEnd ||
      change.effectiveAt.getTime() !== change.currentPeriodEnd.getTime() ||
      !change.toPriceId ||
      !change.oldAmount ||
      !change.newAmount ||
      change.oldCycle === change.newCycle
    ) {
      throw new PlanChangeError(
        'Troca de ciclo não corresponde ao contrato.',
        'cycle_change_context_invalid',
      );
    }
    return {
      subscriptionId: change.asaasSubscriptionId,
      previousAmount: change.oldAmount,
      amount: change.newAmount,
      firstDueDate: change.effectiveAt.toISOString().slice(0, 10),
      fromCycle: change.oldCycle === 'annual' ? 'YEARLY' : 'MONTHLY',
      toCycle: change.newCycle === 'annual' ? 'YEARLY' : 'MONTHLY',
    };
  });
}

export async function confirmCycleChangeProviderSync(
  tx: Tx,
  clinicId: string,
  changeId: string,
): Promise<void> {
  const confirmed = await tx
    .update(subscriptionChangeRequests)
    .set({ providerSyncedAt: sql`now()` })
    .where(
      and(
        eq(subscriptionChangeRequests.id, changeId),
        eq(subscriptionChangeRequests.clinicId, clinicId),
        eq(subscriptionChangeRequests.kind, 'cycle_change'),
        eq(subscriptionChangeRequests.status, 'scheduled'),
      ),
    )
    .returning({ id: subscriptionChangeRequests.id });
  if (!confirmed.length) {
    throw new PlanChangeError('Troca mudou durante a confirmação.', 'cycle_change_conflict');
  }
}

const CANCELLABLE: ReadonlySet<CurrentSubscription['billingStatus']> = new Set([
  'trial',
  'active',
  'past_due',
]);

/**
 * Quando o cancelamento passa a valer.
 *
 *   - `active`: no fim do ciclo JÁ PAGO. Apagar a cobrança do próximo ciclo não
 *     tira da clínica o que ela pagou.
 *   - `trial`: no fim do teste. O teste foi prometido; só a cobrança que viria
 *     depois dele é apagada.
 *   - `past_due`: agora. Não há período pago a honrar, e a dívida em aberto é
 *     apagada junto — é o que "apagar todas as cobranças" significa.
 *
 * Datas no passado viram `now`: um ciclo já vencido não é prazo a esperar.
 */
export function cancellationEffectiveAt(
  current: Pick<CurrentSubscription, 'billingStatus' | 'currentPeriodEnd' | 'trialEndsAt'>,
  now: Date,
): Date {
  const candidate =
    current.billingStatus === 'active'
      ? current.currentPeriodEnd
      : current.billingStatus === 'trial'
        ? current.trialEndsAt
        : null;
  return candidate && candidate.getTime() > now.getTime() ? candidate : now;
}

function assertCancellable(current: CurrentSubscription): void {
  if (current.billingStatus === 'cancelled') {
    throw new PlanChangeError('A assinatura já está cancelada.', 'subscription_already_cancelled');
  }
  if (!CANCELLABLE.has(current.billingStatus)) {
    throw new PlanChangeError(
      'Não foi possível cancelar esta assinatura.',
      'subscription_not_cancellable',
    );
  }
}

async function findScheduledCancellation(
  tx: Tx,
  subscriptionId: string,
): Promise<{ id: string; effectiveAt: Date } | null> {
  const [row] = await tx
    .select({
      id: subscriptionChangeRequests.id,
      effectiveAt: subscriptionChangeRequests.effectiveAt,
    })
    .from(subscriptionChangeRequests)
    .where(
      and(
        eq(subscriptionChangeRequests.subscriptionId, subscriptionId),
        eq(subscriptionChangeRequests.kind, 'cancellation'),
        eq(subscriptionChangeRequests.status, 'scheduled'),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Lê, sem gravar nada, o que o lado Asaas do cancelamento precisa.
 *
 * Roda ANTES da chamada remota. As cobranças avulsas entram aqui porque são
 * justamente as que a listagem da recorrência não enxerga: o rateio de um
 * upgrade aguardando pagamento e qualquer invoice local ainda em aberto.
 */
export async function getSubscriptionCancellationContext(
  clinicId: string,
  now: Date = new Date(),
): Promise<SubscriptionCancellationContext> {
  return withTenant(clinicId, async (tx) => {
    const current = await readCurrentSubscription(tx, clinicId);
    assertCancellable(current);
    if (await findScheduledCancellation(tx, current.id)) {
      throw new PlanChangeError(
        'O cancelamento desta assinatura já está agendado.',
        'cancellation_already_scheduled',
      );
    }

    const pendingUpgrades = await tx
      .select({ paymentId: subscriptionChangeRequests.providerPaymentId })
      .from(subscriptionChangeRequests)
      .where(
        and(
          eq(subscriptionChangeRequests.subscriptionId, current.id),
          eq(subscriptionChangeRequests.status, 'pending_payment'),
        ),
      );
    const openInvoices = await tx
      .select({ paymentId: invoices.asaasPaymentId })
      .from(invoices)
      .where(
        and(
          eq(invoices.clinicId, clinicId),
          inArray(invoices.status, ['open', 'overdue', 'partial']),
        ),
      );
    const extraPaymentIds = [
      ...new Set(
        [...pendingUpgrades, ...openInvoices]
          .map((row) => row.paymentId)
          .filter((id): id is string => typeof id === 'string' && id.length > 0),
      ),
    ];

    return {
      asaasSubscriptionId: current.asaasSubscriptionId,
      extraPaymentIds,
      effectiveAt: cancellationEffectiveAt(current, now),
    };
  });
}

/**
 * Registra o cancelamento cujo lado Asaas JÁ foi confirmado.
 *
 * O que muda em relação ao desenho anterior:
 *   - aceita trial e inadimplência, não só `active` (antes a pessoa em teste
 *     não tinha como cancelar, e a primeira cobrança vinha no fim do teste);
 *   - supera qualquer upgrade/downgrade pendente, em vez de recusar — cancelar
 *     tem de ser sempre possível, e a cobrança do upgrade já foi apagada;
 *   - marca como canceladas as invoices locais das cobranças apagadas, para que
 *     tela, régua de cobrança e relatórios não sigam uma cobrança que não existe.
 */
export async function requestSubscriptionCancellation(
  tx: Tx,
  input: ConfirmedCancellationInput,
): Promise<RequestedCancellation> {
  const now = input.now ?? new Date();
  const current = await readCurrentSubscription(tx, input.clinicId);
  assertCancellable(current);
  if (await findScheduledCancellation(tx, current.id)) {
    throw new PlanChangeError(
      'O cancelamento desta assinatura já está agendado.',
      'cancellation_already_scheduled',
    );
  }

  const superseded = await tx
    .update(subscriptionChangeRequests)
    .set({ status: 'cancelled', cancelledAt: sql`now()` })
    .where(
      and(
        eq(subscriptionChangeRequests.subscriptionId, current.id),
        inArray(subscriptionChangeRequests.status, ['pending_payment', 'scheduled']),
      ),
    )
    .returning({ id: subscriptionChangeRequests.id, kind: subscriptionChangeRequests.kind });

  const effectiveAt = cancellationEffectiveAt(current, now);
  const [created] = await tx
    .insert(subscriptionChangeRequests)
    .values({
      clinicId: input.clinicId,
      subscriptionId: current.id,
      kind: 'cancellation',
      status: 'scheduled',
      fromPlanId: current.planId,
      fromPriceId: current.priceId,
      effectiveAt,
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

  // As invoices locais das cobranças apagadas. O webhook PAYMENT_DELETED faria o
  // mesmo depois, mas a tela desta clínica não pode ficar dependendo dele para
  // parar de mostrar uma cobrança que já não existe.
  if (input.removedPaymentIds.length > 0) {
    const locais = await tx
      .select()
      .from(invoices)
      .where(
        and(
          eq(invoices.clinicId, input.clinicId),
          inArray(invoices.asaasPaymentId, [...input.removedPaymentIds]),
        ),
      );
    for (const invoice of locais) {
      await syncInvoiceFromProviderPayment(
        tx,
        input.clinicId,
        invoice,
        { exists: false },
        {
          idemSuffix: `cancellation:${created.id}:${invoice.asaasPaymentId}`,
          providerConfirmedMissing: true,
        },
      );
    }
  }

  await tx.insert(billingEvents).values({
    clinicId: input.clinicId,
    type: 'subscription.cancellation.requested',
    payload: {
      changeId: created.id,
      effectiveAt: effectiveAt.toISOString(),
      fromStatus: current.billingStatus,
      removedCharges: input.removedPaymentIds.length,
      supersededChanges: superseded.map((row) => ({ id: row.id, kind: row.kind })),
    } as never,
  });
  // Cobrança que já estava paga quando o cancelamento chegou (em geral um
  // cartão processado no mesmo instante). O cancelamento segue; o dinheiro
  // entrou e precisa de decisão humana — por isso vira evento próprio.
  if (input.paidPaymentIds.length > 0) {
    await tx.insert(billingEvents).values({
      clinicId: input.clinicId,
      type: 'subscription.cancellation.paid_charge_detected',
      payload: { changeId: created.id, paymentIds: [...input.paidPaymentIds] } as never,
    });
  }
  return {
    id: created.id,
    kind: 'cancellation',
    status: 'scheduled',
    effectiveAt,
    removedCharges: input.removedPaymentIds.length,
  };
}

/**
 * O que "Manter assinatura" precisa para religar a recorrência no Asaas.
 *
 * O cancelamento pausou a recorrência e apagou as cobranças NA HORA. Revogar só
 * no banco deixaria a clínica ativa e o Asaas parado — serviço sem cobrança.
 * `nextDueDate` é a data em que o cancelamento valeria: a cobrança volta a
 * existir exatamente onde a pessoa estaria pagando de novo.
 */
export async function getSubscriptionRevocationContext(
  clinicId: string,
  now: Date = new Date(),
): Promise<SubscriptionRevocationContext> {
  return withTenant(clinicId, async (tx) => {
    const current = await readCurrentSubscription(tx, clinicId);
    const scheduled = await findScheduledCancellation(tx, current.id);
    if (!scheduled) {
      throw new PlanChangeError(
        'Nenhum cancelamento agendado foi encontrado.',
        'cancellation_not_scheduled',
      );
    }
    const value = Number(current.priceAmount);
    if (!Number.isFinite(value) || value <= 0) {
      throw new PlanChangeError('Valor da assinatura inválido para reativação.', 'invalid_price');
    }
    return {
      asaasSubscriptionId: current.asaasSubscriptionId,
      value,
      nextDueDate: reactivationDueDate(scheduled.effectiveAt, now),
    };
  });
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
      // A cobrança da reativação vence amanhã, não hoje: o Asaas recusa hoje.
      nextDueDate: earliestReactivationDueDate(now),
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
      planCode: toPlanCode(current.planCode),
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
  targetPlanCode: string;
  dueDate: string;
  providerPaymentId: string | null;
  providerPaymentUrl: string | null;
  providerCheckoutId: string | null;
  providerCheckoutExpiresAt: Date | null;
  checkoutCreationState: string | null;
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
      providerCheckoutId: subscriptionChangeRequests.providerCheckoutId,
      providerCheckoutExpiresAt: subscriptionChangeRequests.providerCheckoutExpiresAt,
      checkoutCreationState: subscriptionChangeRequests.checkoutCreationState,
      targetPlanName: plans.name,
      targetPlanCode: plans.code,
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
    targetPlanCode: change.targetPlanCode,
    dueDate: new Date().toISOString().slice(0, 10),
    providerPaymentId: change.providerPaymentId,
    providerPaymentUrl: change.providerPaymentUrl,
    providerCheckoutId: change.providerCheckoutId,
    providerCheckoutExpiresAt: change.providerCheckoutExpiresAt,
    checkoutCreationState: change.checkoutCreationState,
  };
}

/** Lease durável: somente uma chamada externa pode nascer para este upgrade. */
export async function claimUpgradeCheckout(
  tx: Tx,
  clinicId: string,
  changeId: string,
  leaseUntil: Date,
): Promise<boolean> {
  const [claimed] = await tx
    .update(subscriptionChangeRequests)
    .set({ checkoutCreationState: 'creating', checkoutLeaseUntil: leaseUntil })
    .where(
      and(
        eq(subscriptionChangeRequests.id, changeId),
        eq(subscriptionChangeRequests.clinicId, clinicId),
        eq(subscriptionChangeRequests.kind, 'upgrade'),
        eq(subscriptionChangeRequests.status, 'pending_payment'),
        isNull(subscriptionChangeRequests.checkoutCreationState),
        isNull(subscriptionChangeRequests.providerCheckoutId),
      ),
    )
    .returning({ id: subscriptionChangeRequests.id });
  return claimed !== undefined;
}

/** Um POST que passou do lease pode ter sido aceito pelo Asaas; nunca o repita. */
export async function expireStaleUpgradeCheckoutLeases(tx: Tx, now: Date): Promise<number> {
  const stale = await tx
    .update(subscriptionChangeRequests)
    .set({ checkoutCreationState: 'creation_unknown', checkoutLeaseUntil: null })
    .where(
      and(
        eq(subscriptionChangeRequests.kind, 'upgrade'),
        eq(subscriptionChangeRequests.status, 'pending_payment'),
        eq(subscriptionChangeRequests.checkoutCreationState, 'creating'),
        lt(subscriptionChangeRequests.checkoutLeaseUntil, now),
        isNull(subscriptionChangeRequests.providerCheckoutId),
      ),
    )
    .returning({ id: subscriptionChangeRequests.id });
  return stale.length;
}

export async function finishUpgradeCheckoutCreation(
  tx: Tx,
  clinicId: string,
  changeId: string,
  outcome:
    | { state: 'ready'; checkoutId: string; checkoutUrl: string; expiresAt: Date }
    | { state: 'creation_unknown' | 'failed' },
): Promise<void> {
  const values =
    outcome.state === 'ready'
      ? {
          checkoutCreationState: 'ready',
          checkoutLeaseUntil: null,
          providerCheckoutId: outcome.checkoutId,
          providerCheckoutExpiresAt: outcome.expiresAt,
          providerPaymentUrl: outcome.checkoutUrl,
        }
      : {
          checkoutCreationState: outcome.state === 'failed' ? null : 'creation_unknown',
          checkoutLeaseUntil: null,
        };
  const [updated] = await tx
    .update(subscriptionChangeRequests)
    .set(values)
    .where(
      and(
        eq(subscriptionChangeRequests.id, changeId),
        eq(subscriptionChangeRequests.clinicId, clinicId),
        eq(subscriptionChangeRequests.kind, 'upgrade'),
        eq(subscriptionChangeRequests.status, 'pending_payment'),
        eq(subscriptionChangeRequests.checkoutCreationState, 'creating'),
      ),
    )
    .returning({ id: subscriptionChangeRequests.id });
  if (!updated)
    throw new PlanChangeError(
      'Estado do Checkout mudou durante a criação.',
      'upgrade_checkout_conflict',
    );
}

type ProviderPaymentForChange = {
  paymentId: string;
  invoiceUrl: string | null;
  value: number;
  dueDate: string;
  billingType: string | null;
  checkoutSessionId?: string | null;
  externalReference?: string | null;
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
  const changeId = await upgradeChangeIdForPayment(tx, {
    externalReference: payment.externalReference,
    checkoutSessionId: payment.checkoutSessionId ?? null,
  });
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
  if (change.providerPaymentId && change.providerPaymentId !== payment.paymentId) {
    throw new PlanChangeError(
      'Pagamento não pertence ao upgrade solicitado.',
      'upgrade_payment_mismatch',
    );
  }
  if (change.providerCheckoutId && change.providerCheckoutId !== payment.checkoutSessionId) {
    throw new PlanChangeError(
      'Pagamento não pertence ao Checkout do upgrade.',
      'upgrade_checkout_mismatch',
    );
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
      priceId: subscriptions.priceId,
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

  if (
    current.planId !== change.fromPlanId ||
    current.priceId !== change.fromPriceId ||
    current.billingStatus !== 'active'
  ) {
    throw new PlanChangeError(
      'Assinatura mudou durante o upgrade.',
      'upgrade_subscription_changed',
    );
  }

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
      oldPlanCode: toPlanCode(current.planCode),
      newPlanCode: toPlanCode(target.code),
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
): Promise<{ applied: boolean; kind: 'downgrade' | 'cancellation' | 'cycle_change' | null }> {
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
      priceId: subscriptions.priceId,
      currentPeriodEnd: subscriptions.currentPeriodEnd,
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
  } else if (change.kind === 'cycle_change') {
    if (
      !change.providerSyncedAt ||
      !change.toPriceId ||
      change.toPlanId !== current.planId ||
      change.fromPriceId !== current.priceId ||
      !['active', 'past_due'].includes(current.billingStatus) ||
      current.currentPeriodEnd?.getTime() !== change.effectiveAt.getTime()
    ) {
      throw new PlanChangeError(
        'Troca de ciclo sem confirmação do Asaas.',
        'cycle_change_not_ready',
      );
    }
    await tx
      .update(subscriptions)
      .set({ priceId: change.toPriceId })
      .where(eq(subscriptions.id, current.id));
    await tx.insert(subscriptionHistory).values({
      clinicId: change.clinicId,
      subscriptionId: current.id,
      oldPlanId: current.planId,
      newPlanId: current.planId,
      oldStatus: current.billingStatus,
      newStatus: current.billingStatus,
      changedBy: change.requestedBy,
      reason: 'cycle_change_period_end',
    });
    await publishEvent(tx, {
      clinicId: change.clinicId,
      eventType: BILLING_EVENTS.SUBSCRIPTION_CHANGED,
      payload: {
        clinicId: change.clinicId,
        subscriptionId: current.id,
        oldPlanCode: toPlanCode(current.planCode),
        newPlanCode: toPlanCode(current.planCode),
        oldStatus: current.billingStatus,
        newStatus: current.billingStatus,
      },
      idempotencyKey: `subscription-change:cycle:${change.id}`,
    });
  } else {
    if (!change.toPlanId || !change.toPriceId) {
      throw new PlanChangeError('Downgrade sem plano de destino.', 'downgrade_target_missing');
    }
    await assertTargetPlanCapacity(tx, change.clinicId, change.toPlanId);
    if (current.planId !== change.fromPlanId || current.billingStatus !== 'active') {
      throw new PlanChangeError(
        'Assinatura mudou durante o downgrade.',
        'downgrade_subscription_changed',
      );
    }
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
        oldPlanCode: toPlanCode(current.planCode),
        newPlanCode: toPlanCode(target.code),
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

/**
 * Um cartão pode ser pago antes do vencimento. A invoice fica paga de imediato,
 * mas seu período anual só começa na data contratada. Na data, webhook ou cron
 * aplica a troca antes de derivar o período da cobrança.
 */
export async function prepareScheduledCycleForPaidInvoice(
  tx: Tx,
  clinicId: string,
  invoice: { subscriptionId: string; dueDate: string; totalAmount: string },
  paymentMethod: string | null,
  now: Date = new Date(),
): Promise<{ deferPeriodAdvance: boolean }> {
  const [change] = await tx
    .select({
      id: subscriptionChangeRequests.id,
      effectiveAt: subscriptionChangeRequests.effectiveAt,
      providerSyncedAt: subscriptionChangeRequests.providerSyncedAt,
      amount: prices.amount,
    })
    .from(subscriptionChangeRequests)
    .innerJoin(prices, eq(prices.id, subscriptionChangeRequests.toPriceId))
    .where(
      and(
        eq(subscriptionChangeRequests.clinicId, clinicId),
        eq(subscriptionChangeRequests.subscriptionId, invoice.subscriptionId),
        eq(subscriptionChangeRequests.kind, 'cycle_change'),
        eq(subscriptionChangeRequests.status, 'scheduled'),
      ),
    )
    .limit(1);
  if (!change) return { deferPeriodAdvance: false };
  const effectiveDate = change.effectiveAt.toISOString().slice(0, 10);
  if (invoice.dueDate < effectiveDate) return { deferPeriodAdvance: false };
  if (
    invoice.dueDate !== effectiveDate ||
    !change.providerSyncedAt ||
    paymentMethod !== 'CREDIT_CARD' ||
    toCents(invoice.totalAmount) !== toCents(change.amount)
  ) {
    throw new PlanChangeError(
      'Pagamento não corresponde à troca de ciclo.',
      'cycle_change_payment_conflict',
    );
  }
  if (now < change.effectiveAt) return { deferPeriodAdvance: true };
  await applyScheduledPlanChange(tx, change.id, now);
  return { deferPeriodAdvance: false };
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
    trialEndsAt: string | null;
  };
  plans: Array<{
    id: string;
    name: string;
    code: string;
    priceAmount: string;
    limits: { users: number; agendamentos: number; ai_messages: number };
    seats: { doctors: number; staff: number } | null;
  }>;
  activeUsers: number;
  activeDoctors: number;
  activeStaff: number;
  aiUsage: { count: number; limit: number; period: string } | null;
  cycleOffer: { billingCycle: 'monthly' | 'annual'; priceAmount: string } | null;
  pending: {
    kind: string;
    status: string;
    effectiveAt: string;
    paymentUrl: string | null;
    providerSynced: boolean;
    checkoutCreationState: string | null;
    checkoutExpired: boolean;
  } | null;
};

export async function getPlanChangeOverview(clinicId: string): Promise<PlanChangeOverview> {
  return withTenant(clinicId, async (tx) => {
    const current = await readCurrentSubscription(tx, clinicId);
    // Só mostra destinos com preço da MESMA campanha. Exibir o preço de tabela
    // aqui e recusar a troca no servidor seria uma promessa enganosa na UI.
    const campaignFilter = current.campaignCode
      ? eq(prices.campaignCode, current.campaignCode)
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
    const availablePlans = planRows.filter(
      (row) => isOffer2026PlanCode(row.code) === isOffer2026PlanCode(current.planCode),
    );
    const nextCycle = current.billingCycle === 'monthly' ? 'annual' : 'monthly';
    const [cyclePrice] =
      isOffer2026PlanCode(current.planCode) &&
      (nextCycle === 'monthly' || env.OFFER_2026_ANNUAL_NEW_SALES_ENABLED)
        ? await tx
            .select({ amount: prices.amount })
            .from(prices)
            .where(
              and(
                eq(prices.planId, current.planId),
                eq(prices.billingCycle, nextCycle),
                isNull(prices.activeUntil),
                campaignFilter,
              ),
            )
            .limit(1)
        : [];
    const planIds = availablePlans.map((row) => row.id);
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
    // O catálogo de assentos é exclusivo da oferta 2026. Contratos legados
    // não podem depender da migration/grant novo durante o rollout em Preview.
    const seats =
      isOffer2026PlanCode(current.planCode) && planIds.length
        ? await tx
            .select({
              planId: planSeatLimits.planId,
              doctors: planSeatLimits.doctors,
              staff: planSeatLimits.staff,
            })
            .from(planSeatLimits)
            .where(inArray(planSeatLimits.planId, planIds))
        : [];
    const seatsByPlan = new Map(
      seats.map((row) => [row.planId, { doctors: row.doctors, staff: row.staff }]),
    );
    const currentSeats = seatsByPlan.get(current.planId);
    if (isOffer2026PlanCode(current.planCode) && !currentSeats) {
      throw new PlanChangeError('Cota de médicos do plano indisponível.', 'seat_catalog_missing');
    }
    const aiPeriod = currentPeriod();
    const aiUsage = currentSeats
      ? {
          count: (await readUsage(tx, clinicId, aiPeriod)).ai_messages,
          limit: currentSeats.doctors * PROPOSED_OFFER.conversationsPerProfessional,
          period: aiPeriod,
        }
      : null;
    const limitsByPlan = new Map<
      string,
      { users: number; agendamentos: number; ai_messages: number }
    >();
    for (const id of planIds) limitsByPlan.set(id, { users: 0, agendamentos: 0, ai_messages: 0 });
    for (const limit of limits) {
      const target = limitsByPlan.get(limit.planId);
      if (target) target[limit.metric] = Number(limit.value);
    }
    const [active] = await tx.execute<{
      active_users: number;
      active_doctors: number;
      active_staff: number;
    }>(sql`
      SELECT count(*)::int AS active_users,
        count(*) FILTER (WHERE role <> 'super_admin' AND
          (role = 'doctor' OR
            (role IN ('owner', 'gestor') AND nullif(btrim(crm), '') IS NOT NULL)))::int
          AS active_doctors,
        count(*) FILTER (WHERE role <> 'super_admin' AND NOT
          (role = 'doctor' OR
            (role IN ('owner', 'gestor') AND nullif(btrim(crm), '') IS NOT NULL)))::int
          AS active_staff
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
        providerSyncedAt: subscriptionChangeRequests.providerSyncedAt,
        checkoutCreationState: subscriptionChangeRequests.checkoutCreationState,
        checkoutExpiresAt: subscriptionChangeRequests.providerCheckoutExpiresAt,
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
        trialEndsAt: current.trialEndsAt?.toISOString() ?? null,
      },
      plans: availablePlans.map((plan) => ({
        ...plan,
        limits: limitsByPlan.get(plan.id) ?? { users: 0, agendamentos: 0, ai_messages: 0 },
        seats: seatsByPlan.get(plan.id) ?? null,
      })),
      activeUsers: Number(active?.active_users ?? 0),
      activeDoctors: Number(active?.active_doctors ?? 0),
      activeStaff: Number(active?.active_staff ?? 0),
      aiUsage,
      cycleOffer: cyclePrice ? { billingCycle: nextCycle, priceAmount: cyclePrice.amount } : null,
      pending: pending
        ? {
            kind: pending.kind,
            status: pending.status,
            effectiveAt: pending.effectiveAt.toISOString(),
            paymentUrl: pending.paymentUrl,
            providerSynced: pending.providerSyncedAt !== null,
            checkoutCreationState: pending.checkoutCreationState,
            checkoutExpired:
              pending.checkoutExpiresAt !== null && pending.checkoutExpiresAt <= new Date(),
          }
        : null,
    };
  });
}
