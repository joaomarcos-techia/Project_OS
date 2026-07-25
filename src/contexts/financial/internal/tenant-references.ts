import { sql } from 'drizzle-orm';

import type { Tx } from '@/lib/db';

import { FinancialValidationError } from '../errors';

export async function assertFinancialReferencesInClinic(
  tx: Tx,
  clinicId: string,
  refs: {
    patientId?: string | null | undefined;
    supplierId?: string | null | undefined;
    unitId?: string | null | undefined;
  },
): Promise<void> {
  if (refs.patientId) {
    const rows = await tx.execute<{ ok: number }>(
      sql`SELECT 1 AS ok FROM patients
           WHERE id = ${refs.patientId}
             AND clinic_id = ${clinicId}
             AND deleted_at IS NULL
           LIMIT 1`,
    );
    if (!rows[0]) throw new FinancialValidationError('paciente inválido para esta clínica');
  }

  if (refs.supplierId) {
    const rows = await tx.execute<{ ok: number }>(
      sql`SELECT 1 AS ok FROM suppliers
           WHERE id = ${refs.supplierId}
             AND clinic_id = ${clinicId}
             AND ativo = true
           LIMIT 1`,
    );
    if (!rows[0]) throw new FinancialValidationError('fornecedor inválido para esta clínica');
  }

  if (refs.unitId) {
    const rows = await tx.execute<{ ok: number }>(
      sql`SELECT 1 AS ok FROM clinic_units
           WHERE id = ${refs.unitId}
             AND clinic_id = ${clinicId}
             AND ativo = true
           LIMIT 1`,
    );
    if (!rows[0]) throw new FinancialValidationError('unidade inválida para esta clínica');
  }
}
