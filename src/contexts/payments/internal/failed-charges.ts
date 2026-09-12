import 'server-only';

import { sql } from 'drizzle-orm';

import { withTenant } from '@/lib/db/tenant';

export interface FailedChargeDTO {
  chargeId: string;
  appointmentId: string;
  patientId: string | null;
  amount: number;
  /** Código estável já sanitizado pelo provider-adapter; nunca o corpo do erro. */
  failureCode: string | null;
  failedAt: string;
}

/**
 * Cobranças que o provider recusou criar — logo, o paciente NUNCA recebeu link.
 *
 * É uma falha silenciosa por natureza: sem link não há lembrete, sem lembrete
 * ninguém reclama, e a dívida some da vista da recepção até virar inadimplência
 * velha. O Caixa a traz para a superfície do dia justamente porque nada mais no
 * fluxo normal traria.
 *
 * `status = 'failed'` só é gravado por `markCheckoutCreationIssue` com desfecho
 * determinado. `creation_unknown` fica de fora de propósito: ali a cobrança
 * pode ter nascido do lado do provider, e anunciar "não foi enviada" seria
 * afirmar o que não se sabe.
 *
 * A fronteira não devolve nome de paciente (é Patient quem resolve isso, na
 * camada page) nem `invoice_url` nem resposta bruta do provider.
 */
export async function listFailedCharges(clinicId: string): Promise<FailedChargeDTO[]> {
  return withTenant(clinicId, async (tx) => {
    const rows = await tx.execute<{
      id: string;
      appointment_id: string;
      patient_id: string | null;
      amount: string;
      failure_code: string | null;
      updated_at: Date | string;
    }>(sql`
      SELECT id::text,
             appointment_id::text,
             patient_id::text,
             amount::text,
             failure_code,
             updated_at
        FROM patient_charges
       WHERE clinic_id = ${clinicId}::uuid
         AND status = 'failed'
       ORDER BY updated_at DESC
       LIMIT 20
    `);

    return rows.map((row) => ({
      chargeId: row.id,
      appointmentId: row.appointment_id,
      patientId: row.patient_id,
      amount: Number(row.amount),
      failureCode: row.failure_code,
      failedAt: new Date(row.updated_at).toISOString(),
    }));
  });
}
