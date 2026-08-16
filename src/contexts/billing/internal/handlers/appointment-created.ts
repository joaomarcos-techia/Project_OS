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

  // DATA-009 — carga HISTÓRICA não é operação corrente.
  //
  // O pentest importou três consultas de 2001 e o worker normal criou três
  // linhas de ledger no período `2026-08`, levando `usage_metrics` de 37 para
  // 40. A métrica passou a descrever o mês da IMPORTAÇÃO, não a operação da
  // clínica — e um lote pode ter até 500 itens.
  //
  // O evento continua sendo publicado (proveniência, state logs e o lote são
  // trilha legítima); só não é METRÁVEL. Usar `createdVia` em vez de comparar
  // `scheduledAt` com "hoje" é o critério certo: uma consulta remarcada para o
  // passado por correção continua sendo operação corrente, e um import de
  // datas futuras continua sendo import.
  if (payload.createdVia === 'import') return;

  const key = ledgerKeyFor('agendamento', { appointmentId: payload.appointmentId });
  await recordUsage(tx, clinicId, key, currentPeriod());
}

registerHandler<AppointmentCreatedPayload>(SCHEDULING_EVENTS.CREATED, countAgendamento);
