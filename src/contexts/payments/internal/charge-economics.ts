import 'server-only';

import { sql } from 'drizzle-orm';

import { withTenant } from '@/lib/db/tenant';

export interface PatientChargeEconomicsDTO {
  chargeId: string;
  appointmentId: string;
  kind: 'deposit' | 'remainder';
  status: 'pending' | 'paid' | 'expired' | 'cancelled' | 'refunded' | 'failed';
  requestedAmount: number;
  providerGrossAmount: number | null;
  providerFeeAmount: number | null;
  providerNetAmount: number | null;
}

/** Fatos de cada cobrança, sem link, identificador do provider ou dado do paciente. */
export async function listPatientChargeEconomics(
  clinicId: string,
  appointmentIds: readonly string[],
): Promise<PatientChargeEconomicsDTO[]> {
  const ids = [...new Set(appointmentIds)];
  if (ids.length === 0) return [];
  return withTenant(clinicId, async (tx) => {
    const rows = await tx.execute<{
      id: string;
      appointment_id: string;
      kind: PatientChargeEconomicsDTO['kind'];
      status: PatientChargeEconomicsDTO['status'];
      amount: string;
      provider_gross_amount: string | null;
      provider_fee_amount: string | null;
      provider_net_amount: string | null;
    }>(sql`
      SELECT id::text, appointment_id::text, kind, status, amount::text,
             provider_gross_amount::text, provider_fee_amount::text,
             provider_net_amount::text
        FROM patient_charges
       WHERE clinic_id = ${clinicId}::uuid
         AND appointment_id IN (${sql.join(
           ids.map((id) => sql`${id}::uuid`),
           sql`, `,
         )})
       ORDER BY created_at ASC, id ASC
    `);
    return rows.map((row) => ({
      chargeId: row.id,
      appointmentId: row.appointment_id,
      kind: row.kind,
      status: row.status,
      requestedAmount: Number(row.amount),
      providerGrossAmount:
        row.provider_gross_amount === null ? null : Number(row.provider_gross_amount),
      providerFeeAmount: row.provider_fee_amount === null ? null : Number(row.provider_fee_amount),
      providerNetAmount: row.provider_net_amount === null ? null : Number(row.provider_net_amount),
    }));
  });
}
