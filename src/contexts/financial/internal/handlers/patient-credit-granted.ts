/**
 * Financial consumer: entrou dinheiro do paciente → registra o crédito
 * (ADR-051 1.5b.1).
 *
 * Reage a `payments.patient_credit.granted`, e **não** a
 * `payments.patient_charge.paid`: aquele já tem dono (o Scheduling, que confirma
 * a vaga) e o registry é 1 handler por evento. A razão de fundo, porém, é melhor
 * que a restrição — os dois fatos significam coisas diferentes para domínios
 * diferentes: para a agenda, *confirme a vaga*; para o financeiro, *entrou
 * dinheiro que precisa ser alocado*.
 *
 * **Não cria lançamento.** Criar o recebível de R$ 200 quando o sinal de R$ 100
 * é pago inventaria uma obrigação por um atendimento que ainda não aconteceu — e
 * teria de ser desfeita em falta e cancelamento. O lançamento nasce no
 * `appointment.completed`, pelo valor BRUTO, e é lá que o crédito é aplicado
 * (invariante 3 do ADR-051).
 *
 * Idempotente por constraint: `UNIQUE (clinic_id, patient_charge_id)`.
 */
import type { Tx } from '@/lib/db';
import { metrics } from '@/lib/observability/metrics';
import { PoisonPillError } from '@/lib/outbox/errors';
import { registerHandler } from '@/lib/outbox/registry';

/* eslint-disable boundaries/element-types -- evento + tipo são o contrato PÚBLICO do Payments (mesma exceção dos demais handlers que consomem contratos de vizinhos). */
import { PAYMENTS_EVENTS, type PatientCreditGrantedPayload } from '@/contexts/payments';
/* eslint-enable boundaries/element-types */

import { grantCredit } from '../credit-store';

async function registerCredit(ctx: {
  tx: Tx;
  clinicId: string;
  payload: PatientCreditGrantedPayload;
  eventId: string;
}): Promise<void> {
  const { tx, clinicId, payload } = ctx;

  // Defesa: clinicId do payload tem de bater com o contexto RLS do worker.
  // Mesma guarda do `faturarAtendimento` — aqui vale ainda mais, porque o que
  // está em jogo é dinheiro entrando na conta de uma clínica.
  if (payload.clinicId !== clinicId) {
    throw new PoisonPillError(
      `clinicId divergente: payload=${payload.clinicId} ctx=${clinicId}`,
      'clinic_mismatch',
    );
  }

  const created = await grantCredit(tx, {
    clinicId,
    patientChargeId: payload.chargeId,
    appointmentId: payload.appointmentId,
    patientId: payload.patientId,
    amount: payload.amount,
    kind: payload.kind,
    paymentMethod: payload.paymentMethod,
    grantedAt: new Date(payload.paidAt),
  });

  metrics.emit('financial.patient_credit.granted', {
    clinicId,
    appointmentId: payload.appointmentId,
    chargeId: payload.chargeId,
    amount: payload.amount,
    // `false` = outra entrega chegou primeiro. Sucesso, não erro.
    created,
  });
}

registerHandler<PatientCreditGrantedPayload>(PAYMENTS_EVENTS.CREDIT_GRANTED, registerCredit);
