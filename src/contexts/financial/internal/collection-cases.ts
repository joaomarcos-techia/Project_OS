import { sql } from 'drizzle-orm';

import { withTenant } from '@/lib/db/tenant';

import type { DunningCandidate } from '../dunning-candidates';
import type { ManualCollectionStage } from '../dunning-policy';
import { collectionCases } from '../schema';

export async function upsertCollectionCase(
  candidate: DunningCandidate,
  stage: ManualCollectionStage,
): Promise<void> {
  await withTenant(candidate.clinicId, (tx) =>
    tx
      .insert(collectionCases)
      .values({
        clinicId: candidate.clinicId,
        lancamentoId: candidate.lancamentoId,
        stage,
        status: 'open',
        daysOverdue: candidate.daysOverdue,
        residualAmount: candidate.valor.toFixed(2),
      })
      .onConflictDoUpdate({
        target: collectionCases.lancamentoId,
        set: {
          stage,
          status: 'open',
          daysOverdue: candidate.daysOverdue,
          residualAmount: candidate.valor.toFixed(2),
          resolvedAt: null,
          updatedAt: sql`now()`,
        },
      }),
  );
}

export async function resolveSettledCollectionCases(clinicId: string): Promise<number> {
  return withTenant(clinicId, async (tx) => {
    const rows = (await tx.execute(
      sql`UPDATE collection_cases cc
           SET status = 'resolved', resolved_at = now(), updated_at = now()
         WHERE cc.status = 'open'
           AND cc.clinic_id = ${clinicId}
           AND NOT EXISTS (
             SELECT 1
               FROM lancamentos l
              WHERE l.id = cc.lancamento_id
                AND l.clinic_id = ${clinicId}
                AND l.status IN ('pendente', 'parcial')
                AND l.valor > l.valor_pago
           )
         RETURNING cc.id`,
    )) as unknown as Array<{ id: string }>;
    return rows.length;
  });
}
