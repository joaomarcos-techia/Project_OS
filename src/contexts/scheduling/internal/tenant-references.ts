import { sql } from 'drizzle-orm';

import type { Tx } from '@/lib/db';

import { SchedulingValidationError } from '../errors';

export async function assertUnitInClinic(
  tx: Tx,
  clinicId: string,
  unitId: string | null | undefined,
): Promise<void> {
  if (!unitId) return;
  const rows = await tx.execute<{ ok: number }>(
    sql`SELECT 1 AS ok FROM clinic_units
         WHERE id = ${unitId}
           AND clinic_id = ${clinicId}
           AND ativo = true
         LIMIT 1`,
  );
  if (!rows[0]) throw new SchedulingValidationError('unidade inválida para esta clínica');
}
