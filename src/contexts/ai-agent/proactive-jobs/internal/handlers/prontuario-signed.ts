/**
 * C14 consumer: prontuário assinado com needs_return → agenda FOLLOWUP.
 *
 * Reage a `clinical.prontuario.signed`. Cria 1 job followup agendado p/
 * (return_date − 2 dias) às 18h LOCAL da clínica (ADR-2: dias-calendário no tz).
 * Idempotente em dupla defesa: UNIQUE(clinic_id, dedup_key='followup:{prontId}')
 * + onConflictDoNothing (re-entrega at-least-once não duplica).
 *
 * No-op quando needs_return=false ou returnDays ausente (sem data de retorno).
 * O envio (suppression/consent/template) é do cron/processor — aqui só agenda.
 */
import type { Tx } from '@/lib/db';
import { registerHandler } from '@/lib/outbox/registry';

/* eslint-disable boundaries/element-types -- evento + tipo são o contrato PÚBLICO do Clinical (mesma exceção dos handlers que consomem contratos de vizinhos). */
import { CLINICAL_EVENTS, type ProntuarioSignedPayload } from '@/contexts/clinical';
/* eslint-enable boundaries/element-types */

import type { FollowupPayload } from '../../domain/types';
import { getClinicTimezoneTx, insertJobTx } from '../../infra/repository';
import { addCalendarDays, clinicLocalToUtc, localDateYMD } from '../../infra/tz';

const FOLLOWUP_HOUR = 18;

async function scheduleFollowup(ctx: {
  tx: Tx;
  clinicId: string;
  payload: ProntuarioSignedPayload;
  eventId: string;
}): Promise<void> {
  const { tx, clinicId, payload } = ctx;
  if (!payload.needsReturn || payload.returnDays == null) return; // sem retorno: no-op

  const tz = await getClinicTimezoneTx(tx, clinicId);
  // return_date = data local da assinatura + returnDays (dias-calendário).
  const signedLocal = localDateYMD(tz, new Date(payload.signedAt));
  const returnDate = addCalendarDays(signedLocal, payload.returnDays);
  // Dispara 2 dias antes do retorno, às 18h local → instante UTC.
  const scheduledFor = clinicLocalToUtc(tz, addCalendarDays(returnDate, -2), FOLLOWUP_HOUR);

  const followup: FollowupPayload = {
    patientId: payload.patientId,
    prontuarioId: payload.prontuarioId,
    doctorNome: payload.signedDoctorNome,
    returnDate,
  };

  await insertJobTx(tx, {
    clinicId,
    type: 'followup',
    scheduledFor,
    payload: followup,
    dedupKey: `followup:${payload.prontuarioId}`,
  });
}

registerHandler<ProntuarioSignedPayload>(CLINICAL_EVENTS.PRONTUARIO_SIGNED, scheduleFollowup);
