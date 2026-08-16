/**
 * WAIT-001 consumer: vaga ofertada na lista de espera → mensagem ao paciente.
 *
 * Reage a `scheduling.waitlist.offered`. Este era o elo que faltava: o evento
 * existia, a UI já rotulava a entrada como "Oferta enviada", e nenhum handler
 * estava registrado — o worker marcava o evento como `skipped` e ninguém era
 * avisado de nada.
 *
 * Enfileira na fila C14 (lease, backoff, suppression, consentimento, dedup e
 * at-most-once no Meta já resolvidos) em vez de abrir um caminho paralelo de
 * envio. `scheduledFor = agora` porque a vaga é perecível; o `claimDue` ainda
 * aplica a janela 8-20h local, então um cancelamento de madrugada só vira
 * mensagem pela manhã — preferível a acordar o paciente.
 *
 * Idempotente em dupla defesa: UNIQUE(clinic_id, dedup_key) +
 * onConflictDoNothing. A chave inclui a VAGA além da entrada, porque o mesmo
 * paciente pode ser ofertado de novo por outro cancelamento e isso é uma oferta
 * nova, não uma reentrega.
 */
import { registerHandler } from '@/lib/outbox/registry';
import type { Tx } from '@/lib/db';

/* eslint-disable boundaries/element-types -- evento + tipo são o contrato PÚBLICO do Scheduling (mesma exceção dos demais handlers que consomem contratos de vizinhos). */
import { SCHEDULING_EVENTS, type WaitlistOfferedPayload } from '@/contexts/scheduling';
/* eslint-enable boundaries/element-types */

import type { WaitlistOfferPayload } from '../../domain/types';
import { insertJobTx } from '../../infra/repository';

async function enqueueWaitlistOffer(ctx: {
  tx: Tx;
  clinicId: string;
  payload: WaitlistOfferedPayload;
  eventId: string;
}): Promise<void> {
  const { tx, clinicId, payload } = ctx;

  const offer: WaitlistOfferPayload = {
    patientId: payload.patientId,
    waitlistEntryId: payload.waitlistEntryId,
    releasedAppointmentId: payload.releasedAppointmentId,
    scheduledAt: payload.scheduledAt,
    doctorNome: payload.doctorNome ?? null,
  };

  await insertJobTx(tx, {
    clinicId,
    type: 'waitlist_offer',
    scheduledFor: new Date(),
    payload: offer,
    dedupKey: `waitlist_offer:${payload.waitlistEntryId}:${payload.releasedAppointmentId}`,
  });
}

registerHandler<WaitlistOfferedPayload>(SCHEDULING_EVENTS.WAITLIST_OFFERED, enqueueWaitlistOffer);
