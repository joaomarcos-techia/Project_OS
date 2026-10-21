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

import type { SubscriptionCreatedPayload } from './events';
import { planHasTeamFeatures } from './offer-2026';
import { plans, subscriptions, type SubscriptionRow } from './schema';
import { currentPeriod, getPlanLimits, readUsage, type PlanLimits } from './internal/quota';
import { enforce, type QuotaType } from './internal/quota-policy';
import {
  decideSeatQuota,
  type SeatCategory,
  type SeatDimension,
  type SeatLimits,
  type SeatUsage,
} from './internal/seat-limits';
import { readSeatLimits, readSeatUsage } from './internal/seat-usage';

export type { QuotaType, SeatCategory, SeatDimension, SeatLimits, SeatUsage };

export interface QuotaCheckResult {
  allowed: boolean;
  remaining: number;
  nearLimit: boolean;
}

export interface SeatQuotaResult {
  allowed: boolean;
  /** Dimensão que barrou (`users` na tabela antiga); `null` quando cabe. */
  dimension: SeatDimension | null;
  limit: number | null;
  limits: SeatLimits | null;
  usage: SeatUsage;
}

/** Tabela antiga (Solo/Clínica/Pro) + oferta por profissional (ADR-067). */
export type PlanCode = SubscriptionCreatedPayload['planCode'];

export interface BillingApiV1 {
  getPlanLimits(clinicId: string): Promise<PlanLimits | null>;
  getSubscription(clinicId: string): Promise<SubscriptionRow | null>;
  /** Gate síncrono de cota; agendamento e IA são apenas métricas. */
  checkAndIncrementQuota(clinicId: string, type: QuotaType): Promise<QuotaCheckResult>;
  /** Tetos de equipe do plano vigente (ADR-067); `null` = sem assinatura. */
  getSeatLimits(clinicId: string): Promise<SeatLimits | null>;
  /**
   * Checagem barata antes do convite: cabe mais uma pessoa desta categoria?
   * A autoridade é a trigger de `profiles` (migration 0119) e o advisory lock
   * do convite; isto evita mandar e-mail de convite que o banco recusaria.
   */
  checkSeatQuota(clinicId: string, category: SeatCategory): Promise<SeatQuotaResult>;
  /** Permissões granulares são recurso da Clínica (e do Pro antigo). */
  hasGranularPermissions(clinicId: string): Promise<boolean>;
  /** Políticas financeiras avançadas só existem na Clínica (e no Pro antigo). */
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

async function getSeatLimitsApi(clinicId: string): Promise<SeatLimits | null> {
  return withTenant(clinicId, (tx) => readSeatLimits(tx, clinicId));
}

async function checkSeatQuota(clinicId: string, category: SeatCategory): Promise<SeatQuotaResult> {
  return withTenant(clinicId, async (tx) => {
    const [limits, usage] = await Promise.all([
      readSeatLimits(tx, clinicId),
      readSeatUsage(tx, clinicId),
    ]);
    return { ...decideSeatQuota(limits, usage, category), limits, usage };
  });
}

async function hasGranularPermissions(clinicId: string): Promise<boolean> {
  return withTenant(clinicId, async (tx) => {
    const [row] = await tx
      .select({ code: plans.code })
      .from(subscriptions)
      .innerJoin(plans, eq(plans.id, subscriptions.planId))
      .where(eq(subscriptions.clinicId, clinicId))
      .limit(1);
    return planHasTeamFeatures(row?.code);
  });
}

export function planHasAdvancedFinancialPolicies(code: string | null | undefined): boolean {
  return planHasTeamFeatures(code);
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
  getSeatLimits: getSeatLimitsApi,
  checkSeatQuota,
  hasGranularPermissions,
  hasAdvancedFinancialPolicies,
};
