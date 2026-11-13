/**
 * Depois de um pagamento do paciente confirmado pelo webhook (status lido do Asaas, nunca
 * do corpo), processa LOGO os eventos que `markDepositPaid` publicou para ESTA cobrança e
 * põe a coparticipação de convênio, se houver, na situação do dinheiro:
 *
 *   payments.patient_charge.paid      (agenda: confirma a vaga)
 *   payments.patient_credit.granted   (financeiro: aplica o crédito no recebível → baixa)
 *   financial.lancamento.paid         (pagamentos: fecha o link do restante)
 *   coparticipação cobrada → paga     (convênio, pela função do banco; idempotente)
 *
 * Roda depois da resposta (o Asaas recebe o 200 sem esperar). O cron do outbox e o
 * `financial-reconcile` continuam sendo a garantia; no Preview/DEV, sem cron, é isto que
 * faz a baixa acontecer sem ninguém acionar nada (R49). Uma reentrega do mesmo pagamento
 * (`already_paid`) agenda de novo: as linhas já processadas não voltam a rodar e o que
 * tinha ficado para trás é retomado.
 */
import 'server-only';

import { FINANCIAL_EVENTS } from '@/contexts/financial';
import { syncCopayForAppointment } from '@/contexts/health-insurance';
import { PAYMENTS_EVENTS } from '@/contexts/payments';
import { findPaidChargeByProviderPayment } from '@/contexts/payments/internal/charge-store';
import { metrics } from '@/lib/observability/metrics';

import { runAfterResponse, runOutboxSelectionsNow } from '@/app/api/cron/outbox/process-soon';

export interface SettlementOutcome {
  processed: number;
  failed: number;
  copay: string;
}

/** O passo em si (exportado para a prova em banco descartável com o worker real). */
export async function settleChargeNow(clinicId: string, providerPaymentId: string): Promise<SettlementOutcome | null> {
  const charge = await findPaidChargeByProviderPayment(clinicId, providerPaymentId);
  if (!charge) return null;
  const summary = await runOutboxSelectionsNow([
    { eventType: PAYMENTS_EVENTS.CHARGE_PAID, idempotencyKeys: [`charge-paid:${charge.chargeId}`] },
    { eventType: PAYMENTS_EVENTS.CREDIT_GRANTED, idempotencyKeys: [`credit-granted:${charge.chargeId}`] },
    { eventType: FINANCIAL_EVENTS.LANCAMENTO_PAID, idempotencyKeys: [`patient-credit-applied:${charge.chargeId}`] },
  ]);
  const copay = await syncCopayForAppointment(clinicId, charge.appointmentId);
  const outcome = {
    processed: summary.processed,
    failed: summary.failed,
    copay: copay ? `${copay.before}->${copay.after}` : 'none',
  };
  metrics.emit('payments.webhook.settlement_follow_up', { clinicId, ...outcome });
  return outcome;
}

export function scheduleSettlementFollowUp(clinicId: string, providerPaymentId: string): void {
  runAfterResponse('payments.webhook.settlement', async () => {
    await settleChargeNow(clinicId, providerPaymentId);
  });
}
