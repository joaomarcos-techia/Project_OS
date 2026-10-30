import { sql } from 'drizzle-orm';

import type { Tx } from '@/lib/db';

/** Revalida o profissional sob o RLS do tenant. O cálculo do repasse revalida de novo. */
export async function isEligiblePayoutProfessional(
  tx: Tx,
  clinicId: string,
  professionalId: string,
): Promise<boolean> {
  const rows = await tx.execute<{ ok: number }>(sql`
    SELECT 1 AS ok FROM profiles
    WHERE id = ${professionalId}
      AND clinic_id = ${clinicId}
      AND deleted_at IS NULL
      AND ativo = true
      AND role <> 'owner'
      AND (role = 'doctor' OR (crm IS NOT NULL AND btrim(crm) <> ''))
    LIMIT 1
  `);
  return rows.length > 0;
}
