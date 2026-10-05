import 'server-only';

import { sql } from 'drizzle-orm';

import { withTenant } from '@/lib/db/tenant';

export type ExcessRefundUiState = 'manual' | 'waiting' | 'confirmed' | 'cancelled' | 'failed';

export interface ExcessRefundStatus {
  appointmentId: string;
  amount: number;
  state: ExcessRefundUiState;
}

export interface ManualRefundTask {
  id: string;
  appointmentId: string;
  patientId: string | null;
  providerPaymentId: string | null;
  amount: number;
  purpose: 'excess' | 'deposit_closeout';
  state:
    | 'action_required'
    | 'account_unavailable'
    | 'readback_unavailable'
    | 'payment_id_missing'
    | 'failed';
}

type ManualRefundRow = {
  id: string;
  appointment_id: string;
  patient_id: string | null;
  provider_payment_id: string | null;
  amount: string;
  purpose: string;
  status: string;
  failure_code: string | null;
};

/** Pendências financeiras que exigem ação da clínica, inclusive tentativas antigas canceladas. */
export async function listManualRefundTasks(clinicId: string): Promise<ManualRefundTask[]> {
  return withTenant(clinicId, async (tx) => {
    const rows = await tx.execute<ManualRefundRow>(sql`
      SELECT i.id::text,
             c.appointment_id::text AS appointment_id,
             c.patient_id::text AS patient_id,
             i.provider_payment_id,
             i.amount::text,
             i.purpose,
             i.status::text,
             i.failure_code,
             i.created_at AS sort_at
        FROM patient_refund_intents i
        JOIN patient_charges c
          ON c.id = i.patient_charge_id
         AND c.clinic_id = i.clinic_id
       WHERE i.clinic_id = ${clinicId}::uuid
         AND c.clinic_id = ${clinicId}::uuid
         AND (
           (i.status IN ('pending', 'confirmation_pending')
            AND i.failure_code IN ('manual_action_required', 'payment_account_unavailable', 'provider_readback_unavailable'))
           OR i.status = 'failed'
         )
      UNION ALL
      SELECT c.id::text,
             c.appointment_id::text,
             c.patient_id::text,
             NULL::text AS provider_payment_id,
             c.amount::text,
             'deposit_closeout'::text AS purpose,
             'pending'::text AS status,
             c.failure_code,
             c.created_at AS sort_at
        FROM patient_charges c
       WHERE c.clinic_id = ${clinicId}::uuid
         AND c.kind = 'deposit'
         AND c.status = 'paid'
         AND c.provider_payment_id IS NULL
         AND c.failure_code = 'refund_missing_provider_payment_id'
         AND NOT EXISTS (
           SELECT 1 FROM patient_refund_intents i
            WHERE i.clinic_id = c.clinic_id AND i.patient_charge_id = c.id
         )
       ORDER BY sort_at ASC, id ASC
    `);
    return rows.map((row) => {
      if (row.purpose !== 'excess' && row.purpose !== 'deposit_closeout') {
        throw new Error(`[payments] propósito de estorno inválido: ${row.purpose}`);
      }
      return {
        id: row.id,
        appointmentId: row.appointment_id,
        patientId: row.patient_id,
        providerPaymentId: row.provider_payment_id,
        amount: Number(row.amount),
        purpose: row.purpose,
        state:
          row.status === 'failed'
            ? 'failed'
            : row.failure_code === 'refund_missing_provider_payment_id'
              ? 'payment_id_missing'
              : row.failure_code === 'payment_account_unavailable'
                ? 'account_unavailable'
                : row.failure_code === 'provider_readback_unavailable'
                  ? 'readback_unavailable'
                  : 'action_required',
      };
    });
  });
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
  if (
    row.failure_code === 'manual_action_required' ||
    row.failure_code === 'payment_account_unavailable' ||
    row.failure_code === 'provider_readback_unavailable'
  )
    return 'manual';
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
