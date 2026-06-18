/**
 * Billing consumer: scheduling.appointment.created → +1 em usage_metrics
 * (agendamentos). Idempotente via usage_counter_ledger (dedup = appointmentId):
 * a re-entrega at-least-once do worker NÃO duplica a contagem.
 *
 * NUNCA bloqueia (ADR-024) — é só metering. O gate (aviso) é síncrono via
 * billingApiV1.checkAndIncrementQuota no call-site de criação de agendamento.
 */
import type { Tx } from '@/lib/db';
import { registerHandler } from '@/lib/outbox/registry';

/* eslint-disable boundaries/element-types -- evento + tipo são contrato PÚBLICO do Scheduling. */
import { SCHEDULING_EVENTS, type AppointmentCreatedPayload } from '@/contexts/scheduling';
/* eslint-enable boundaries/element-types */

import { currentPeriod, recordUsage } from '../quota';
import { ledgerKeyFor } from '../quota-policy';

async function countAgendamento(ctx: {
  tx: Tx;
  clinicId: string;
  payload: AppointmentCreatedPayload;
}): Promise<void> {
  const { tx, clinicId, payload } = ctx;
  const key = ledgerKeyFor('agendamento', { appointmentId: payload.appointmentId });
  await recordUsage(tx, clinicId, key, currentPeriod());
}

registerHandler<AppointmentCreatedPayload>(SCHEDULING_EVENTS.CREATED, countAgendamento);
