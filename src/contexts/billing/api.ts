/**
 * Billing internal API (C13) — superfície versionada `billingApiV1` para outros
 * contextos (Identity p/ trava de usuários; telas de assinatura) e para os gates
 * síncronos de cota. NÃO HTTP. Padrão de scheduling/api.ts + messaging/api.ts.
 *
 * checkAndIncrementQuota: gate SÍNCRONO (ADR-024). Lê uso materializado +
 * limites e aplica a política por dimensão. O INCREMENTO em si é eventual e
 * idempotente — feito pelos consumers de `scheduling.appointment.created` e
 * `ai_agent.conversation.completed` (evita dupla contagem). Aqui só a DECISÃO.
 */
import { eq } from 'drizzle-orm';

import type { Tx } from '@/lib/db';
import { withTenant } from '@/lib/db/tenant';

import { plans, subscriptions, type SubscriptionRow } from './schema';
import { isOffer2026PlanCode, type Offer2026PlanCode } from './proposed-offer';
import { currentPeriod, getPlanLimits, readUsage, type PlanLimits } from './internal/quota';
import { enforce, type QuotaType } from './internal/quota-policy';

export type { QuotaType };

export interface QuotaCheckResult {
  allowed: boolean;
  remaining: number;
  nearLimit: boolean;
}

export interface UserQuotaResult {
  allowed: boolean;
  limit: number;
}

export type PlanCode = 'solo' | 'clinica' | 'pro' | Offer2026PlanCode;

export interface BillingApiV1 {
  getPlanLimits(clinicId: string): Promise<PlanLimits | null>;
  getSubscription(clinicId: string): Promise<SubscriptionRow | null>;
  /** Gate síncrono de cota; agendamento e IA são apenas métricas. */
  checkAndIncrementQuota(clinicId: string, type: QuotaType): Promise<QuotaCheckResult>;
  /** Trava dura de usuários (ADR-024) — chamada no convite. */
  assertUserQuota(clinicId: string, activeUsers: number): Promise<UserQuotaResult>;
  /** Permissões granulares são recurso dos planos Clínica e Pro. */
  hasGranularPermissions(clinicId: string): Promise<boolean>;
  /** Políticas financeiras avançadas só existem nos planos Clínica e Pro. */
  hasAdvancedFinancialPolicies(clinicId: string, tx?: Tx): Promise<boolean>;
}

async function getPlanLimitsApi(clinicId: string): Promise<PlanLimits | null> {
  return withTenant(clinicId, (tx) => getPlanLimits(tx, clinicId));
}

async function getSubscriptionApi(clinicId: string): Promise<SubscriptionRow | null> {
  return withTenant(clinicId, async (tx) => {
    const [row] = await tx
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.clinicId, clinicId))
      .limit(1);
    return row ?? null;
  });
}

async function checkAndIncrementQuota(
  clinicId: string,
  type: QuotaType,
): Promise<QuotaCheckResult> {
  return withTenant(clinicId, async (tx) => {
    const limits = await getPlanLimits(tx, clinicId);
    // Sem subscription/limite → não bloqueia (clínica pré-billing).
    if (!limits) return { allowed: true, remaining: Number.MAX_SAFE_INTEGER, nearLimit: false };
    const usage = await readUsage(tx, clinicId, currentPeriod());
    const count = type === 'agendamento' ? usage.agendamentos : usage.ai_messages;
    const limit = type === 'agendamento' ? limits.agendamentos : limits.ai_messages;
    return enforce(type, count, limit);
  });
}

async function assertUserQuota(clinicId: string, activeUsers: number): Promise<UserQuotaResult> {
  const limits = await getPlanLimitsApi(clinicId);
  const limit = limits?.users ?? Number.MAX_SAFE_INTEGER;
  return { allowed: activeUsers < limit, limit };
}

async function hasGranularPermissions(clinicId: string): Promise<boolean> {
  return withTenant(clinicId, async (tx) => {
    const [row] = await tx
      .select({ code: plans.code })
      .from(subscriptions)
      .innerJoin(plans, eq(plans.id, subscriptions.planId))
      .where(eq(subscriptions.clinicId, clinicId))
      .limit(1);
    return planHasAdvancedFinancialPolicies(row?.code);
  });
}

export function planHasAdvancedFinancialPolicies(code: string | null | undefined): boolean {
  return (
    code === 'clinica' ||
    code === 'pro' ||
    (code != null && isOffer2026PlanCode(code) && code !== 'consultorio_2026')
  );
}

async function hasAdvancedFinancialPolicies(clinicId: string, tx?: Tx): Promise<boolean> {
  const read = async (connection: Tx): Promise<boolean> => {
    const [row] = await connection
      .select({ code: plans.code })
      .from(subscriptions)
      .innerJoin(plans, eq(plans.id, subscriptions.planId))
      .where(eq(subscriptions.clinicId, clinicId))
      .limit(1);
    return planHasAdvancedFinancialPolicies(row?.code);
  };
  return tx ? read(tx) : withTenant(clinicId, read);
}

export const billingApiV1: BillingApiV1 = {
  getPlanLimits: getPlanLimitsApi,
  getSubscription: getSubscriptionApi,
  checkAndIncrementQuota,
  assertUserQuota,
  hasGranularPermissions,
  hasAdvancedFinancialPolicies,
};
