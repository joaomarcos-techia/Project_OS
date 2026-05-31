/**
 * Handler: patient.lgpd.export_requested (C5).
 *
 * Runs in the outbox worker's withTenant tx (RLS-scoped to clinicId). Assembles
 * the export from all registered PatientExportProvider collectors, renders JSON
 * + PDF, uploads to Supabase Storage, writes a 7-day signed URL onto the
 * lgpd_requests row, and (stub) emails the patient.
 *
 * Cross-tenant safety: collectors read via ctx.tx (RLS) and decrypt with
 * clinicId — another clinic's data is unreadable and undecryptable (5.6.6).
 *
 * Idempotent (at-least-once): storage path is keyed by requestId (upsert), and
 * the lgpd_requests UPDATE is naturally idempotent.
 */
import { and, eq, sql } from 'drizzle-orm';

import { metrics } from '@/lib/observability/metrics';
import { registerHandler } from '@/lib/outbox/registry';
import { createSignedExportUrl, uploadLgpdExport } from '@/lib/storage/exports';

import { PATIENT_EVENTS, type LgpdExportRequestedPayload } from '../../events';
import { lgpdRequests } from '../../schema';
import { renderExportPdf } from '../export/pdf';
import { getExportCollectors } from '../export/provider';

// F-07: reduzido de 7 dias → 24h. Export de PII completo é egresso sensível; a
// janela menor reduz o risco de uma URL bearer vazada (ver F-19: sem revogação
// self-service ainda — runbook descreve revogação manual via delete do objeto).
const SIGNED_URL_TTL_SECONDS = 24 * 60 * 60;

registerHandler<LgpdExportRequestedPayload>(
  PATIENT_EVENTS.LGPD_EXPORT_REQUESTED,
  async ({ tx, clinicId, payload }) => {
    const { requestId, patientId } = payload;

    // 1. Assemble every registered export section within the same RLS tx.
    const sections: Record<string, unknown> = {};
    for (const [key, collect] of getExportCollectors()) {
      sections[key] = await collect(tx, clinicId, patientId);
    }
    const exportedAt = new Date().toISOString();
    const doc = { requestId, patientId, clinicId, exportedAt, sections };

    // 2. Render artifacts (pure).
    const pdfBytes = await renderExportPdf(doc);
    const jsonBytes = Buffer.from(JSON.stringify(doc, null, 2), 'utf8');

    // 3. Upload (path keyed by requestId → idempotent upsert).
    const base = `${clinicId}/${patientId}/${requestId}`;
    await uploadLgpdExport(`${base}.json`, jsonBytes, 'application/json');
    await uploadLgpdExport(`${base}.pdf`, pdfBytes, 'application/pdf');
    const signedUrl = await createSignedExportUrl(`${base}.pdf`, SIGNED_URL_TTL_SECONDS);

    // 4. Persist result on the request row (RLS-scoped via ctx.tx).
    await tx
      .update(lgpdRequests)
      .set({
        status: 'completed',
        fulfilledAt: sql`now()`,
        exportSignedUrl: signedUrl,
        exportSignedUrlExpiresAt: sql`now() + interval '24 hours'`,
      })
      .where(and(eq(lgpdRequests.id, requestId), eq(lgpdRequests.clinicId, clinicId)));

    // 5. Email — STUBBED until transactional email infra lands (later camada).
    metrics.emit('patient.lgpd.export.completed', { clinicId, requestId });
    console.warn(
      `[lgpd-export] email send stubbed — signed URL (TTL 7d) ready for request ${requestId}`,
    );
  },
);
