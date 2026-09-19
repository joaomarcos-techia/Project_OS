/**
 * Detector de créditos de paciente envelhecidos que continuam `available`.
 *
 * Somente observa: decidir entre alocar, estornar ou reter dinheiro exige o
 * estado autoritativo do pagamento e uma regra de produto. O reconcile apenas
 * torna o risco D52 operável sem atravessar ownership de Payments/Scheduling.
 */
import { sql } from 'drizzle-orm';

import type { Tx } from '@/lib/db';

export const ORPHAN_CREDIT_AGE_DAYS = 30;

export interface OrphanCreditGroup {
  clinicId: string;
  appointmentStatus: string;
  count: number;
}

/**
 * Um crédito antigo não é órfão enquanto a consulta ainda estiver no futuro.
 * Depois do horário agendado, qualquer `available` com 30+ dias precisa de
 * investigação: terminal indica evento/closeout perdido; estado ativo indica
 * agenda sem desfecho. O `LEFT JOIN` também evidencia vínculo ausente/corrompido.
 */
export async function scanOrphanCredits(tx: Tx): Promise<OrphanCreditGroup[]> {
  const rows = await tx.execute<{
    clinicId: string;
    appointmentStatus: string;
    count: number;
  }>(sql`
    SELECT
      c.clinic_id::text AS "clinicId",
      coalesce(a.status::text, 'missing') AS "appointmentStatus",
      count(*)::int AS count
    FROM patient_credits c
    LEFT JOIN appointments a ON a.id = c.appointment_id
    WHERE c.status = 'available'
      AND c.granted_at < now() - ${sql.raw(`interval '${ORPHAN_CREDIT_AGE_DAYS} days'`)}
      AND (a.id IS NULL OR a.scheduled_at < now())
    GROUP BY c.clinic_id, coalesce(a.status::text, 'missing')
    ORDER BY c.clinic_id, coalesce(a.status::text, 'missing')
  `);

  return rows as unknown as OrphanCreditGroup[];
}
