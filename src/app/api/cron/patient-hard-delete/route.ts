/**
 * GET /api/cron/patient-hard-delete
 *
 * Daily job (vercel.json crons[]). Hard-deletes patients whose 30-day
 * soft-delete window elapsed (PlanoAção §5.6.5). Cross-tenant scan uses dbAdmin
 * (BYPASSRLS) to FIND expired ids; the actual DELETE is per-clinic via
 * withTenant (RLS-scoped) in the patient context. FK CASCADE removes child
 * rows; suppression_list survives (no FK).
 *
 * Auth mirrors /api/cron/outbox (Bearer CRON_SECRET + x-vercel-cron, with
 * OUTBOX_CRON_ALLOW_NON_VERCEL / non-prod escape hatch for smoke).
 *
 * LIMIT bounds the batch so a large backlog cannot slam the DB (5.7 checklist).
 *
 * Audit (ADR-012 decision): audit_events are RETAINED for forensic/legal
 * integrity, but the erased patient's PII (nome/email) is stripped from the
 * before/after JSON via dbAdmin — append-only RLS blocks the authenticated role
 * from doing this, so it is done here at the service layer.
 */
import { sql } from 'drizzle-orm';

import { hardDeletePatients } from '@/contexts/patient/internal/hard-delete';
import { dbAdmin } from '@/lib/db';
import { env, assertCronRuntimeReady } from '@/lib/env';
import { metrics } from '@/lib/observability/metrics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1000;

function isAuthorized(req: Request): boolean {
  if (req.headers.get('authorization') !== `Bearer ${env.CRON_SECRET}`) return false;
  const isVercelCron = req.headers.get('x-vercel-cron') !== null;
  const allowNonVercel =
    process.env.OUTBOX_CRON_ALLOW_NON_VERCEL === 'true' || env.NODE_ENV !== 'production';
  return isVercelCron || allowNonVercel;
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
    // 1. Cross-tenant scan: expired soft-deletes (oldest first).
    const rows = (await dbAdmin.execute(
      sql`SELECT id::text AS id, clinic_id::text AS clinic_id
          FROM patients
          WHERE deleted_at IS NOT NULL AND deleted_at < now() - interval '30 days'
          ORDER BY deleted_at ASC
          LIMIT ${limit}`,
    )) as unknown as Array<{ id: string; clinic_id: string }>;

    if (rows.length === 0) {
      return Response.json({ ok: true, deleted: 0, clinics: 0 }, { status: 200 });
    }

    // 2. Group ids by clinic.
    const byClinic = new Map<string, string[]>();
    for (const r of rows) {
      const arr = byClinic.get(r.clinic_id) ?? [];
      arr.push(r.id);
      byClinic.set(r.clinic_id, arr);
    }

    // 3. Anonymize PII in retained audit_events (service layer; append-only RLS).
    const allIds = rows.map((r) => r.id);
    await dbAdmin.execute(
      sql`UPDATE audit_events
          SET before = (before - 'nome' - 'email'),
              after  = (after  - 'nome' - 'email')
          WHERE resource_type = 'patient' AND resource_id = ANY(${allIds}::text[])`,
    );

    // 4. Per-clinic hard delete (RLS-scoped, FK cascade).
    let deleted = 0;
    for (const [clinicId, ids] of byClinic) {
      deleted += await hardDeletePatients(clinicId, ids);
    }

    metrics.emit('patient.hard_delete.run', { deleted, clinics: byClinic.size });
    return Response.json({ ok: true, deleted, clinics: byClinic.size }, { status: 200 });
  } catch (err) {
    metrics.emit('patient.hard_delete.error', { error: err });
    return Response.json({ ok: false, error: 'internal' }, { status: 500 });
  }
}
