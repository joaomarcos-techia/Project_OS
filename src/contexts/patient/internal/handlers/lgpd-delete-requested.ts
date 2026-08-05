/**
 * Handler: patient.lgpd.delete_requested (C5).
 *
 * The Server Action already soft-deletes + suppresses synchronously; this
 * handler is the at-least-once safety net (idempotent) ensuring the patient is
 * soft-deleted and their contacts suppressed even if the event is the only
 * record that survived. The actual hard-delete (cascade) happens 30 days later
 * via the patient-hard-delete cron — never here.
 *
 * Runs in the worker's withTenant tx (RLS-scoped). Uses ctx.tx only.
 */
import { eq, sql } from 'drizzle-orm';

import { hashForLookup, normalizeEmail } from '@/lib/crypto';
import { registerHandler } from '@/lib/outbox/registry';

import { PATIENT_EVENTS, type LgpdDeleteRequestedPayload } from '../../events';
import { lgpdRequests, patients, suppressionList } from '../../schema';

registerHandler<LgpdDeleteRequestedPayload>(
  PATIENT_EVENTS.LGPD_DELETE_REQUESTED,
  async ({ tx, clinicId, payload }) => {
    const { patientId, requestId } = payload;

    await tx
      .update(lgpdRequests)
      .set({
        status: 'processing',
        startedAt: sql`coalesce(started_at, now())`,
        statusReason: 'soft_deleted_waiting_retention',
      })
      .where(eq(lgpdRequests.id, requestId));

    const [row] = await tx
      .update(patients)
      .set({ deletedAt: sql`coalesce(deleted_at, now())` })
      .where(eq(patients.id, patientId))
      .returning({ telefoneHash: patients.telefoneHash, email: patients.email });
    if (!row) return; // already hard-deleted — nothing to do (idempotent)

    const supp: {
      clinicId: string;
      contactHash: string;
      channel: 'whatsapp' | 'email' | 'sms';
      reason: string;
    }[] = [];
    if (row.telefoneHash) {
      supp.push({
        clinicId,
        contactHash: row.telefoneHash,
        channel: 'whatsapp',
        reason: 'lgpd_delete',
      });
      supp.push({ clinicId, contactHash: row.telefoneHash, channel: 'sms', reason: 'lgpd_delete' });
    }
    // C12: paciente criado pelo agente pode não ter e-mail — só suprime se houver.
    if (row.email) {
      supp.push({
        clinicId,
        contactHash: await hashForLookup(normalizeEmail(row.email)),
        channel: 'email',
        reason: 'lgpd_delete',
      });
    }
    for (const s of supp) {
      await tx.insert(suppressionList).values(s).onConflictDoNothing();
    }
  },
);
