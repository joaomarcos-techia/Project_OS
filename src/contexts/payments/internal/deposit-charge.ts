/**
 * Caso de uso: agendamento criado → cobra o sinal (ADR-049 1.3 + ADR-050).
 *
 * Gatilhos: varredura periódica para agendamentos elegíveis e evento próprio
 * `scheduling.appointment.deposit_requested` para antecipar os criados pela IA.
 * Ambos usam este caso de uso e seu claim idempotente; o evento de criação
 * continua reservado ao metering do Billing.
 *
 * **Transações curtas, efeito externo primeiro:** criar a cobrança envolve duas
 * chamadas HTTP ao Asaas. Segurar transação aberta durante chamada externa prende
 * conexão do pool pelo tempo do gateway; e dar rollback DEPOIS de o Asaas já ter
 * criado a cobrança deixaria dinheiro cobrado sem registro local.
 *
 * **Assíncrono, nunca dentro do request de agendar:** marcar consulta não pode
 * depender do gateway. Asaas lento ou fora do ar não pode travar a secretária.
 *
 * **Ownership (regra R3, a mesma do Financial):** este handler NÃO escreve
 * `appointments`. Ele publica `payments.patient_charge.created`; quem marca o hold
 * e quem move a máquina de estados é o Scheduling.
 *
 * **O caminho normal é NÃO COBRAR.** Sai por cima, sem erro e sem evento, quando:
 * não há paciente · política desligada · tipo de consulta fora do escopo · valor
 * que não gera sinal · **sinal abaixo do mínimo do gateway** · clínica sem conta
 * Asaas · paciente sem CPF válido. Cobrar é a exceção configurada, não o default.
 */
import { PoisonPillError } from '@/lib/outbox/errors';
import { metrics } from '@/lib/observability/metrics';
import { BillingProviderError } from '@/lib/payments/asaas';
import { getClinicAsaasClient } from '@/lib/payments/account-store';

/* eslint-disable boundaries/element-types -- evento + tipo são o contrato PÚBLICO do Scheduling, e `schedulingApiV1`/`patientApiV1` são as APIs internas públicas (M14) — mesma exceção dos demais handlers que consomem contratos de vizinhos. */
import { schedulingApiV1 } from '@/contexts/scheduling';
import { patientApiV1 } from '@/contexts/patient';
/* eslint-enable boundaries/element-types */

import type { PatientChargeFailedPayload } from '../events';
import { resolveDepositAmount } from '../policy';
import { getDepositPolicy } from '../queries';
import { findChargeByAppointment } from './charge-store';
import { createInitialHostedCheckout, resolveCheckoutWindow } from './hosted-checkout';
import { MIN_GATEWAY_AMOUNT, resolveHoldExpiry } from './deposit-rules';

export { resolveHoldExpiry } from './deposit-rules';

/**
 * O que a cobrança precisa saber do agendamento — e nada além. Um tipo próprio
 * (em vez do payload do evento de agendamento) porque o gatilho é um scan, e
 * porque quanto menor a entrada, menor o acoplamento com a agenda.
 */
export interface DepositChargeInput {
  appointmentId: string;
  patientId: string | null;
  /** Valor cheio do procedimento. */
  valor: number;
  /** Instante da consulta (ISO). */
  scheduledAt: string;
  commercialPaymentMethod?: 'pix' | 'cash' | 'credit_card' | null;
  commercialInstallmentCount?: number | null;
}

/**
 * Cobra o sinal do agendamento, se a política mandar. Idempotente por construção:
 * pode ser chamada de novo com o mesmo agendamento sem cobrar duas vezes.
 */
export async function createDepositCharge(ctx: {
  clinicId: string;
  appointment: DepositChargeInput;
}): Promise<void> {
  const { clinicId, appointment: payload } = ctx;
  const { appointmentId, patientId } = payload;

  // Agendamento sem paciente (encaixe/walk-in) não tem a quem cobrar.
  if (!patientId) return;
  // Dinheiro é recebido e baixado manualmente no Caixa; nunca cria Checkout.
  if (payload.commercialPaymentMethod === 'cash') return;

  const policy = await getDepositPolicy(clinicId);
  if (!policy.enabled) return;

  // Idempotência barata ANTES de qualquer chamada externa. A garantia mesmo é o
  // UNIQUE no insert — isto só evita gastar um POST à toa numa reentrega.
  if (await findChargeByAppointment(clinicId, appointmentId)) return;

  // Agendamento pendente, cancelado ou falta não transforma a próxima em retorno.
  const isReturn = await schedulingApiV1.hasPriorCompletedAppointment(
    clinicId,
    patientId,
    new Date(payload.scheduledAt),
  );
  const amount = resolveDepositAmount({ policy, basePrice: payload.valor, isReturn });
  if (amount === null) return;

  if (amount < MIN_GATEWAY_AMOUNT) {
    metrics.emit('payments.deposit.skipped_below_minimum', { clinicId, appointmentId, amount });
    return;
  }

  const now = new Date();
  const scheduledAt = new Date(payload.scheduledAt);
  const holdExpiresAt = resolveHoldExpiry(now, scheduledAt);
  if (!resolveCheckoutWindow(now, holdExpiresAt)) {
    metrics.emit('payments.deposit.skipped_checkout_window', { clinicId, appointmentId });
    return;
  }

  const client = await getClinicAsaasClient(clinicId);
  if (!client) {
    // Política ligada e conta não conectada: a tela já avisa, mas o operador
    // precisa enxergar que houve agendamento sem cobrança por causa disso.
    metrics.emit('payments.deposit.skipped_no_account', { clinicId, appointmentId });
    return;
  }

  if (!(await patientApiV1.getPaymentIdentity(clinicId, patientId))) {
    // ADR-050 D6: sem CPF válido, NÃO cobra. Não se pede o dado ao paciente.
    metrics.emit('payments.deposit.skipped_no_identity', { clinicId, appointmentId });
    return;
  }

  try {
    const outcome = await createInitialHostedCheckout({
      client,
      clinicId,
      appointmentId,
      patientId,
      kind: 'deposit',
      amount,
      // Genérica de propósito (ADR-050 D2): procedimento é dado sensível.
      description: 'Sinal do agendamento',
      holdExpiresAt,
      collectionExpiresAt: holdExpiresAt,
      now,
      paymentMethod: payload.commercialPaymentMethod ?? null,
      installmentCount: payload.commercialInstallmentCount ?? null,
    });

    if (outcome === 'created') {
      metrics.emit('payments.deposit.created', { clinicId, appointmentId, amount });
    }
  } catch (err) {
    if (err instanceof BillingProviderError) {
      // 4xx = o Asaas entendeu e recusou. Retentar com o mesmo input só repete a
      // recusa: encerra o evento e deixa registro para o operador.
      const failure: PatientChargeFailedPayload = {
        clinicId,
        appointmentId,
        kind: 'deposit',
        amount,
        failureCode: err.providerErrorCodes[0] ?? 'billing_provider_error',
      };
      metrics.emit('payments.deposit.failed', failure);
      throw new PoisonPillError(
        `sinal recusado pelo gateway para o agendamento ${appointmentId}`,
        'deposit_rejected',
      );
    }
    // Indeterminado (timeout/5xx/circuito aberto): sobe para observabilidade e
    // eventual reentrega. A intenção `creation_unknown` já persistida impede que
    // a reentrega faça outro POST cego.
    throw err;
  }
}
