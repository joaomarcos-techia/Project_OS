/**
 * Patient hard-delete (C5, PlanoAção §5.6.5).
 *
 * Per-clinic delete of patients whose 30-day soft-delete window has elapsed.
 * Runs via withTenant (RLS-scoped) — the cross-tenant SCAN that finds expired
 * ids lives in the cron route (which may use dbAdmin); this function only
 * deletes ids it is handed, scoped to one clinic.
 *
 * FK ON DELETE CASCADE removes patient_consents / patient_clinical_data /
 * patient_addresses / patient_emergency_contacts. suppression_list has NO FK to
 * patients, so it SURVIVES (a deleted patient's number must stay un-messageable).
 *
 * Audit anonymization is NOT done here: audit_events is append-only under FORCE
 * RLS (no UPDATE policy for the authenticated role). The cron route handles it
 * via dbAdmin. See ADR-012 (audit-retention-on-hard-delete decision).
 */
import { inArray } from 'drizzle-orm';

import { withTenant } from '@/lib/db/tenant';

import { patients } from '../schema';

export async function hardDeletePatients(clinicId: string, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  return withTenant(clinicId, async (tx) => {
    const deleted = await tx
      .delete(patients)
      .where(inArray(patients.id, ids))
      .returning({ id: patients.id });
    return deleted.length;
  });
}
