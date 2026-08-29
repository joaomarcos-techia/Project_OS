/**
 * Caso de uso: agendamento criado → cobra o sinal (ADR-049 1.3 + ADR-050).
 *
 * ⚠️ **AINDA NÃO TEM GATILHO LIGADO.** A intenção original era um handler de
 * `scheduling.appointment.created`, mas esse evento **já tem dono**: o handler de
 * metering do Billing. O registry do outbox é estritamente 1 handler por evento
 * (`assertUnregistered` em `lib/outbox/registry.ts`) — não existe fan-out. Escolher
 * o gatilho é decisão arquitetural aberta (cron-scan, como reminder/dunning; ou
 * chamada a partir do core de agendamento). O CORPO abaixo é o mesmo nos dois
 * caminhos, e é por isso que ele já existe e já é testado.
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
import { BillingProviderError, type AsaasClient } from '@/lib/payments/asaas';
import { getClinicAsaasClient } from '@/lib/payments/account-store';

/* eslint-disable boundaries/element-types -- evento + tipo são o contrato PÚBLICO do Scheduling, e `schedulingApiV1`/`patientApiV1` são as APIs internas públicas (M14) — mesma exceção dos demais handlers que consomem contratos de vizinhos. */
import { schedulingApiV1 } from '@/contexts/scheduling';
import { patientApiV1 } from '@/contexts/patient';
/* eslint-enable boundaries/element-types */

import type { PatientChargeFailedPayload } from '../events';
import { resolveDepositAmount } from '../policy';
import { getDepositPolicy } from '../queries';
import { findChargeByAppointment, findPaymentCustomer, linkPaymentCustomer } from './charge-store';
import { createInitialHostedCheckout, resolveCheckoutWindow } from './hosted-checkout';

/** Janela do hold (ADR-049). Fixa: é promessa ao paciente, não configuração. */
const HOLD_HOURS = 24;

/**
 * Valor mínimo que o Asaas aceita numa cobrança — **R$ 5,00**, verificado ao vivo
 * em 2026-08-24 (`invalid_value`: *"O valor mínimo para cobranças com a forma de
 * pagamento Pergunte ao Cliente é R$ 5,00"*).
 *
 * Fica AQUI, e não em `policy.ts`, porque é regra do GATEWAY e não do domínio: a
 * política é agnóstica de provedor de propósito. Sem esta guarda, uma clínica com
 * procedimento barato (50% de R$ 8 = R$ 4) geraria uma cobrança que o gateway
 * recusa — o handler trataria como poison pill e o sinal nunca aconteceria, com
 * um erro por agendamento. Não cobrar é o mesmo desfecho, sem o ruído.
 */
const MIN_GATEWAY_AMOUNT = 5;

/**
 * O hold nunca pode ultrapassar o horário da consulta: segurar uma vaga até depois
 * dela ter acontecido não segura nada — só impede a agenda de liberar o horário
 * para outro paciente a tempo.
 */
export function resolveHoldExpiry(now: Date, scheduledAt: Date): Date {
  const nominal = new Date(now.getTime() + HOLD_HOURS * 60 * 60 * 1000);
  return nominal.getTime() < scheduledAt.getTime() ? nominal : scheduledAt;
}

/**
 * Primeira consulta = o paciente não tem NENHUM outro agendamento nesta clínica.
 * Basta olhar dois: se vier algum que não seja este, é retorno.
 */
async function isReturnVisit(
  clinicId: string,
  patientId: string,
  appointmentId: string,
): Promise<boolean> {
  const previous = await schedulingApiV1.listPatientAppointments(clinicId, patientId, 2);
  return previous.some((appointment) => appointment.id !== appointmentId);
}

/**
 * Garante o customer do paciente na conta da clínica (ADR-050 D5: criação
 * preguiçosa — paciente que nunca é cobrado nunca vai para o Asaas).
 *
 * Só nome e CPF viajam. Nada de e-mail, telefone ou qualquer dado clínico.
 */
async function ensureCustomer(args: {
  client: AsaasClient;
  clinicId: string;
  patientId: string;
  nome: string;
  cpf: string;
}): Promise<string> {
  const existing = await findPaymentCustomer(args.clinicId, args.patientId);
  if (existing) return existing;

  const created = await args.client.createCustomer({
    name: args.nome,
    cpfCnpj: args.cpf,
  });
  return linkPaymentCustomer({
    clinicId: args.clinicId,
    patientId: args.patientId,
    providerCustomerId: created.customerId,
  });
}

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

  const policy = await getDepositPolicy(clinicId);
  if (!policy.enabled) return;

  // Idempotência barata ANTES de qualquer chamada externa. A garantia mesmo é o
  // UNIQUE no insert — isto só evita gastar um POST à toa numa reentrega.
  if (await findChargeByAppointment(clinicId, appointmentId)) return;

  const isReturn = await isReturnVisit(clinicId, patientId, appointmentId);
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

  const identity = await patientApiV1.getPaymentIdentity(clinicId, patientId);
  if (!identity) {
    // ADR-050 D6: sem CPF válido, NÃO cobra. Não se pede o dado ao paciente.
    metrics.emit('payments.deposit.skipped_no_identity', { clinicId, appointmentId });
    return;
  }

  try {
    const customerId = await ensureCustomer({ client, clinicId, patientId, ...identity });

    const outcome = await createInitialHostedCheckout({
      client,
      clinicId,
      appointmentId,
      patientId,
      customerId,
      kind: 'deposit',
      amount,
      // Genérica de propósito (ADR-050 D2): procedimento é dado sensível.
      description: 'Sinal do agendamento',
      holdExpiresAt,
      collectionExpiresAt: holdExpiresAt,
      now,
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
    // Indeterminado (timeout/5xx/circuito aberto): sobe e o worker retenta com
    // backoff. A retentativa entra pelo caminho de recuperação acima.
    throw err;
  }
}
