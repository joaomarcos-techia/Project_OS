/**
 * Quota guard (C11 — PLACEHOLDER; lógica completa com usage_metrics em C13).
 *
 * Verifica o gasto de IA do MÊS corrente da clínica (SUM de
 * ai_messages.cost_usd) contra o orçamento: ai_clinic_config.monthly_budget_usd
 * quando definido (R4 — per-clinic), senão env.AI_MONTHLY_COST_LIMIT_USD.
 * Estourou → o handler bloqueia o turno (QUOTA_FALLBACK, sem chamar o LLM).
 */
import { and, eq, gte, sql } from 'drizzle-orm';

import type { Tx } from '@/lib/db';
import { env } from '@/lib/env';
import { metrics } from '@/lib/observability/metrics';

import { aiClinicConfig, aiMessages } from '../schema';

export interface QuotaCheck {
  blocked: boolean;
  spendUsd: number;
  limitUsd: number;
}

export async function checkQuota(tx: Tx, clinicId: string): Promise<QuotaCheck> {
  const [config] = await tx
    .select({ monthlyBudgetUsd: aiClinicConfig.monthlyBudgetUsd })
    .from(aiClinicConfig)
    .where(eq(aiClinicConfig.clinicId, clinicId))
    .limit(1);

  const limitUsd =
    config?.monthlyBudgetUsd !== null && config?.monthlyBudgetUsd !== undefined
      ? Number(config.monthlyBudgetUsd)
      : env.AI_MONTHLY_COST_LIMIT_USD;

  const [row] = await tx
    .select({ spend: sql<string>`COALESCE(SUM(${aiMessages.costUsd}), 0)` })
    .from(aiMessages)
    .where(
      and(
        eq(aiMessages.clinicId, clinicId),
        gte(aiMessages.createdAt, sql`date_trunc('month', now())`),
      ),
    );

  const spendUsd = Number(row?.spend ?? 0);
  const blocked = spendUsd >= limitUsd;
  if (blocked) {
    metrics.emit('ai_agent.quota.blocked', { clinicId, spendUsd, limitUsd });
  }
  return { blocked, spendUsd, limitUsd };
}
