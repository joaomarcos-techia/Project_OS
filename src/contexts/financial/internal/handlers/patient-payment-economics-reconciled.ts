/**
 * Completa no Financial os fatos econômicos que o Asaas ainda não devolvia no
 * primeiro readback do pagamento. O crédito e a baixa já existem; este handler
 * apenas projeta taxa/líquido, registra a despesa real e libera eventual repasse
 * cuja base é líquida.
 */
import type { Tx } from '@/lib/db';
import { metrics } from '@/lib/observability/metrics';
import { PoisonPillError } from '@/lib/outbox/errors';
import { registerHandler } from '@/lib/outbox/registry';

/* eslint-disable boundaries/element-types -- contrato público do Payments. */
import {
  PAYMENTS_EVENTS,
  type PatientPaymentEconomicsReconciledPayload,
} from '@/contexts/payments';
/* eslint-enable boundaries/element-types */

import { reconcileCreditEconomics } from '../credit-store';
import { refreshProfessionalPayout } from '../professional-payout';
import { recordProviderExpense } from '../provider-expense';

async function applyPaymentEconomics(ctx: {
  tx: Tx;
  clinicId: string;
  payload: PatientPaymentEconomicsReconciledPayload;
}): Promise<void> {
  const { tx, clinicId, payload } = ctx;
  if (payload.clinicId !== clinicId) {
    throw new PoisonPillError(
      `clinicId divergente: payload=${payload.clinicId} ctx=${clinicId}`,
      'clinic_mismatch',
    );
  }

  const outcome = await reconcileCreditEconomics(tx, {
    clinicId,
    patientChargeId: payload.chargeId,
    providerGrossAmount: payload.providerGrossAmount,
    providerFeeAmount: payload.providerFeeAmount,
    providerNetAmount: payload.providerNetAmount,
    earlySettlementFeeAmount: payload.earlySettlementFeeAmount,
    paymentMethod: payload.paymentMethod,
    reconciledAt: new Date(payload.paidAt),
  });
  if (outcome === 'not_found') {
    // O evento do crédito original pode ainda estar aguardando no outbox. Uma
    // falha transitória preserva a entrega at-least-once em vez de perder fatos.
    throw new Error('[financial] crédito ausente ao conciliar economia do pagamento');
  }

  if (outcome === 'reconciled') {
    if (payload.providerFeeAmount !== null) {
      await recordProviderExpense(tx, {
        clinicId,
        patientChargeId: payload.chargeId,
        kind: 'payment_processing_fee',
        amount: payload.providerFeeAmount,
        occurredAt: new Date(payload.paidAt),
      });
    }
    if (payload.earlySettlementFeeAmount !== null) {
      await recordProviderExpense(tx, {
        clinicId,
        patientChargeId: payload.chargeId,
        kind: 'early_settlement_fee',
        amount: payload.earlySettlementFeeAmount,
        occurredAt: new Date(payload.paidAt),
      });
    }
    await refreshProfessionalPayout(tx, {
      clinicId,
      appointmentId: payload.appointmentId,
    });
  }

  metrics.emit('financial.patient_payment.economics_reconciled', {
    clinicId,
    appointmentId: payload.appointmentId,
    chargeId: payload.chargeId,
    outcome,
  });
}

registerHandler<PatientPaymentEconomicsReconciledPayload>(
  PAYMENTS_EVENTS.PAYMENT_ECONOMICS_RECONCILED,
  applyPaymentEconomics,
);
