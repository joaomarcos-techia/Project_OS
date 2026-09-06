import 'server-only';

import { sql } from 'drizzle-orm';

import { withTenant } from '@/lib/db/tenant';

export type ExcessRefundUiState = 'waiting' | 'confirmed' | 'cancelled' | 'failed';

export interface ExcessRefundStatus {
  appointmentId: string;
  amount: number;
  state: ExcessRefundUiState;
}

type RefundStatusRow = {
  appointment_id: string;
  amount: string;
  status: 'pending' | 'submitting' | 'confirmation_pending' | 'confirmed' | 'failed';
  failure_code: string | null;
  updated_at: Date | string;
};

function toUiState(row: RefundStatusRow): ExcessRefundUiState {
  if (row.status === 'confirmed') return 'confirmed';
  if (row.status !== 'failed') return 'waiting';
  return row.failure_code === 'refund_cancelled' ? 'cancelled' : 'failed';
}

/**
 * Estado operacional do estorno D50 para o Caixa.
 *
 * A fronteira não expõe id de pagamento/refund nem erro bruto do provider. O
 * chamador recebe apenas o estado humano necessário para não confundir um
 * refund ainda em processamento com um refund cancelado.
 */
export async function listExcessRefundStatuses(
  clinicId: string,
  appointmentIds: readonly string[],
): Promise<ExcessRefundStatus[]> {
  if (appointmentIds.length === 0) return [];

  return withTenant(clinicId, async (tx) => {
    const ids = sql.join(
      [...new Set(appointmentIds)].map((id) => sql`${id}::uuid`),
      sql`, `,
    );
    const rows = await tx.execute<RefundStatusRow>(sql`
      SELECT DISTINCT ON (c.appointment_id)
             c.appointment_id::text AS appointment_id,
             i.amount::text AS amount,
             i.status::text AS status,
             i.failure_code,
             i.updated_at
        FROM patient_refund_intents i
        JOIN patient_charges c
          ON c.id = i.patient_charge_id
         AND c.clinic_id = i.clinic_id
       WHERE i.clinic_id = ${clinicId}::uuid
         AND c.clinic_id = ${clinicId}::uuid
         AND i.purpose = 'excess'
         AND c.appointment_id IN (${ids})
       ORDER BY c.appointment_id, i.updated_at DESC, i.id DESC
    `);

    return rows.map((row) => ({
      appointmentId: row.appointment_id,
      amount: Number(row.amount),
      state: toUiState(row),
    }));
  });
}
