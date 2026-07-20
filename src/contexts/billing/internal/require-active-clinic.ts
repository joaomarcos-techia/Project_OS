/**
 * requireActiveClinic (C13 — ADR-016). Enforcement de acesso APP-LAYER (nunca
 * RLS). Bloqueia mutação de negócio quando a clínica está suspended_readonly /
 * suspended / cancelled / pending_payment. Lê clinics.status via withTenant
 * (RLS aplica; a clínica lê só a própria linha).
 *
 * ⚠️ ESTA função é o caminho para quem NÃO passa pelo chokepoint. Desde o
 * ADR-046 o gate roda dentro do `idempotentMutation`
 * ([assertClinicCanWriteTx](../../../lib/tenant-access/index.ts)), então a
 * imensa maioria das mutações é coberta automaticamente. Chamar isto à mão só é
 * necessário nas escritas que driblam o wrapper de propósito — hoje só o
 * auto-save do prontuário (alta frequência, sem audit).
 *
 * Antes do ADR-046 esta função existia mas era chamada em SETE lugares, TODOS em
 * `equipe/actions.ts`: uma clínica suspensa seguia criando paciente, agendando e
 * escrevendo prontuário. O "somente leitura" era encenação.
 */
import { sql } from 'drizzle-orm';

import { withTenant } from '@/lib/db/tenant';
import { ClinicAccessError, isWriteBlocked, type ClinicStatus } from '@/lib/tenant-access';

export { ClinicAccessError };

export async function requireActiveClinic(clinicId: string): Promise<void> {
  const status = await withTenant(clinicId, async (tx) => {
    const rows = (await tx.execute(
      sql`SELECT status FROM clinics WHERE id = ${clinicId}::uuid LIMIT 1`,
    )) as unknown as Array<{ status: ClinicStatus }>;
    return rows[0]?.status ?? null;
  });
  if (status && isWriteBlocked(status)) throw new ClinicAccessError(status);
}
