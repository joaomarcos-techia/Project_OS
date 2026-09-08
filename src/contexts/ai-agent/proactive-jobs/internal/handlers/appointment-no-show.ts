/**
 * ADR-057 / 2.4B — falta registrada → recuperação operacional no próximo dia útil.
 *
 * Reutiliza a C14. O evento histórico sem `noShowAt` não gera contato retroativo;
 * somente transições novas possuem o instante autoritativo necessário.
 */
import type { Tx } from '@/lib/db';

/* eslint-disable boundaries/element-types -- tipo é o contrato público do Scheduling. */
import type { AppointmentNoShowPayload } from '@/contexts/scheduling';
/* eslint-enable boundaries/element-types */

import type { NoShowFollowupPayload } from '../../domain/types';
import { getClinicTimezoneTx, insertJobTx } from '../../infra/repository';
import { clinicLocalToUtc, localDateYMD, nextWeekday } from '../../infra/tz';

const NO_SHOW_FOLLOWUP_HOUR = 10;

export async function scheduleNoShowFollowup(ctx: {
  tx: Tx;
  clinicId: string;
  payload: AppointmentNoShowPayload;
  eventId: string;
}): Promise<void> {
  const { tx, clinicId, payload } = ctx;
  if (!payload.patientId || !payload.noShowAt || payload.toStatus !== 'faltou') return;

  const timezone = await getClinicTimezoneTx(tx, clinicId);
  const noShowDate = localDateYMD(timezone, new Date(payload.noShowAt));
  const scheduledFor = clinicLocalToUtc(timezone, nextWeekday(noShowDate), NO_SHOW_FOLLOWUP_HOUR);
  const jobPayload: NoShowFollowupPayload = {
    patientId: payload.patientId,
    appointmentId: payload.appointmentId,
    noShowAt: payload.noShowAt,
  };

  await insertJobTx(tx, {
    clinicId,
    type: 'no_show_followup',
    scheduledFor,
    payload: jobPayload,
    dedupKey: `no_show_followup:${payload.appointmentId}`,
  });
}
