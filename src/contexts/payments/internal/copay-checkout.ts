/**
 * Cobrança da COPARTICIPAÇÃO de convênio (P10.5): um caminho próprio, não a varredura
 * do saldo (que continua só para atendimento particular, P4.5).
 *
 * Quem decide o valor é o Convênios: só a coparticipação CONFIRMADA (`maxAmount`). Aqui
 * o valor cobrado é o saldo do recebível do atendimento (fonte: Financial), e ele
 * precisa ser ≤ ao confirmado — num atendimento de convênio o banco (0148) só deixa
 * existir o recebível da coparticipação, então o saldo nunca é o valor do atendimento.
 *
 * Mesma infraestrutura do restante (checkout hospedado do Asaas, intenção gravada antes
 * da chamada, geração recuperável, UNIQUE por atendimento): pedido repetido não cria
 * segunda cobrança. Nunca cobra sem conta Asaas ativa ou sem CPF do paciente.
 */
import { metrics } from '@/lib/observability/metrics';
import { getClinicAsaasClient } from '@/lib/payments/account-store';

/* eslint-disable boundaries/element-types -- `financialApiV1` e `patientApiV1` são as APIs internas públicas (M14), mesma exceção do `remainder-charge`. */
import { financialApiV1 } from '@/contexts/financial';
import { patientApiV1 } from '@/contexts/patient';
/* eslint-enable boundaries/element-types */

import { createInitialHostedCheckout } from './hosted-checkout';

const MIN_GATEWAY_AMOUNT = 5;
const COPAY_DUE_DAYS = 7;

export type CopayCheckoutOutcome =
  | 'created'
  | 'existing'
  | 'no_balance'
  | 'above_confirmed'
  | 'below_minimum'
  | 'no_account'
  | 'no_identity'
  | 'account_paused'
  | 'unsupported_condition'
  | 'window_too_short';

export async function createCopayCheckout(input: {
  clinicId: string;
  appointmentId: string;
  patientId: string;
  /** Coparticipação confirmada (reais): teto absoluto do que pode ser cobrado. */
  maxAmount: number;
}): Promise<{ outcome: CopayCheckoutOutcome; amount: number | null }> {
  const { clinicId, appointmentId, patientId } = input;
  const balance = await financialApiV1.getAppointmentBalance(clinicId, appointmentId);
  if (!balance || balance.saldo <= 0) return { outcome: 'no_balance', amount: null };
  // Centavos inteiros: nenhuma comparação de dinheiro em ponto flutuante.
  if (Math.round(balance.saldo * 100) > Math.round(input.maxAmount * 100)) {
    metrics.emit('insurance.copay.charge_above_confirmed_blocked', { clinicId, appointmentId });
    return { outcome: 'above_confirmed', amount: balance.saldo };
  }
  if (balance.saldo < MIN_GATEWAY_AMOUNT) return { outcome: 'below_minimum', amount: balance.saldo };
  const client = await getClinicAsaasClient(clinicId);
  if (!client) return { outcome: 'no_account', amount: null };
  if (!(await patientApiV1.getPaymentIdentity(clinicId, patientId))) return { outcome: 'no_identity', amount: null };
  const now = new Date();
  const outcome = await createInitialHostedCheckout({
    client,
    clinicId,
    appointmentId,
    patientId,
    kind: 'remainder',
    amount: balance.saldo,
    description: 'Coparticipação do convênio',
    holdExpiresAt: null,
    collectionExpiresAt: new Date(now.getTime() + COPAY_DUE_DAYS * 24 * 60 * 60 * 1000),
    now,
    paymentMethod: null,
    installmentCount: null,
  });
  metrics.emit('insurance.copay.charge_requested', { clinicId, appointmentId, outcome });
  return { outcome: outcome === 'created' ? 'created' : (outcome as CopayCheckoutOutcome), amount: balance.saldo };
}
