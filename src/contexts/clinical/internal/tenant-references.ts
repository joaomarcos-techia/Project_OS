import { sql } from 'drizzle-orm';

import type { Tx } from '@/lib/db';

import { ClinicalValidationError } from '../errors';

/**
 * Confirma que a consulta pertence ao tenant e ao mesmo paciente do prontuário.
 * A query permanece dentro da transação idempotente para evitar uma janela
 * entre validar a referência e persistir o vínculo.
 */
export async function assertAppointmentMatchesPatient(
  tx: Tx,
  clinicId: string,
  appointmentId: string,
  patientId: string,
): Promise<void> {
  const rows = await tx.execute<{ ok: number }>(
    sql`SELECT 1 AS ok
          FROM appointments
         WHERE id = ${appointmentId}::uuid
           AND clinic_id = ${clinicId}::uuid
           AND patient_id = ${patientId}::uuid
         LIMIT 1`,
  );
  if (!rows[0]) {
    throw new ClinicalValidationError('Consulta não encontrada para este paciente.');
  }
}

/** Impede ligar uma prescrição a prontuário de outro paciente ou tenant. */
export async function assertProntuarioMatchesPatient(
  tx: Tx,
  clinicId: string,
  prontuarioId: string,
  patientId: string,
): Promise<void> {
  const rows = await tx.execute<{ ok: number }>(
    sql`SELECT 1 AS ok
          FROM prontuarios
         WHERE id = ${prontuarioId}::uuid
           AND clinic_id = ${clinicId}::uuid
           AND patient_id = ${patientId}::uuid
         LIMIT 1`,
  );
  if (!rows[0]) {
    throw new ClinicalValidationError('Prontuário não encontrado para este paciente.');
  }
}
