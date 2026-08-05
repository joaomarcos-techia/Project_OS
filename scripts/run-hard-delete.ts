/**
 * `pnpm hard-delete:once`
 *
 * Roda o job de hard-delete fora do HTTP (mesma lógica de
 * /api/cron/patient-hard-delete): varre pacientes com soft-delete > 30 dias
 * (excluindo já anonimizados — F-02), anonimiza PII no audit (via dbAdmin,
 * função COMPARTILHADA com a rota — F-11: este script removia menos chaves PII
 * que a rota), e processa POR PACIENTE via withTenant: delete físico ou, se o
 * FK RESTRICT clínico bloquear (ADR-017), anonimização in-place (ADR-021).
 * suppression_list sobrevive. SÓ dev.
 *
 * Limite via env HARD_DELETE_LIMIT (default 100).
 */
import './_env';

import { sql } from 'drizzle-orm';

import {
  anonymizePatientAuditTrail,
  hardDeletePatients,
} from '@/contexts/patient/internal/hard-delete';
import { dbAdmin } from '@/lib/db';

const limit = Math.min(Math.max(Number(process.env.HARD_DELETE_LIMIT) || 100, 1), 1000);

const rows = (await dbAdmin.execute(
  sql`SELECT id::text AS id, clinic_id::text AS clinic_id
      FROM patients
      WHERE deleted_at IS NOT NULL AND deleted_at < now() - interval '30 days'
        AND anonymized_at IS NULL
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

await anonymizePatientAuditTrail(
  dbAdmin,
  rows.map((r) => r.id),
);

let deleted = 0;
let anonymized = 0;
let failed = 0;
for (const [clinicId, ids] of byClinic) {
  try {
    const outcome = await hardDeletePatients(clinicId, ids);
    deleted += outcome.deleted;
    anonymized += outcome.anonymized;
    failed += outcome.failed;
  } catch (err) {
    failed += ids.length;
    console.error(`[hard-delete] clínica ${clinicId} falhou:`, err);
  }
}

console.log(
  `[hard-delete] deleted=${deleted} anonymized=${anonymized} failed=${failed} clinics=${byClinic.size} (audit PII anonimizada)`,
);
process.exit(failed > 0 ? 1 : 0);
