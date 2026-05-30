/**
 * `pnpm hard-delete:once`
 *
 * Roda o job de hard-delete fora do HTTP (mesma lógica de
 * /api/cron/patient-hard-delete): varre pacientes com soft-delete > 30 dias,
 * anonimiza PII no audit (via dbAdmin), e apaga por clínica via withTenant
 * (cascade nos filhos; suppression_list sobrevive). SÓ dev.
 *
 * Limite via env HARD_DELETE_LIMIT (default 100).
 */
import './_env';

import { sql } from 'drizzle-orm';

import { hardDeletePatients } from '@/contexts/patient/internal/hard-delete';
import { dbAdmin } from '@/lib/db';

const limit = Math.min(Math.max(Number(process.env.HARD_DELETE_LIMIT) || 100, 1), 1000);

const rows = (await dbAdmin.execute(
  sql`SELECT id::text AS id, clinic_id::text AS clinic_id
      FROM patients
      WHERE deleted_at IS NOT NULL AND deleted_at < now() - interval '30 days'
      ORDER BY deleted_at ASC
      LIMIT ${limit}`,
)) as unknown as Array<{ id: string; clinic_id: string }>;

if (rows.length === 0) {
  console.log('[hard-delete] nada expirado (>30 dias de soft-delete).');
  process.exit(0);
}

const byClinic = new Map<string, string[]>();
for (const r of rows) {
  const arr = byClinic.get(r.clinic_id) ?? [];
  arr.push(r.id);
  byClinic.set(r.clinic_id, arr);
}

const allIds = rows.map((r) => r.id);
await dbAdmin.execute(
  sql`UPDATE audit_events
      SET before = (before - 'nome' - 'email'), after = (after - 'nome' - 'email')
      WHERE resource_type = 'patient' AND resource_id = ANY(${allIds}::text[])`,
);

let deleted = 0;
for (const [clinicId, ids] of byClinic) {
  deleted += await hardDeletePatients(clinicId, ids);
}

console.log(`[hard-delete] deleted=${deleted} clinics=${byClinic.size} (audit PII anonimizada)`);
process.exit(0);
