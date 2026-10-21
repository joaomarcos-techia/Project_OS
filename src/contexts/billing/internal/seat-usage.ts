/**
 * Leitura dos tetos e do uso de equipe de uma clínica (ADR-067).
 *
 * Billing não importa o schema de Identity (boundaries), então conta `profiles`
 * em SQL cru — como `plan-changes` já fazia para o total de usuários. O
 * predicado de profissional é o de `practitionerSql` (ADR-032 §2) e o da
 * trigger da migration 0119; `seat-usage.test.ts` falha se os três divergirem.
 */
import { and, eq, sql } from 'drizzle-orm';

import type { Tx } from '@/lib/db';

import { planLimits, planSeatLimits, subscriptionChangeRequests, subscriptions } from '../schema';
import { effectiveSeatLimits, type SeatLimits, type SeatUsage } from './seat-limits';

/** Predicado de profissional sobre as colunas de `profiles`, sem qualificar a tabela. */
export const PROFILE_IS_PROFESSIONAL_SQL =
  "(role = 'doctor' OR (crm IS NOT NULL AND btrim(crm) <> ''))";

/** Uso atual. Convite pendente ocupa vaga (`ativo = true` desde o convite). */
export async function readSeatUsage(tx: Tx, clinicId: string): Promise<SeatUsage> {
  const isProfessional = sql.raw(PROFILE_IS_PROFESSIONAL_SQL);
  const [row] = await tx.execute<{ users: number; professionals: number; staff: number }>(sql`
    SELECT count(*)::int AS users,
           count(*) FILTER (WHERE role <> 'super_admin' AND ${isProfessional})::int AS professionals,
           count(*) FILTER (WHERE role <> 'super_admin' AND NOT ${isProfessional})::int AS staff
      FROM public.profiles
     WHERE clinic_id = ${clinicId}::uuid
       AND ativo = true
       AND deleted_at IS NULL
  `);
  return {
    users: Number(row?.users ?? 0),
    professionals: Number(row?.professionals ?? 0),
    staff: Number(row?.staff ?? 0),
  };
}

/** Teto efetivo da clínica; `null` = sem assinatura (sem teto). */
export async function readSeatLimits(tx: Tx, clinicId: string): Promise<SeatLimits | null> {
  const [sub] = await tx
    .select({ id: subscriptions.id, planId: subscriptions.planId })
    .from(subscriptions)
    .where(eq(subscriptions.clinicId, clinicId))
    .limit(1);
  if (!sub) return null;

  const [current] = await tx
    .select({ professionals: planSeatLimits.professionals, staff: planSeatLimits.staff })
    .from(planSeatLimits)
    .where(eq(planSeatLimits.planId, sub.planId))
    .limit(1);
  if (!current) {
    const [users] = await tx
      .select({ value: planLimits.limitValue })
      .from(planLimits)
      .where(and(eq(planLimits.planId, sub.planId), eq(planLimits.metric, 'users')))
      .limit(1);
    return effectiveSeatLimits({
      current: null,
      scheduledDowngrade: null,
      legacyUsers: users?.value ?? null,
    });
  }

  const [scheduled] = await tx
    .select({ professionals: planSeatLimits.professionals, staff: planSeatLimits.staff })
    .from(subscriptionChangeRequests)
    .innerJoin(planSeatLimits, eq(planSeatLimits.planId, subscriptionChangeRequests.toPlanId))
    .where(
      and(
        eq(subscriptionChangeRequests.subscriptionId, sub.id),
        eq(subscriptionChangeRequests.kind, 'downgrade'),
        eq(subscriptionChangeRequests.status, 'scheduled'),
      ),
    )
    .limit(1);
  return effectiveSeatLimits({
    current,
    scheduledDowngrade: scheduled ?? null,
    legacyUsers: null,
  });
}
