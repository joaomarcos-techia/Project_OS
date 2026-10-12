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
 * é pago inventaria uma obrigação por um atendimento que ainda não aconteceu.
 * Se o recebível já existe — caso normal do pagamento do restante — aplica o
 * crédito nele na mesma TX; caso contrário, deixa `available` para o handler de
 * `appointment.completed` consumir depois (ADR-051 D4).
 *
 * Idempotente por constraint: `UNIQUE (clinic_id, patient_charge_id)`.
 */
import type { Tx } from '@/lib/db';
import { metrics } from '@/lib/observability/metrics';
import { PoisonPillError } from '@/lib/outbox/errors';
import { publishEvent } from '@/lib/outbox/publish';
import { registerHandler } from '@/lib/outbox/registry';

/* eslint-disable boundaries/element-types -- evento + tipo são o contrato PÚBLICO do Payments (mesma exceção dos demais handlers que consomem contratos de vizinhos). */
import { PAYMENTS_EVENTS, type PatientCreditGrantedPayload } from '@/contexts/payments';
/* eslint-enable boundaries/element-types */

import { applyCreditToExistingReceivable } from '../credit-allocation';
import { grantCredit } from '../credit-store';
import { recordProviderExpense } from '../provider-expense';
import { refreshProfessionalPayout } from '../professional-payout';
import { EXCESS_REFUND_PENDING_REASON } from '../patient-credit-adjustment';
import { FINANCIAL_EVENTS } from '../../events';
import { faturamentoPendencias } from '../../schema';

type LegacyCreditGrantedPayload = Omit<
  PatientCreditGrantedPayload,
  | 'providerGrossAmount'
  | 'providerFeeAmount'
  | 'providerNetAmount'
  | 'earlySettlementFeeAmount'
  | 'installmentNumber'
>;

async function registerCredit(ctx: {
  tx: Tx;
  clinicId: string;
  payload: PatientCreditGrantedPayload | LegacyCreditGrantedPayload;
  eventId: string;
}): Promise<void> {
  const { tx, clinicId, payload, eventId } = ctx;

  // Defesa: clinicId do payload tem de bater com o contexto RLS do worker.
  // Mesma guarda do `faturarAtendimento` — aqui vale ainda mais, porque o que
  // está em jogo é dinheiro entrando na conta de uma clínica.
  if (payload.clinicId !== clinicId) {
    throw new PoisonPillError(
      `clinicId divergente: payload=${payload.clinicId} ctx=${clinicId}`,
      'clinic_mismatch',
    );
  }

  const economics = 'providerGrossAmount' in payload ? payload : null;
  const creditId = await grantCredit(tx, {
    clinicId,
    patientChargeId: payload.chargeId,
    appointmentId: payload.appointmentId,
    patientId: payload.patientId,
    amount: payload.amount,
    providerGrossAmount: economics?.providerGrossAmount ?? null,
    providerFeeAmount: economics?.providerFeeAmount ?? null,
    providerNetAmount: economics?.providerNetAmount ?? null,
    earlySettlementFeeAmount: economics?.earlySettlementFeeAmount ?? null,
    kind: payload.kind,
    paymentMethod: payload.paymentMethod,
    grantedAt: new Date(payload.paidAt),
  });

  if (economics?.providerFeeAmount != null) {
    await recordProviderExpense(tx, {
      clinicId,
      patientChargeId: payload.chargeId,
      kind: 'payment_processing_fee',
      amount: economics.providerFeeAmount,
      occurredAt: new Date(payload.paidAt),
    });
  }
  if (economics?.earlySettlementFeeAmount != null) {
    await recordProviderExpense(tx, {
      clinicId,
      patientChargeId: payload.chargeId,
      kind: 'early_settlement_fee',
      amount: economics.earlySettlementFeeAmount,
      occurredAt: new Date(payload.paidAt),
    });
  }

  const allocation = creditId
    ? await applyCreditToExistingReceivable(tx, {
        clinicId,
        appointmentId: payload.appointmentId,
        creditId,
        patientChargeId: payload.chargeId,
        amount: payload.amount,
        paymentMethod: payload.paymentMethod,
        paidAt: new Date(payload.paidAt),
        correlationId: eventId,
      })
    : null;

  if (allocation?.outcome === 'applied' && allocation.status === 'pago') {
    await refreshProfessionalPayout(tx, {
      clinicId,
      appointmentId: payload.appointmentId,
    });
  }

  if (allocation?.outcome === 'applied' && allocation.unappliedAmount > 0) {
    await tx
      .insert(faturamentoPendencias)
      .values({
        clinicId,
        appointmentId: payload.appointmentId,
        motivo: EXCESS_REFUND_PENDING_REASON,
        valor: allocation.unappliedAmount.toFixed(2),
        status: 'aberta',
      })
      .onConflictDoUpdate({
        target: faturamentoPendencias.appointmentId,
        set: {
          motivo: EXCESS_REFUND_PENDING_REASON,
          valor: allocation.unappliedAmount.toFixed(2),
          status: 'aberta',
          resolvedAt: null,
          resolvedBy: null,
        },
      });

    await publishEvent(tx, {
      clinicId,
      eventType: FINANCIAL_EVENTS.EXCESS_REFUND_REQUESTED,
      payload: {
        clinicId,
        appointmentId: payload.appointmentId,
        chargeId: payload.chargeId,
        amount: allocation.unappliedAmount,
        requestedAt: payload.paidAt,
      },
      idempotencyKey: `excess-refund-requested:${payload.chargeId}`,
      correlationId: eventId,
    });
  }

  metrics.emit('financial.patient_credit.granted', {
    clinicId,
    appointmentId: payload.appointmentId,
    chargeId: payload.chargeId,
    amount: payload.amount,
    // `false` = outra entrega chegou primeiro. Sucesso, não erro.
    created: creditId !== null,
    allocation: allocation?.outcome ?? 'duplicate',
    ...(allocation?.outcome === 'deferred' ? { reason: allocation.reason } : {}),
    ...(allocation?.outcome === 'applied'
      ? {
          appliedAmount: allocation.appliedAmount,
          unappliedAmount: allocation.unappliedAmount,
        }
      : {}),
  });
}

registerHandler<PatientCreditGrantedPayload | LegacyCreditGrantedPayload>(
  PAYMENTS_EVENTS.CREDIT_GRANTED,
  registerCredit,
);
