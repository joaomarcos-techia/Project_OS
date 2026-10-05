import { sql } from 'drizzle-orm';

import type { Tx } from '@/lib/db';

/** Revalida o profissional e bloqueia alterações concorrentes até o fim da transação. */
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
    FOR SHARE
  `);
  return rows.length > 0;
}
