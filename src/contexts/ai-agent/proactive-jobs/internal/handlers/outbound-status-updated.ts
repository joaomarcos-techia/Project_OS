/**
 * EC-32 consumer: a Meta recusou a mensagem DEPOIS de aceitá-la → o job C14 falha.
 *
 * Reage a `messaging.outbound.status_updated`. O processor da C14 finaliza o job
 * como `sent` quando a Cloud API aceita o envio e devolve o wamid; a entrega é
 * decidida depois, e a recusa chega por callback. Em 08/10/2026 o template
 * `link_deposito` foi aceito e voltou `failed` 131042 (WABA sem moeda/pagamento
 * configurados): sem este consumidor o job ficava `sent` para sempre e nada
 * registrava que o paciente não recebeu o link do sinal.
 *
 * Ligação envio ↔ job: a C14 envia com `idempotencyKey = job.id`, chave estável
 * que `outbound_messages.idempotency_key` guarda. O handler lê essa chave pelo
 * seam do Messaging e procura o job com esse id NA CLÍNICA DO EVENTO — predicado
 * explícito, além da RLS do `withTenant` do worker. Envio que não é da C14
 * (resposta da IA, resposta manual) não tem job: no-op.
 *
 * Só `failed` move o job (motivo `meta_<código>`), e o repositório decide a
 * transição. Job ainda `processing` → retry pelo backoff do outbox: o processor
 * está entre o aceite e o `finalizeSent`. Job já terminal → no-op, o que torna a
 * reentrega at-least-once idempotente.
 *
 * Não reagenda, nem para código transitório: o reenvio cairia no dedup do
 * sender pela mesma chave e reencontraria o envio `failed`, sem nova mensagem.
 */
import { z } from 'zod';

import type { Tx } from '@/lib/db';
import { metrics } from '@/lib/observability/metrics';
import { HandlerError, PoisonPillError } from '@/lib/outbox/errors';
import { registerHandler } from '@/lib/outbox/registry';

/* eslint-disable boundaries/element-types -- evento + API interna são o contrato PÚBLICO do Messaging (mesma exceção dos handlers que consomem contratos de vizinhos). */
import {
  MESSAGING_EVENTS,
  messagingApiV1,
  type OutboundStatusUpdatedPayload,
} from '@/contexts/messaging';
/* eslint-enable boundaries/element-types */

import { markDeliveryFailedTx } from '../../infra/repository';

/** O id do job é uuid; chave de outro formato não é de job (e quebraria o cast). */
const jobIdSchema = z.string().uuid();

/** `failed_reason` da recusa: `meta_131042`; sem código, `meta_failed`. */
export function deliveryFailureReason(errorCode: string | undefined): string {
  return errorCode ? `meta_${errorCode}` : 'meta_failed';
}

async function failJobOnDeliveryFailure(ctx: {
  tx: Tx;
  clinicId: string;
  payload: OutboundStatusUpdatedPayload;
  eventId: string;
}): Promise<void> {
  const { tx, clinicId, payload, eventId } = ctx;
  if (payload.status !== 'failed') return;

  if (payload.clinicId !== clinicId) {
    throw new PoisonPillError(
      `outbound status: clinicId do payload (${payload.clinicId}) != tenant do evento (${clinicId})`,
      'clinic_mismatch',
    );
  }

  const sendKey = await messagingApiV1.getOutboundIdempotencyKey(
    tx,
    clinicId,
    payload.outboundMessageId,
  );
  if (!sendKey || !jobIdSchema.safeParse(sendKey).success) return;

  const reason = deliveryFailureReason(payload.errorCode);
  const outcome = await markDeliveryFailedTx(tx, clinicId, sendKey, reason);

  if (outcome.kind === 'in_flight') {
    throw new HandlerError(
      `proactive job ${sendKey} still processing; retry after finalize`,
      'proactive_job_in_flight',
    );
  }
  if (outcome.kind !== 'failed') return;

  metrics.emit('proactive.job.failed', {
    clinicId,
    jobId: sendKey,
    type: outcome.type,
    reason,
    // A recusa veio no callback da entrega, não na resposta do envio.
    stage: 'delivery',
    previousStatus: outcome.previousStatus,
    outboundMessageId: payload.outboundMessageId,
    eventId,
  });
}

registerHandler<OutboundStatusUpdatedPayload>(
  MESSAGING_EVENTS.OUTBOUND_STATUS_UPDATED,
  failJobOnDeliveryFailure,
);
