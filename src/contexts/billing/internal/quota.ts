/**
 * Quota engine — CONTAGEM (DB). As REGRAS vivem em quota-policy.ts (GAP6).
 * Incremento idempotente exatamente-1× via usage_counter_ledger; usage_metrics
 * é o contador materializado (contrato §13.2).
 */
import { and, eq, sql } from 'drizzle-orm';

import type { Tx } from '@/lib/db';

import { planLimits, subscriptions, usageCounterLedger, usageMetrics } from '../schema';
import type { LedgerKey } from './quota-policy';

export interface PlanLimits {
  users: number;
  agendamentos: number;
  ai_messages: number;
}

/** 'YYYY-MM' em UTC (período do usage_metrics). */
export function currentPeriod(now: Date = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Limites do plano vigente da clínica (via subscription → plan_limits). */
export async function getPlanLimits(tx: Tx, clinicId: string): Promise<PlanLimits | null> {
  const [sub] = await tx
    .select({ planId: subscriptions.planId })
    .from(subscriptions)
    .where(eq(subscriptions.clinicId, clinicId))
    .limit(1);
  if (!sub) return null;
  const rows = await tx
    .select({ metric: planLimits.metric, value: planLimits.limitValue })
    .from(planLimits)
    .where(eq(planLimits.planId, sub.planId));
  const out: PlanLimits = { users: 0, agendamentos: 0, ai_messages: 0 };
  for (const r of rows) out[r.metric] = r.value;
  return out;
}

/** Uso materializado do período. */
export async function readUsage(
  tx: Tx,
  clinicId: string,
  period: string,
): Promise<{ agendamentos: number; ai_messages: number }> {
  const [row] = await tx
    .select({
      ag: usageMetrics.agendamentosCount,
      ia: usageMetrics.conversasIaCount,
    })
    .from(usageMetrics)
    .where(and(eq(usageMetrics.clinicId, clinicId), eq(usageMetrics.periodYyyymm, period)))
    .limit(1);
  return { agendamentos: row?.ag ?? 0, ai_messages: row?.ia ?? 0 };
}

/**
 * Conta 1 unidade de forma idempotente. Insere no ledger (PK clinic+metric+dedup);
 * se foi NOVO, incrementa usage_metrics. Re-entrega at-least-once não duplica.
 * Retorna true se contou (linha nova), false se já contado.
 */
export async function recordUsage(
  tx: Tx,
  clinicId: string,
  key: LedgerKey,
  period: string,
): Promise<boolean> {
  const inserted = await tx
    .insert(usageCounterLedger)
    .values({
      clinicId,
      metric: key.metric,
      subjectId: key.subjectId,
      dedupKey: key.dedupKey,
      periodYyyymm: period,
    })
    .onConflictDoNothing()
    .returning({ dedupKey: usageCounterLedger.dedupKey });
  if (inserted.length === 0) return false;

  if (key.metric === 'agendamentos') {
    await tx
      .insert(usageMetrics)
      .values({ clinicId, periodYyyymm: period, agendamentosCount: 1 })
      .onConflictDoUpdate({
        target: [usageMetrics.clinicId, usageMetrics.periodYyyymm],
        set: { agendamentosCount: sql`${usageMetrics.agendamentosCount} + 1`, updatedAt: sql`now()` },
      });
  } else if (key.metric === 'ai_messages') {
    await tx
      .insert(usageMetrics)
      .values({ clinicId, periodYyyymm: period, conversasIaCount: 1 })
      .onConflictDoUpdate({
        target: [usageMetrics.clinicId, usageMetrics.periodYyyymm],
        set: { conversasIaCount: sql`${usageMetrics.conversasIaCount} + 1`, updatedAt: sql`now()` },
      });
  }
  return true;
}
