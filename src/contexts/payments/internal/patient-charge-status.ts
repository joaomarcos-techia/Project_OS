/**
 * Status das cobranças de um paciente para o agente responder "já paguei"
 * (08/10/2026, EC-22).
 *
 * Antes, o agente não tinha o que consultar: o paciente dizia que pagou e
 * recebia uma resposta genérica. Agora ele lê o status REAL — o que o Asaas
 * confirmou — e nunca dá nada como pago pela palavra do paciente.
 *
 * Estreito de propósito: sem link de pagamento, sem identificador do provedor,
 * sem forma de pagamento. Só o que a resposta precisa.
 */
import 'server-only';

import { and, desc, eq, gte } from 'drizzle-orm';

import { withTenant } from '@/lib/db/tenant';

import { patientCharges } from '../schema';

export interface PatientChargeStatus {
  chargeId: string;
  appointmentId: string;
  kind: 'deposit' | 'remainder';
  status: 'pending' | 'paid' | 'expired' | 'cancelled' | 'refunded' | 'failed';
  amount: number;
  paidAt: Date | null;
  holdExpiresAt: Date | null;
  createdAt: Date;
}

/** Janela do "já paguei": cobrança mais antiga que isto não é a que o paciente quer dizer. */
const LOOKBACK_DAYS = 30;

/** Cobranças do paciente nos últimos 30 dias, da mais recente para a mais antiga. */
export async function listPatientChargeStatuses(
  clinicId: string,
  patientId: string,
  now: Date = new Date(),
): Promise<PatientChargeStatus[]> {
  const since = new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000);
  const rows = await withTenant(clinicId, (tx) =>
    tx
      .select({
        chargeId: patientCharges.id,
        appointmentId: patientCharges.appointmentId,
        kind: patientCharges.kind,
        status: patientCharges.status,
        amount: patientCharges.amount,
        paidAt: patientCharges.paidAt,
        holdExpiresAt: patientCharges.holdExpiresAt,
        createdAt: patientCharges.createdAt,
      })
      .from(patientCharges)
      .where(
        and(
          eq(patientCharges.clinicId, clinicId),
          eq(patientCharges.patientId, patientId),
          gte(patientCharges.createdAt, since),
        ),
      )
      .orderBy(desc(patientCharges.createdAt))
      .limit(5),
  );
  return rows.map((row) => ({ ...row, amount: Number(row.amount) }));
}
