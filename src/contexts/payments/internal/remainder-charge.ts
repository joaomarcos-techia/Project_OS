/**
 * Caso de uso: atendimento concluído → cobra o SALDO restante (ADR-051 1.5b.3).
 *
 * **O saldo vem do Financial, nunca de conta própria.** Poderíamos subtrair do
 * valor do procedimento o que este context já recebeu — e estaríamos errados no
 * dia (frequente) em que o paciente paga o restante em dinheiro na recepção e a
 * secretária lança no Caixa. Esse pagamento não existe do lado do gateway, e
 * cobrar por cima dele mandaria ao paciente um link por algo que ele já pagou.
 * `financialApiV1.getAppointmentBalance` é a fonte da verdade (ADR-051 D1).
 *
 * **O caminho normal é NÃO COBRAR.** Sai por cima, sem erro e sem evento, quando:
 * política desligada · já existe cobrança de restante · não há recebível em
 * aberto · saldo zero ou negativo · saldo abaixo do mínimo do gateway · clínica
 * sem conta Asaas · paciente sem CPF válido.
 *
 * **Ownership (R3):** não escreve `appointments` nem `lancamentos`. Grava a
 * cobrança e publica; quem dá baixa no recebível é o Financial, reagindo a
 * `payments.patient_credit.granted` quando o paciente pagar.
 */
import { PoisonPillError } from '@/lib/outbox/errors';
import { metrics } from '@/lib/observability/metrics';
import { BillingProviderError } from '@/lib/payments/asaas';
import { getClinicAsaasClient } from '@/lib/payments/account-store';

/* eslint-disable boundaries/element-types -- `financialApiV1` e `patientApiV1` são as APIs internas públicas (M14), mesma exceção do `deposit-charge` e dos demais consumidores de contrato de vizinho. */
import { financialApiV1 } from '@/contexts/financial';
import { patientApiV1 } from '@/contexts/patient';
/* eslint-enable boundaries/element-types */

import type { PatientChargeFailedPayload } from '../events';
import { getDepositPolicy } from '../queries';
import { findChargeByAppointment } from './charge-store';
import { createInitialHostedCheckout } from './hosted-checkout';

/**
 * Mesmo mínimo do sinal (verificado ao vivo em 2026-08-24). Um saldo de R$ 3,00
 * seria recusado pelo gateway e viraria erro a cada varredura; não cobrar é o
 * mesmo desfecho, sem o ruído — e a clínica recebe na recepção.
 */
const MIN_GATEWAY_AMOUNT = 5;

/** Prazo do link do restante. Diferente do sinal: aqui não há vaga a segurar. */
const REMAINDER_DUE_DAYS = 7;

export interface RemainderChargeInput {
  appointmentId: string;
  patientId: string | null;
  /** Valor cheio do procedimento — só para observabilidade; o saldo manda. */
  valor: number;
}

/**
 * Cobra o saldo restante do atendimento, se houver. Idempotente por construção:
 * pode ser chamada de novo com o mesmo agendamento sem cobrar duas vezes.
 */
export async function createRemainderCharge(ctx: {
  clinicId: string;
  appointment: RemainderChargeInput;
}): Promise<void> {
  const { clinicId, appointment } = ctx;
  const { appointmentId, patientId } = appointment;

  if (!patientId) return;

  // A política de sinal é o gate da clínica inteira (D1): quem não usa sinal não
  // passa a receber link de cobrança por ter concluído um atendimento.
  const policy = await getDepositPolicy(clinicId);
  if (!policy.enabled) return;

  // Idempotência barata ANTES de qualquer chamada externa. A garantia mesmo é o
  // UNIQUE (appointment_id, kind) no insert.
  if (await findChargeByAppointment(clinicId, appointmentId, 'remainder')) return;

  const balance = await financialApiV1.getAppointmentBalance(clinicId, appointmentId);
  if (!balance) {
    // Sem recebível em aberto: ou não foi faturado ainda, ou já está quitado.
    // Não cobrar é o modo de falha seguro.
    metrics.emit('payments.remainder.skipped_no_balance', { clinicId, appointmentId });
    return;
  }
  if (balance.saldo <= 0) return;

  if (balance.saldo < MIN_GATEWAY_AMOUNT) {
    metrics.emit('payments.remainder.skipped_below_minimum', {
      clinicId,
      appointmentId,
      saldo: balance.saldo,
    });
    return;
  }

  const client = await getClinicAsaasClient(clinicId);
  if (!client) {
    metrics.emit('payments.remainder.skipped_no_account', { clinicId, appointmentId });
    return;
  }

  if (!(await patientApiV1.getPaymentIdentity(clinicId, patientId))) {
    metrics.emit('payments.remainder.skipped_no_identity', { clinicId, appointmentId });
    return;
  }

  const now = new Date();
  const collectionExpiresAt = new Date(now.getTime() + REMAINDER_DUE_DAYS * 24 * 60 * 60 * 1000);

  try {
    const outcome = await createInitialHostedCheckout({
      client,
      clinicId,
      appointmentId,
      patientId,
      kind: 'remainder',
      amount: balance.saldo,
      description: 'Restante do atendimento',
      holdExpiresAt: null,
      collectionExpiresAt,
      now,
    });

    if (outcome === 'created') {
      metrics.emit('payments.remainder.created', {
        clinicId,
        appointmentId,
        amount: balance.saldo,
      });
    }
  } catch (err) {
    if (err instanceof BillingProviderError) {
      const failure: PatientChargeFailedPayload = {
        clinicId,
        appointmentId,
        kind: 'remainder',
        amount: balance.saldo,
        failureCode: err.providerErrorCodes[0] ?? 'billing_provider_error',
      };
      metrics.emit('payments.remainder.failed', failure);
      throw new PoisonPillError(
        `restante recusado pelo gateway para o agendamento ${appointmentId}`,
        'remainder_rejected',
      );
    }
    throw err;
  }
}
