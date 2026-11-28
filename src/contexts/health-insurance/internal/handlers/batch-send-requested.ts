/**
 * P9.4 — envio do lote pelo webservice HOMOLOGADO da operadora (handler DESTACADO do outbox: a
 * chamada de rede fica fora de qualquer transação).
 *
 * Ordem e garantias:
 *  1. o pedido é da clínica do evento; o lote ainda está EXPORTADO e na MESMA versão (senão o
 *     pedido caduca sem enviar nada);
 *  2. a operadora do lote tem homologação (`homologated-operators.ts`; em produção, nenhuma);
 *  3. o XML é o arquivo guardado na exportação, lido pela leitura AUDITADA (SHA-256 conferido),
 *     em nome de quem pediu;
 *  4. a credencial da clínica é decifrada só pelo conector, na hora (P12.5);
 *  5. "enviado" (canal `connector`) e "recebido" (protocolo) só são registrados com o RECIBO da
 *     operadora conferido (XSD, hash, origem, lote) — e o recibo fica guardado cifrado;
 *  6. NUNCA reenvia sozinho: se esta não for a primeira tentativa (o processo caiu no meio) e a
 *     operadora não declarou deduplicação, o envio pode ter chegado e o job termina pedindo
 *     conferência no portal. Indisponibilidade do conector também não é repetida.
 *
 * Resultado para a tela: o próprio job no outbox (processado, ou falho com o código).
 */
import { createHash, randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';

import { logAudit } from '@/lib/audit/log';
import { encryptForTenant } from '@/lib/crypto/encryption';
import type { Tx } from '@/lib/db';
import { withTenant } from '@/lib/db/tenant';
import { metrics } from '@/lib/observability/metrics';
import { PoisonPillError } from '@/lib/outbox/errors';
import { registerDetachedHandler } from '@/lib/outbox/registry';
import { premiumAccessErrorFrom } from '@/lib/premium-access';
import { supabaseTissObjectStore, type TissObjectStore } from '@/lib/storage/tiss-files';

import { HEALTH_INSURANCE_EVENTS, type BatchSendRequestedPayload } from '../../events';
import { hiFiles } from '../../schema-clinic';
import { TISS_SUPPORTED_VERSION } from '../../tiss/validation/batch-validator';
import { getTissWsXsdEngine, type TissXsdEngine } from '../../tiss/xml/xsd-engine';
import { markBatchSentInTx, recordBatchProtocolInTx } from '../batch-service';
import { homologationRuntime, type HomologationRegistry } from '../connectors/homologated-operators';
import { resolveOperatorConnector } from '../connectors/resolve-connector';
import { readWebserviceCredentialForSendTx } from '../connectors/tiss-soap/credential';
import { createTissSoapTransport, type TissSoapDeps } from '../connectors/tiss-soap/tiss-soap-adapter';
import { TissSoapRequestError } from '../connectors/tiss-soap/ws-message';
import { assertConveniosOperableTx, ConveniosModuleDisabledError } from '../module-guard';
import { readBatchXmlInTx } from '../tiss-file-access';

export const BATCH_SEND_SERVICE = 'insurance-batch-connector';

export interface BatchSendDeps {
  store: TissObjectStore;
  registry: HomologationRegistry;
  xsd: () => TissXsdEngine;
  /** Só os testes: transporte HTTP do conector (padrão: o POST com política de destino). */
  post?: TissSoapDeps['post'];
}

export type BatchSendOutcome = 'sent' | 'stale';

/** Dependências do job; o app usa o padrão, só os harnesses substituem. */
export const batchSendRuntime: { deps: () => BatchSendDeps } = {
  deps: () => ({ store: supabaseTissObjectStore(), registry: homologationRuntime.registry(), xsd: getTissWsXsdEngine }),
};

const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const todayInBrazil = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

export async function handleBatchSendRequested(
  ctx: { clinicId: string; payload: BatchSendRequestedPayload; eventId: string; attempt: number },
  deps: BatchSendDeps,
): Promise<BatchSendOutcome> {
  const { clinicId, payload, eventId } = ctx;
  if (payload.clinicId !== clinicId) {
    throw new PoisonPillError(`clinicId divergente: payload=${payload.clinicId} ctx=${clinicId}`, 'clinic_mismatch');
  }
  const requestContext = { ip: null, userAgent: `delegated:${BATCH_SEND_SERVICE}`, requestId: eventId, correlationId: eventId };
  const audit = (action: string, after: Record<string, unknown>) =>
    withTenant(
      clinicId,
      (tx) => logAudit(tx, { clinicId, userId: payload.requestedBy, action, resourceType: 'hi_batch', resourceId: payload.batchId, before: null, after, requestContext }),
      payload.requestedBy,
    );

  let batch: { status: string; version: number; insurer_id: string; registro_ans: string } | undefined;
  try {
    [batch] = (await withTenant(
      clinicId,
      async (tx) => {
        await assertConveniosOperableTx(tx, clinicId);
        return tx.execute(sql`SELECT b.status, b.version, b.insurer_id::text AS insurer_id, i.registro_ans
            FROM public.hi_batches b JOIN public.hi_insurers i ON i.clinic_id = b.clinic_id AND i.id = b.insurer_id
           WHERE b.clinic_id = ${clinicId}::uuid AND b.id = ${payload.batchId}::uuid`);
      },
      payload.requestedBy,
    )) as unknown as Array<{ status: string; version: number; insurer_id: string; registro_ans: string }>;
  } catch (e) {
    if (premiumAccessErrorFrom(e)) throw new PoisonPillError('assinatura inativa: o envio do lote foi bloqueado', 'premium_denied');
    if (e instanceof ConveniosModuleDisabledError) throw new PoisonPillError('módulo Convênios desligado: o envio do lote foi bloqueado', 'module_disabled');
    throw e;
  }
  if (!batch) throw new PoisonPillError('lote inexistente nesta clínica', 'batch_not_found');
  if (batch.status !== 'exported' || Number(batch.version) !== payload.version) {
    metrics.emit('insurance.batch.connector_send', { outcome: 'stale' });
    return 'stale';
  }
  const homologation = deps.registry.get(batch.registro_ans);
  if (!homologation) throw new PoisonPillError('operadora sem webservice homologado', 'not_homologated');
  if (ctx.attempt > 1 && !homologation.soap.deduplicatesSubmissions) {
    // A tentativa anterior pode ter chegado à operadora: reenviar sozinho duplicaria o lote.
    await audit('health_insurance.batch.connector_unconfirmed', { attempt: ctx.attempt });
    metrics.emit('insurance.batch.connector_send', { outcome: 'needs_portal_check' });
    throw new PoisonPillError('envio pode ter chegado à operadora: confira no portal antes de reenviar', 'needs_portal_check');
  }

  const xml = await withTenant(
    clinicId,
    (tx) => readBatchXmlInTx(tx, deps.store, { clinicId, batchId: payload.batchId, userId: payload.requestedBy, requestContext, purpose: 'envio_conector' }),
    payload.requestedBy,
  );
  if (!xml) throw new PoisonPillError('o lote não tem XML guardado', 'xml_missing');

  const insurerId = batch.insurer_id;
  const transport = createTissSoapTransport(
    { ...homologation.soap, id: `tiss-soap:${homologation.registroANS}`, insurerId, registroANS: homologation.registroANS },
    {
      credentials: () => withTenant(clinicId, (tx: Tx) => readWebserviceCredentialForSendTx(tx, clinicId, insurerId)),
      xsd: deps.xsd(),
      ...(deps.post ? { post: deps.post } : {}),
    },
  );
  const connector = resolveOperatorConnector({ insurerId, registry: new Map([[insurerId, transport]]), hasActiveCredential: true });
  let result;
  try {
    result = await connector.perform({
      operation: 'submit_batch',
      insurerId,
      subjectId: payload.batchId,
      xml: xml.bytes,
      idempotencyKey: `hi-batch-send:${payload.batchId}:v${payload.version}`,
    });
  } catch (e) {
    if (e instanceof TissSoapRequestError) throw new PoisonPillError(`o pedido não pôde ser montado: ${e.code}`, `request_${e.code.toLowerCase()}`);
    throw e;
  }

  if (result.kind === 'manual') {
    await audit('health_insurance.batch.connector_unavailable', { reason: result.reason });
    metrics.emit('insurance.batch.connector_send', { outcome: 'unavailable' });
    throw new PoisonPillError('o webservice da operadora não confirmou o envio: confira no portal', 'connector_unavailable');
  }
  const outcome = result.outcome;
  if (outcome.kind === 'rejected') {
    await audit('health_insurance.batch.connector_rejected', { code: outcome.code });
    metrics.emit('insurance.batch.connector_send', { outcome: 'rejected' });
    throw new PoisonPillError(`a operadora recusou o lote (código ${outcome.code})`, `operator_rejected`);
  }
  const receipt = outcome.receipt;
  if (!receipt) throw new PoisonPillError('a operadora aceitou sem recibo conferível', 'receipt_missing');

  // Recibo guardado cifrado ANTES de registrar o envio; se a transação não confirmar, o objeto sai.
  const fileId = randomUUID();
  const ref = `${clinicId}/${fileId}`;
  const ciphertext = Buffer.from(await encryptForTenant(clinicId, Buffer.from(receipt.xml).toString('base64')), 'utf8');
  await deps.store.put(ref, ciphertext);
  try {
    await withTenant(
      clinicId,
      async (tx) => {
        await tx.insert(hiFiles).values({
          id: fileId, clinicId, kind: 'batch_return', batchId: payload.batchId, storageRef: ref, contentSha256: receipt.sha256,
          ciphertextSha256: sha256(ciphertext), sizeBytes: receipt.xml.length, mediaType: 'application/xml',
          tissVersion: TISS_SUPPORTED_VERSION, createdVia: 'automation', createdBy: null,
        });
        const today = todayInBrazil();
        const sentVersion = await markBatchSentInTx(tx, {
          clinicId, batchId: payload.batchId, version: payload.version, channel: 'connector', sentOn: today,
          evidence: `Webservice da operadora: protocolo ${outcome.protocol}; recibo SHA-256 ${receipt.sha256.slice(0, 16)}`,
        });
        await recordBatchProtocolInTx(tx, {
          clinicId, batchId: payload.batchId, version: sentVersion, protocol: outcome.protocol, receivedOn: today,
          evidenceSha256: receipt.sha256, note: 'recibo do webservice (P6.5/P9.4)',
        });
        await logAudit(tx, {
          clinicId, userId: payload.requestedBy, action: 'health_insurance.batch.sent_via_connector', resourceType: 'hi_batch',
          resourceId: payload.batchId, before: null, after: { protocol: outcome.protocol, receiptSha256: receipt.sha256, receiptFileId: fileId }, requestContext,
        });
      },
      payload.requestedBy,
    );
  } catch (e) {
    await deps.store.remove(ref).catch(() => metrics.emit('insurance.file.orphan', { kind: 'batch_return' }));
    // O recibo existe na operadora: não reenviar; a conferência é humana.
    if (premiumAccessErrorFrom(e)) throw new PoisonPillError('assinatura inativa ao registrar o envio', 'premium_denied');
    throw new PoisonPillError('a operadora confirmou, mas o registro do envio falhou: registre pelo recibo', 'record_failed');
  }
  metrics.emit('insurance.batch.connector_send', { outcome: 'sent' });
  return 'sent';
}

registerDetachedHandler<BatchSendRequestedPayload>(HEALTH_INSURANCE_EVENTS.BATCH_SEND_REQUESTED, async (ctx) => {
  await handleBatchSendRequested(ctx, batchSendRuntime.deps());
});
