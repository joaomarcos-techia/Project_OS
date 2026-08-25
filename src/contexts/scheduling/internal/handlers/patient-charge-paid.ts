/**
 * Scheduling consumer: sinal pago → confirma o agendamento (ADR-049 1.4).
 *
 * É o fecho do anti-no-show: quem pagou tem a vaga garantida, e a agenda passa a
 * mostrar `confirmado` sem ninguém precisar ligar para o paciente.
 *
 * **A máquina de estados continua congelada.** A confirmação passa por
 * `applyTransition` (`agendado → confirmado`), com lock, `assertTransition`, state
 * log e evento — nada de `UPDATE status` por fora.
 *
 * **O caso que exige cuidado é o pagamento de um agendamento que já não está
 * `agendado`.** Acontece de verdade: o paciente paga o link minutos depois de a
 * secretária cancelar, ou depois de o hold expirar. Aqui a regra é: registra que o
 * sinal foi pago (o dinheiro entrou mesmo) e **não força transição nenhuma** —
 * `confirmado` a partir de `cancelado` não é transição válida, e forçar seria
 * ressuscitar um horário que a clínica já deu para outra pessoa. O dinheiro pago
 * sobre agendamento morto é caso de estorno, que é a sub-fase 1.5; até lá, a
 * métrica é o que torna o caso visível em vez de silencioso.
 */
import { and, eq, sql } from 'drizzle-orm';

import type { Tx } from '@/lib/db';
import { metrics } from '@/lib/observability/metrics';
import { registerHandler } from '@/lib/outbox/registry';

/* eslint-disable boundaries/element-types -- evento + tipo são o contrato PÚBLICO do Payments (mesma exceção dos demais handlers que consomem contratos de vizinhos). */
import { PAYMENTS_EVENTS, type PatientChargePaidPayload } from '@/contexts/payments';
/* eslint-enable boundaries/element-types */

import { appointments } from '../../schema';
import { applyTransition } from '../appointment-core';

async function confirmPaidAppointment(ctx: {
  tx: Tx;
  clinicId: string;
  payload: PatientChargePaidPayload;
  eventId: string;
}): Promise<void> {
  const { tx, clinicId, payload } = ctx;
  // Só o sinal confirma. O restante (1.5) é cobrado depois do atendimento.
  if (payload.kind !== 'deposit') return;

  const [appointment] = await tx
    .select({ status: appointments.status })
    .from(appointments)
    .where(and(eq(appointments.id, payload.appointmentId), eq(appointments.clinicId, clinicId)))
    .limit(1);
  if (!appointment) return;

  // O sinal foi pago — isso é fato, independentemente do estado da agenda. O
  // `hold_expires_at` sai junto: o CHECK da 0085 exige prazo só em `pending`, e
  // deixá-lo faria a varredura de expiração olhar para quem já pagou.
  await tx
    .update(appointments)
    .set({ depositStatus: 'paid', holdExpiresAt: null, updatedAt: sql`now()` })
    .where(and(eq(appointments.id, payload.appointmentId), eq(appointments.clinicId, clinicId)));

  if (appointment.status !== 'agendado') {
    // Pagou depois de cancelar/expirar. Não ressuscita a vaga; deixa rastro.
    metrics.emit('scheduling.deposit.paid_on_inactive_appointment', {
      clinicId,
      appointmentId: payload.appointmentId,
      status: appointment.status,
    });
    return;
  }

  await applyTransition(tx, {
    clinicId,
    appointmentId: payload.appointmentId,
    target: 'confirmado',
    transitionedBy: null,
    actorType: 'system',
    reason: 'sinal pago',
    clientKey: `deposit-paid:${payload.chargeId}`,
    correlationId: ctx.eventId,
  });
}

registerHandler<PatientChargePaidPayload>(PAYMENTS_EVENTS.CHARGE_PAID, (ctx) =>
  confirmPaidAppointment({
    tx: ctx.tx,
    clinicId: ctx.clinicId,
    payload: ctx.payload,
    eventId: ctx.eventId,
  }),
);
