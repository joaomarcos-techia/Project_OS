/**
 * R45 — exportação do lote em segundo plano (handler DESTACADO do outbox: o arquivo vai
 * para o armazenamento e a transação do lote é própria, com compensação do objeto).
 *
 * Ordem e garantias:
 *  1. o pedido é da clínica do evento (senão, falha sem nova tentativa);
 *  2. o lote ainda está como foi pedido (preparado e na MESMA versão). Se mudou
 *     (cancelado, guia trocada) ou já foi exportado, o pedido caduca sem gerar nada;
 *  3. as guias são lidas pela leitura DELEGADA (`readBatchGuidesDelegated`): só as do
 *     lote, em nome de quem pediu, com a permissão dessa pessoa conferida AGORA;
 *  4. a exportação existente gera o XML, valida (regras, TUSS, XSD oficial, hash,
 *     codificação), cifra e grava. Ela é idempotente: o mesmo lote nunca gera dois
 *     arquivos faturáveis (o segundo pedido recebe `already_exported`).
 *
 * Falhas: de regra, de conteúdo, de autorização e o bloqueio comercial (D24) viram
 * PoisonPill com código (sem nova tentativa; o lote continua preparado). Indisponível
 * (validador, armazenamento, rede) é transitório: o outbox tenta de novo com backoff.
 */
import { sql } from 'drizzle-orm';

import { withTenant } from '@/lib/db/tenant';
import { metrics } from '@/lib/observability/metrics';
import { PoisonPillError } from '@/lib/outbox/errors';
import { registerDetachedHandler } from '@/lib/outbox/registry';
import { premiumAccessErrorFrom } from '@/lib/premium-access';
import { supabaseTissObjectStore, type TissObjectStore } from '@/lib/storage/tiss-files';

import { HEALTH_INSURANCE_EVENTS, type BatchExportRequestedPayload } from '../../events';
import { loadXmllintValidator } from '../../tiss/xml/xsd-validator';
import { BatchExportError, exportBatch, type BatchDeps } from '../batch-service';
import { GuideAccessError, GuideIntegrityError, readBatchGuidesDelegated } from '../guide-access';

export const BATCH_EXPORT_SERVICE = 'insurance-batch-export';

export interface BatchExportDeps {
  store: TissObjectStore;
  validateXsd: BatchDeps['validateXsd'];
}

export type BatchExportJobOutcome = 'exported' | 'already_exported' | 'stale';

/**
 * Dependências do job: armazenamento privado e o validador XSD oficial. Substituível só
 * pelos harnesses (Postgres descartável, armazenamento em memória); o app usa o padrão.
 */
export const batchExportRuntime: { deps: () => BatchExportDeps } = {
  deps: () => ({ store: supabaseTissObjectStore(), validateXsd: loadXmllintValidator() }),
};

export async function handleBatchExportRequested(
  ctx: { clinicId: string; payload: BatchExportRequestedPayload; eventId: string },
  deps: BatchExportDeps,
): Promise<BatchExportJobOutcome> {
  const { clinicId, payload, eventId } = ctx;
  if (payload.clinicId !== clinicId) {
    throw new PoisonPillError(`clinicId divergente: payload=${payload.clinicId} ctx=${clinicId}`, 'clinic_mismatch');
  }
  const [batch] = (await withTenant(
    clinicId,
    (tx) =>
      tx.execute(
        sql`SELECT status, version FROM public.hi_batches WHERE clinic_id = ${clinicId}::uuid AND id = ${payload.batchId}::uuid`,
      ),
    payload.requestedBy,
  )) as unknown as Array<{ status: string; version: number }>;
  if (!batch) throw new PoisonPillError('lote inexistente nesta clínica', 'batch_not_found');
  if (batch.status !== 'prepared') {
    metrics.emit('insurance.batch.async_export', { outcome: batch.status === 'cancelled' ? 'stale' : 'already_exported' });
    return batch.status === 'cancelled' ? 'stale' : 'already_exported';
  }
  if (Number(batch.version) !== payload.version) {
    metrics.emit('insurance.batch.async_export', { outcome: 'stale' });
    return 'stale';
  }

  let reads;
  try {
    reads = await readBatchGuidesDelegated({
      clinicId,
      batchId: payload.batchId,
      requestedBy: payload.requestedBy,
      service: BATCH_EXPORT_SERVICE,
      jobId: eventId,
    });
  } catch (e) {
    if (e instanceof GuideAccessError) throw new PoisonPillError(`leitura delegada negada: ${e.reason}`, `access_${e.reason}`);
    if (e instanceof GuideIntegrityError) throw new PoisonPillError('conteúdo emitido não confere com o SHA-256 gravado', 'integrity');
    throw e;
  }

  try {
    const out = await exportBatch(
      { store: deps.store, validateXsd: deps.validateXsd },
      {
        clinicId,
        batchId: payload.batchId,
        contents: reads.map((r) => ({ guideId: r.guideId, revision: r.revision, content: r.content })),
        actorUserId: payload.requestedBy,
        requestContext: { ip: null, userAgent: `delegated:${BATCH_EXPORT_SERVICE}`, requestId: eventId, correlationId: eventId },
      },
    );
    metrics.emit('insurance.batch.async_export', { outcome: out.kind });
    return out.kind;
  } catch (e) {
    if (premiumAccessErrorFrom(e)) throw new PoisonPillError('assinatura inativa: a exportação do lote foi bloqueada', 'premium_denied');
    if (e instanceof BatchExportError) {
      if (e.layer === 'unavailable') throw e; // validador fora: tenta de novo
      throw new PoisonPillError(`exportação recusada (${e.layer}): ${e.message}`, `export_${e.layer}`);
    }
    throw e; // armazenamento/rede: transitório
  }
}

registerDetachedHandler<BatchExportRequestedPayload>(HEALTH_INSURANCE_EVENTS.BATCH_EXPORT_REQUESTED, async (ctx) => {
  await handleBatchExportRequested(ctx, batchExportRuntime.deps());
});
