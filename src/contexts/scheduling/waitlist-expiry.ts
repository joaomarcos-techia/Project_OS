/**
 * WAIT-001 — expiração de ofertas da lista de espera (read-model PRIVILEGIADO).
 *
 * O Scheduling é dono da regra de "quando uma oferta caducou", pela mesma razão
 * de `reminder-candidates.ts`: é conhecimento de agenda, não de transporte. O
 * SCAN é cross-tenant via `dbAdmin` (BYPASSRLS) — um passo por todas as clínicas,
 * mesma justificativa dos crons financeiros — e devolve APENAS ids, sem PII.
 *
 * A ESCRITA não usa dbAdmin: cada liberação roda em `withTenant`, sob RLS, com o
 * `clinic_id` que veio do scan. O privilégio serve para descobrir o trabalho, não
 * para executá-lo.
 *
 * Idempotente: `releaseWaitlistOffer` só age sobre `status='offered'`, então uma
 * segunda passada do cron sobre a mesma linha não repassa a vaga duas vezes.
 *
 * A janela corre só nas horas de envio (ADR-066), pela mesma regra que o seam
 * entrega à C14: a oferta feita de noite é convidada às 8h e vence no meio da
 * manhã, em vez de ser repassada antes de o convite poder sair.
 */
import 'server-only';

import { dbAdmin } from '@/lib/db';
import { withTenant } from '@/lib/db/tenant';
import { metrics } from '@/lib/observability/metrics';

import { findStaleWaitlistOffers, releaseWaitlistOffer } from './internal/waitlist-store';

export interface WaitlistExpirySummary {
  /** Ofertas vencidas encontradas no scan. */
  expiredScanned: number;
  /** Ofertas efetivamente devolvidas à fila. */
  expiredReleased: number;
  /** Repasses bem-sucedidos para um próximo candidato. */
  expiredReoffered: number;
}

export async function expireStaleWaitlistOffers(input: {
  limit: number;
}): Promise<WaitlistExpirySummary> {
  const now = new Date();
  const stale = await dbAdmin.transaction((tx) =>
    findStaleWaitlistOffers(tx, { now, limit: input.limit }),
  );
  const summary: WaitlistExpirySummary = {
    expiredScanned: stale.length,
    expiredReleased: 0,
    expiredReoffered: 0,
  };

  for (const entry of stale) {
    try {
      const result = await withTenant(entry.clinicId, (tx) =>
        releaseWaitlistOffer(tx, {
          clinicId: entry.clinicId,
          entryId: entry.id,
          // Estável por (entrada, expiração): a reentrega do mesmo repasse é
          // deduplicada pelo outbox em vez de virar uma segunda oferta.
          idempotencyKey: `waitlist-expire:${entry.id}`,
          correlationId: null,
        }),
      );
      if (result.released) summary.expiredReleased += 1;
      if (result.nextEntryId) summary.expiredReoffered += 1;
    } catch (error) {
      // Uma clínica com dado inconsistente não pode travar a fila das outras.
      metrics.emit('waitlist.offer.expire_error', { clinicId: entry.clinicId, error });
    }
  }
  return summary;
}
