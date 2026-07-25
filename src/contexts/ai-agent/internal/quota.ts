/**
 * Quota guard (C11 — PLACEHOLDER; lógica completa com usage_metrics em C13).
 *
 * Mantém a leitura do gasto mensal para telemetria, mas não bloqueia mensagens
 * por plano. Circuit breaker, segurança e modo fallback continuam valendo.
 */
import { and, eq, gte, sql } from 'drizzle-orm';

import type { Tx } from '@/lib/db';
import { aiMessages } from '../schema';

export interface QuotaCheck {
  blocked: boolean;
  spendUsd: number;
  limitUsd: number;
}

export async function checkQuota(tx: Tx, clinicId: string): Promise<QuotaCheck> {
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
  return { blocked: false, spendUsd, limitUsd: Number.POSITIVE_INFINITY };
}
