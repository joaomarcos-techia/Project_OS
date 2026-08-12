/**
 * Seam privilegiado da fila de cobrança manual.
 *
 * `collection_cases` concede escrita somente a `service_role` (migration 0058),
 * portanto o contexto Financial não pode persistir a fila via `withTenant` /
 * papel `authenticated`. Este módulo mantém o bypass estreito: toda operação
 * valida e filtra `clinic_id`, não aceita vínculo cross-tenant e grava audit na
 * mesma transação (no audit, no op).
 */
import 'server-only';

import { sql } from 'drizzle-orm';

import { logAudit } from '@/lib/audit/log';
import type { RequestContext } from '@/lib/audit/types';
import { dbAdmin } from '@/lib/db';
import { getContext } from '@/lib/observability/context';

export interface PrivilegedCollectionCandidate {
  clinicId: string;
  lancamentoId: string;
  valor: number;
  daysOverdue: number;
}

export type PrivilegedCollectionStage = 'd15_review' | 'd30_manual';

function collectionRequestContext(lancamentoId: string): RequestContext {
  const requestId = getContext()?.requestId ?? `proactive-dunning:${lancamentoId}`;
  // O request_id forense aceita o identificador textual do cron; a coluna
  // correlation_id é UUID. Sem um UUID upstream comprovado, não invente cast.
  return { ip: null, userAgent: null, requestId, correlationId: null };
}

export async function upsertCollectionCasePrivileged(
  candidate: PrivilegedCollectionCandidate,
  stage: PrivilegedCollectionStage,
): Promise<void> {
  await dbAdmin.transaction(async (tx) => {
    const source = await tx.execute<{ id: string }>(sql`
      SELECT id::text AS id
        FROM lancamentos
       WHERE id = ${candidate.lancamentoId}
         AND clinic_id = ${candidate.clinicId}
       LIMIT 1`);
    if (!source[0]) {
      throw new Error('collection case source does not belong to the candidate clinic');
    }

    const residualAmount = candidate.valor.toFixed(2);
    const changed = await tx.execute<{ id: string }>(sql`
      INSERT INTO collection_cases
        (clinic_id, lancamento_id, stage, status, days_overdue, residual_amount)
      VALUES
        (${candidate.clinicId}, ${candidate.lancamentoId},
         CAST(${stage} AS collection_case_stage), 'open',
         ${candidate.daysOverdue}, CAST(${residualAmount} AS numeric))
      ON CONFLICT (lancamento_id) DO UPDATE SET
        stage = EXCLUDED.stage,
        status = 'open',
        days_overdue = EXCLUDED.days_overdue,
        residual_amount = EXCLUDED.residual_amount,
        resolved_at = NULL
      WHERE collection_cases.clinic_id = ${candidate.clinicId}
        AND (
          collection_cases.stage IS DISTINCT FROM EXCLUDED.stage
          OR collection_cases.status IS DISTINCT FROM 'open'
          OR collection_cases.days_overdue IS DISTINCT FROM EXCLUDED.days_overdue
          OR collection_cases.residual_amount IS DISTINCT FROM EXCLUDED.residual_amount
          OR collection_cases.resolved_at IS NOT NULL
        )
      RETURNING id::text AS id`);

    if (!changed[0]) {
      const existing = await tx.execute<{ id: string }>(sql`
        SELECT id::text AS id
          FROM collection_cases
         WHERE lancamento_id = ${candidate.lancamentoId}
           AND clinic_id = ${candidate.clinicId}
         LIMIT 1`);
      if (!existing[0]) {
        throw new Error('collection case conflict belongs to a different clinic');
      }
      return;
    }

    await logAudit(tx, {
      clinicId: candidate.clinicId,
      userId: null,
      action: 'financial.collection_case.upserted',
      resourceType: 'collection_case',
      resourceId: changed[0].id,
      before: null,
      after: { stage, daysOverdue: candidate.daysOverdue, residualAmount },
      requestContext: collectionRequestContext(candidate.lancamentoId),
    });
  });
}

export async function resolveSettledCollectionCasesPrivileged(clinicId: string): Promise<number> {
  return dbAdmin.transaction(async (tx) => {
    const rows = await tx.execute<{ id: string; lancamentoId: string }>(
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
         RETURNING cc.id::text AS id, cc.lancamento_id::text AS "lancamentoId"`,
    );
    for (const row of rows) {
      await logAudit(tx, {
        clinicId,
        userId: null,
        action: 'financial.collection_case.resolved',
        resourceType: 'collection_case',
        resourceId: row.id,
        before: null,
        after: { status: 'resolved' },
        requestContext: collectionRequestContext(row.lancamentoId),
      });
    }
    return rows.length;
  });
}
