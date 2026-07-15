/**
 * GET /api/cron/patient-hard-delete
 *
 * Daily job (vercel.json crons[]). Hard-deletes patients whose 30-day
 * soft-delete window elapsed (PlanoAção §5.6.5). Cross-tenant scan uses dbAdmin
 * (BYPASSRLS) to FIND expired ids; the actual DELETE is per-clinic via
 * withTenant (RLS-scoped) in the patient context. FK CASCADE removes child
 * rows; suppression_list survives (no FK).
 *
 * F-02 (auditoria forense 2026-06-10):
 *   - Processamento POR PACIENTE (savepoints) em vez de lote tudo-ou-nada:
 *     paciente com prontuário (FK RESTRICT, ADR-017) é ANONIMIZADO (ADR-021)
 *     em vez de bloquear o lote inteiro da clínica para sempre.
 *   - Loop por clínica com try/catch: a falha de uma clínica NÃO aborta as
 *     demais no mesmo run.
 *   - Scan exclui `anonymized_at IS NOT NULL` (já tratados).
 *   - lgpd_requests vira 'completed' (deleted/anonymized) ou 'failed' (erro).
 *
 * Auth mirrors /api/cron/outbox (Bearer CRON_SECRET + x-vercel-cron, with
 * OUTBOX_CRON_ALLOW_NON_VERCEL / non-prod escape hatch for smoke).
 *
 * LIMIT bounds the batch so a large backlog cannot slam the DB (5.7 checklist).
 *
 * Audit (ADR-012 decision): audit_events are RETAINED for forensic/legal
 * integrity, but the erased patient's PII is stripped from the before/after
 * JSON via dbAdmin — append-only RLS blocks the authenticated role from doing
 * this, so it is done here at the service layer. F-11: a lógica é compartilhada
 * com o script dev em anonymizePatientAuditTrail (fonte única de chaves PII).
 */
import { sql } from 'drizzle-orm';

import {
  anonymizePatientAuditTrail,
  hardDeletePatients,
} from '@/contexts/patient/internal/hard-delete';
import { recordHeartbeat } from '@/lib/cron-heartbeat';
import { dbAdmin } from '@/lib/db';
import { safeEqual } from '@/lib/auth/secret-compare';
import { env, assertCronRuntimeReady } from '@/lib/env';
import { metrics } from '@/lib/observability/metrics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1000;

function isAuthorized(req: Request): boolean {
  // Bearer é o gate duro (mecanismo oficial Vercel).
  // V5 (auditoria de segurança): rota DESTRUTIVA — usa o segredo dedicado quando
  // configurado (opt-in), senão cai no CRON_SECRET (retrocompat). Reduz o blast
  // radius de um vazamento do CRON_SECRET (que guarda também rotas read-only).
  const cronSecret = env.CRON_SECRET_DESTRUCTIVE ?? env.CRON_SECRET;
  if (!safeEqual(req.headers.get('authorization'), `Bearer ${cronSecret}`)) return false;
  // F-09: 2º fator de origem NÃO-FATAL (aceita x-vercel-cron OU o documentado
  // x-vercel-cron-schedule). Ausência em prod → log, não 401 (ver outbox route).
  const hasOriginHeader =
    req.headers.get('x-vercel-cron') !== null ||
    req.headers.get('x-vercel-cron-schedule') !== null;
  const allowNonVercel =
    process.env.OUTBOX_CRON_ALLOW_NON_VERCEL === 'true' || env.NODE_ENV !== 'production';
  if (!hasOriginHeader && !allowNonVercel) {
    metrics.emit('cron.origin_header_missing', { route: 'patient-hard-delete' });
  }
  return true;
}

export async function GET(req: Request): Promise<Response> {
  assertCronRuntimeReady();
  if (!isAuthorized(req)) {
    metrics.emit('cron.unauthorized', { route: 'patient-hard-delete' });
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || DEFAULT_LIMIT, 1), MAX_LIMIT);

  try {
    // 1. Cross-tenant scan: expired soft-deletes (oldest first), excluindo os
    //    já anonimizados (F-02 — senão o job re-tenta os mesmos ids p/ sempre).
    const rows = (await dbAdmin.execute(
      sql`SELECT id::text AS id, clinic_id::text AS clinic_id
          FROM patients
          WHERE deleted_at IS NOT NULL AND deleted_at < now() - interval '30 days'
            AND anonymized_at IS NULL
          ORDER BY deleted_at ASC
          LIMIT ${limit}`,
    )) as unknown as Array<{ id: string; clinic_id: string }>;

    if (rows.length === 0) {
      await recordHeartbeat('patient-hard-delete', 'success', { deleted: 0, anonymized: 0, failed: 0 });
      return Response.json(
        { ok: true, deleted: 0, anonymized: 0, failed: 0, clinics: 0 },
        { status: 200 },
      );
    }

    // 2. Group ids by clinic.
    const byClinic = new Map<string, string[]>();
    for (const r of rows) {
      const arr = byClinic.get(r.clinic_id) ?? [];
      arr.push(r.id);
      byClinic.set(r.clinic_id, arr);
    }

    // 3. Anonymize PII in retained audit_events + cached idempotency responses
    //    (service layer; append-only RLS). Idempotente — roda antes do DELETE.
    await anonymizePatientAuditTrail(dbAdmin, rows.map((r) => r.id));

    // 4. Per-clinic, per-patient processing (RLS-scoped). F-02: uma clínica que
    //    falhe catastroficamente não aborta as seguintes.
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
        metrics.emit('patient.hard_delete.clinic_error', { clinicId, error: err });
      }
    }

    if (anonymized > 0) {
      // F-02: visibilidade do caminho RESTRICT→anonimização (ADR-017/ADR-021).
      metrics.emit('patient.hard_delete.blocked_by_clinical', { anonymized });
    }
    metrics.emit('patient.hard_delete.run', {
      deleted,
      anonymized,
      failed,
      clinics: byClinic.size,
    });
    await recordHeartbeat('patient-hard-delete', 'success', { deleted, anonymized, failed });
    return Response.json(
      { ok: true, deleted, anonymized, failed, clinics: byClinic.size },
      { status: 200 },
    );
  } catch (err) {
    metrics.emit('patient.hard_delete.error', { error: err });
    return Response.json({ ok: false, error: 'internal' }, { status: 500 });
  }
}
