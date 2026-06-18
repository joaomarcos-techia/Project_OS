/**
 * requireActiveClinic (C13 — ADR-016). Enforcement de acesso APP-LAYER (nunca
 * RLS). Bloqueia mutação de negócio quando a clínica está suspended_readonly /
 * suspended / cancelled / pending_payment. Lê clinics.status via withTenant
 * (RLS aplica; a clínica lê só a própria linha).
 *
 * Chamar no boundary de Server Actions mutativas. O worker/outbox NÃO chama isto
 * (status-agnóstico — ADR-016). Rollout amplo nas mutations dos demais contextos
 * é follow-up; as mutations de billing já chamam.
 */
import { sql } from 'drizzle-orm';

import { withTenant } from '@/lib/db/tenant';

import { isWriteBlocked, type ClinicStatus } from './access';

export class ClinicAccessError extends Error {
  readonly code = 'clinic_write_blocked';
  constructor(readonly status: ClinicStatus) {
    super(`[billing] escrita bloqueada: clínica está '${status}'`);
    this.name = 'ClinicAccessError';
  }
}

export async function requireActiveClinic(clinicId: string): Promise<void> {
  const status = await withTenant(clinicId, async (tx) => {
    const rows = (await tx.execute(
      sql`SELECT status FROM clinics WHERE id = ${clinicId}::uuid LIMIT 1`,
    )) as unknown as Array<{ status: ClinicStatus }>;
    return rows[0]?.status ?? null;
  });
  if (status && isWriteBlocked(status)) throw new ClinicAccessError(status);
}
