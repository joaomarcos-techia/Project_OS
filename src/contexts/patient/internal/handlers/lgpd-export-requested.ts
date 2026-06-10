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

// F-12 (auditoria 2026-06-10): os 3 round-trips a Storage rodam DENTRO da tx
// do worker (contrato de handler recebe só ctx.tx — split-TX real exigiria
// evoluir o contrato ADR-011). Mitigação: cada operação de rede é LIMITADA por
// timeout, então a tx nunca fica presa além de ~3×20s — muito abaixo da janela
// de 5min do janitor (que causaria reclaim + reentrega). Timeout → throw →
// retry com backoff (uploads são upsert idempotente por requestId).
const STORAGE_IO_TIMEOUT_MS = 20_000;

async function withIoTimeout<T>(p: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`[lgpd-export] ${label} excedeu ${STORAGE_IO_TIMEOUT_MS}ms`)),
      STORAGE_IO_TIMEOUT_MS,
    );
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

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

    // 3. Upload (path keyed by requestId → idempotent upsert). F-12: bounded
    //    por timeout — Storage lento não pode segurar a tx até o janitor.
    const base = `${clinicId}/${patientId}/${requestId}`;
    await withIoTimeout(
      uploadLgpdExport(`${base}.json`, jsonBytes, 'application/json'),
      'upload json',
    );
    await withIoTimeout(
      uploadLgpdExport(`${base}.pdf`, pdfBytes, 'application/pdf'),
      'upload pdf',
    );
    const signedUrl = await withIoTimeout(
      createSignedExportUrl(`${base}.pdf`, SIGNED_URL_TTL_SECONDS),
      'signed url',
    );

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
    // F-10: TTL real é 24h (constante acima) — o texto antigo dizia "7d".
    console.warn(
      `[lgpd-export] email send stubbed — signed URL (TTL 24h) ready for request ${requestId}`,
    );
  },
);
