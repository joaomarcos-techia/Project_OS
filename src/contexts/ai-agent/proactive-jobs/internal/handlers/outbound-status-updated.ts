/**
 * EC-32 consumer: a Meta recusou a mensagem DEPOIS de aceitá-la → o job C14
 * reenvia ou falha (ADR-064).
 *
 * Reage a `messaging.outbound.status_updated`. O processor da C14 finaliza o job
 * como `sent` quando a Cloud API aceita o envio e devolve o wamid; a entrega é
 * decidida depois, e a recusa chega por callback. Em 08/10/2026 o template
 * `link_deposito` foi aceito e voltou `failed` 131042 (WABA sem moeda/pagamento
 * configurados): sem este consumidor o job ficava `sent` para sempre e nada
 * registrava que o paciente não recebeu o link do sinal.
 *
 * Ligação envio ↔ job: a C14 envia com a chave da GERAÇÃO (`send_key`, ou o
 * job.id na geração 0), que `outbound_messages.idempotency_key` guarda. O
 * handler lê essa chave pelo seam do Messaging e trava o job cuja geração ATUAL
 * a usou, NA CLÍNICA DO EVENTO — predicado explícito, além da RLS do
 * `withTenant` do worker. Envio que não é da C14 (resposta da IA, resposta
 * manual) ou de uma geração já substituída não acha job: no-op.
 *
 * Só `failed` move o job. A decisão é a mesma do processor (`decideAfterRefusal`):
 *   - código retentável, dentro das tentativas e do prazo do tipo → `pending`
 *     com chave NOVA e backoff: o reenvio é de verdade, porque a Meta disse que
 *     esta geração não foi entregue;
 *   - o resto → `failed`, com `meta_<código>`.
 * Job `processing` com lease vivo → retry pelo backoff do outbox: o processor
 * está entre o aceite e o `finalizeSent`. Com lease vencido, a tentativa morreu
 * e o handler decide por ela — senão o evento poderia esgotar as tentativas
 * durante a madrugada, fora da janela de envio. Job já terminal → no-op, o que
 * torna a reentrega at-least-once idempotente.
 */
import { randomUUID } from 'node:crypto';

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

import { resendDeadline } from '../../application/resend-deadline';
import { decideAfterRefusal, refusalReason, type RefusalDecision } from '../../domain/resend';
import { PROACTIVE_PAYLOAD_SCHEMAS } from '../../domain/types';
import {
  getClinicTimezoneTx,
  lockJobBySendKeyTx,
  settleRefusedJobTx,
  type RefusedJob,
} from '../../infra/repository';

/** A chave de envio da C14 é uuid; chave de outro formato não é de job (e quebraria o cast). */
const sendKeySchema = z.string().uuid();

function decide(
  job: RefusedJob,
  errorCode: string | undefined,
  timezone: string,
): RefusalDecision | { kind: 'fail'; why: 'invalid_payload' } {
  // O prazo do tipo sai do payload: sem payload válido não há como saber se o
  // reenvio ainda serve, e a recusa fecha o job.
  const parsed = PROACTIVE_PAYLOAD_SCHEMAS[job.type].safeParse(job.payload);
  if (!parsed.success) return { kind: 'fail', why: 'invalid_payload' };
  return decideAfterRefusal({
    attempts: job.attempts,
    code: errorCode,
    deadline: resendDeadline(job.type, parsed.data, timezone),
    now: new Date(),
  });
}

async function settleDeliveryRefusal(ctx: {
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
  if (!sendKey || !sendKeySchema.safeParse(sendKey).success) return;

  const job = await lockJobBySendKeyTx(tx, clinicId, sendKey);
  if (!job || job.status === 'failed' || job.status === 'cancelled') return;
  if (job.status === 'processing' && !job.leaseExpired) {
    throw new HandlerError(
      `proactive job ${job.id} still processing; retry after finalize`,
      'proactive_job_in_flight',
    );
  }

  const reason = refusalReason(payload.errorCode);
  const decision = decide(job, payload.errorCode, await getClinicTimezoneTx(tx, clinicId));
  const log = {
    clinicId,
    jobId: job.id,
    type: job.type,
    reason,
    // A recusa veio no callback da entrega, não na resposta do envio.
    stage: 'delivery',
    previousStatus: job.status,
    outboundMessageId: payload.outboundMessageId,
    eventId,
  };

  if (decision.kind === 'resend') {
    await settleRefusedJobTx(tx, clinicId, job, {
      status: 'pending',
      reason,
      nextAt: decision.nextAt,
      sendKey: randomUUID(),
    });
    metrics.emit('proactive.job.retried', { ...log, delayMs: decision.delayMs, resend: true });
    return;
  }

  await settleRefusedJobTx(tx, clinicId, job, { status: 'failed', reason });
  metrics.emit('proactive.job.failed', { ...log, why: decision.why });
}

registerHandler<OutboundStatusUpdatedPayload>(
  MESSAGING_EVENTS.OUTBOUND_STATUS_UPDATED,
  settleDeliveryRefusal,
);
