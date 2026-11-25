/**
 * P9.4 — pedido de envio do lote pelo webservice homologado da operadora.
 *
 * O pedido é persistido no outbox na mesma transação da auditoria, com a chave
 * `hi-batch-send:<lote>:v<versão>`: o mesmo lote na mesma versão gera UM envio, por mais cliques
 * que haja. A execução (handler `batch-send-requested.ts`) lê o XML guardado pela leitura auditada,
 * envia pelo conector SOAP (P6.5) e só então registra "enviado" (canal `connector`) e "recebido"
 * (protocolo) com o recibo da operadora, guardado cifrado. Sem homologação, o pedido é recusado.
 */
import 'server-only';

import { sql } from 'drizzle-orm';

import { logAudit } from '@/lib/audit/log';
import type { RequestContext } from '@/lib/audit/types';
import type { Tx } from '@/lib/db';
import { publishEvent } from '@/lib/outbox/publish';

import { HEALTH_INSURANCE_EVENTS } from '../events';
import { homologationRuntime, type HomologationRegistry } from './connectors/homologated-operators';
import { assertConveniosOperableTx } from './module-guard';

export const batchSendKey = (batchId: string, version: number) => `hi-batch-send:${batchId}:v${version}`;

export class BatchConnectorSendError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BatchConnectorSendError';
  }
}

interface BatchRow {
  status: string;
  version: number;
  insurer_id: string;
  registro_ans: string;
  has_credential: boolean;
}

async function loadBatch(tx: Tx, clinicId: string, batchId: string): Promise<BatchRow | null> {
  const [b] = (await tx.execute(sql`
    SELECT b.status, b.version, b.insurer_id::text AS insurer_id, i.registro_ans,
           EXISTS (SELECT 1 FROM public.hi_insurer_credentials c
                    WHERE c.clinic_id = b.clinic_id AND c.insurer_id = b.insurer_id
                      AND c.kind = 'webservice_login' AND c.status = 'active') AS has_credential
      FROM public.hi_batches b
      JOIN public.hi_insurers i ON i.clinic_id = b.clinic_id AND i.id = b.insurer_id
     WHERE b.clinic_id = ${clinicId}::uuid AND b.id = ${batchId}::uuid`)) as unknown as BatchRow[];
  return b ?? null;
}

/** A tela oferece o envio eletrônico? Só com operadora homologada e credencial ativa da clínica. */
export async function connectorSendAvailableTx(
  tx: Tx,
  clinicId: string,
  batchId: string,
  registry: HomologationRegistry = homologationRuntime.registry(),
): Promise<boolean> {
  if (registry.size === 0) return false;
  const b = await loadBatch(tx, clinicId, batchId);
  return Boolean(b && b.status === 'exported' && b.has_credential && registry.has(b.registro_ans));
}

export async function requestBatchConnectorSendTx(
  tx: Tx,
  a: {
    clinicId: string;
    batchId: string;
    version: number;
    userId: string;
    requestContext: RequestContext;
    registry?: HomologationRegistry;
  },
): Promise<{ key: string }> {
  // D24 + módulo ligado: enviar é operação nova (o banco confere de novo ao registrar o envio).
  await assertConveniosOperableTx(tx, a.clinicId);
  const registry = a.registry ?? homologationRuntime.registry();
  const b = await loadBatch(tx, a.clinicId, a.batchId);
  if (!b) throw new BatchConnectorSendError('Lote não encontrado nesta clínica.');
  if (b.status !== 'exported') throw new BatchConnectorSendError('Só um lote exportado, ainda não enviado, sai pelo webservice.');
  if (Number(b.version) !== a.version) throw new BatchConnectorSendError('O lote mudou desde que a tela foi aberta; recarregue.');
  if (!registry.has(b.registro_ans)) {
    throw new BatchConnectorSendError('Esta operadora não tem webservice homologado no Qoro: envie pelo portal e registre o envio.');
  }
  if (!b.has_credential) throw new BatchConnectorSendError('Cadastre a credencial do webservice desta operadora antes de enviar.');
  const key = batchSendKey(a.batchId, a.version);
  await publishEvent(tx, {
    clinicId: a.clinicId,
    eventType: HEALTH_INSURANCE_EVENTS.BATCH_SEND_REQUESTED,
    payload: { clinicId: a.clinicId, batchId: a.batchId, version: a.version, requestedBy: a.userId },
    idempotencyKey: key,
  });
  await logAudit(tx, {
    clinicId: a.clinicId,
    userId: a.userId,
    action: 'health_insurance.batch.connector_send_requested',
    resourceType: 'hi_batch',
    resourceId: a.batchId,
    before: null,
    after: { version: a.version, registroANS: b.registro_ans },
    requestContext: a.requestContext,
  });
  return { key };
}
