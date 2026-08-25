/**
 * Fechamento da cobrança do sinal (ADR-049 1.5 — ramos A e C).
 *
 * Duas perguntas, e só duas:
 *   - o agendamento morreu e o sinal **nunca foi pago** → o link precisa MORRER
 *     junto. Sem isto, o paciente abre um link de dias atrás e paga por uma vaga
 *     que a clínica já deu para outra pessoa;
 *   - o agendamento morreu e o sinal **foi pago** → o dinheiro volta (cancelou
 *     dentro da janela) ou fica (faltou, ou cancelou em cima da hora — é a taxa
 *     que o sinal existe para cobrar).
 *
 * **Retenção não escreve nada.** É o estado que já existe: cobrança `paid` +
 * agendamento `faltou`/`cancelado`. Um status `retained` seria um fato derivado
 * gravado — e ele passaria a mentir no dia em que a agenda for reaberta
 * (`recovery-policy`: `faltou → agendado`). O que fica é métrica.
 *
 * **Sempre olha antes de agir.** Toda operação irreversível no gateway é
 * precedida de um `getPayment`: é a mesma doutrina do `findPaymentByExternalReference`
 * na criação. O Asaas não tem idempotency-key, e o worker entrega at-least-once —
 * sem a leitura, uma reentrega estornaria duas vezes.
 *
 * **Ownership (R3):** nada aqui escreve `appointments`. Publica-se
 * `payments.patient_charge.closed`; quem projeta na agenda é o Scheduling.
 */
import { metrics } from '@/lib/observability/metrics';
import { PoisonPillError } from '@/lib/outbox/errors';
import { getClinicAsaasClient } from '@/lib/payments/account-store';
import { BillingProviderError, type AsaasClient } from '@/lib/payments/asaas';

/* eslint-disable-next-line boundaries/element-types -- `schedulingApiV1` é a API interna pública (M14), mesma exceção do `deposit-charge` e dos demais consumidores de contrato de vizinho. */
import { schedulingApiV1 } from '@/contexts/scheduling';

import { isRefundableCancellation } from '../policy';
import { getDepositPolicy } from '../queries';
import {
  closeCharge,
  findOpenCharge,
  releaseCreditAsRetained,
  type OpenCharge,
} from './charge-store';

/**
 * Status do Asaas em que o dinheiro do paciente REALMENTE entrou. Só a partir
 * daqui existe algo a estornar — e é a partir daqui que uma cobrança não pode
 * mais ser simplesmente apagada.
 */
const SETTLED_STATUSES = new Set(['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH']);

/** Status em que o estorno já aconteceu (ou está a caminho) na conta da clínica. */
const REFUNDED_STATUSES = new Set(['REFUNDED', 'REFUND_REQUESTED', 'REFUND_IN_PROGRESS']);

/**
 * Formas de pagamento que o Asaas sabe estornar pela API. Verificado ao vivo em
 * 2026-08-24, e a mensagem é literal: *"Somente é possível estornar cobranças
 * cuja a forma de pagamento seja cartão de crédito ou Pix."*
 *
 * Importa porque o sinal nasce como `UNDEFINED` — quem escolhe é o paciente, na
 * página do Asaas. Se ele pagar por boleto (ou se a clínica marcar como recebido
 * em dinheiro no painel), o estorno automático é IMPOSSÍVEL. Sem esta guarda o
 * handler tomaria 400 do gateway, o worker retentaria até desistir, e o
 * cancelamento apareceria como falha genérica em vez de tarefa para uma pessoa.
 */
const REFUNDABLE_BILLING_TYPES = new Set(['PIX', 'CREDIT_CARD']);

/**
 * Cancelamentos que devolvem o sinal **independentemente da janela**, porque em
 * nenhum deles o paciente deixou a clínica com a vaga vazia por escolha própria:
 *
 * - `doctor_absence` — a clínica desmarcou. Reter seria cobrar o paciente pelo
 *   problema da clínica;
 * - `patient_deceased` / `patient_deleted` — cobrar taxa de falta do espólio, ou
 *   de quem exerceu o direito de exclusão (LGPD), é indefensável;
 * - `reschedule` — o remarcado gera agendamento NOVO, e a varredura da 1.3 cobra
 *   sinal dele. Sem devolver o primeiro, o paciente ficaria com **dois sinais
 *   pagos pela mesma consulta**. Entre a clínica perder a taxa e o paciente ser
 *   cobrado em dobro, quem ganha é o paciente.
 *
 * `user` é o único que passa pela regra da janela — e é exatamente o caso que o
 * anti-no-show existe para cobrir.
 */
const ALWAYS_REFUND_REASONS = new Set([
  'doctor_absence',
  'patient_deceased',
  'patient_deleted',
  'reschedule',
]);

/**
 * O sinal foi pago e o dinheiro fica com a clínica. Não há escrita: o par
 * (`patient_charges.paid`, agendamento morto) já É o fato.
 */
async function retain(
  clinicId: string,
  appointmentId: string,
  charge: OpenCharge,
  reason: string,
): Promise<void> {
  metrics.emit('payments.deposit.retained', {
    clinicId,
    appointmentId,
    chargeId: charge.id,
    amount: charge.amount,
    reason,
  });
  // ADR-051 — a COBRANÇA continua sem status `retained` (retenção segue derivada
  // na 1.5a). Quem ganha estado explícito é o CRÉDITO no Financial: um crédito
  // `available` é promessa sobre dinheiro futuro, e deixá-lo assim faria um
  // lançamento posterior absorver dinheiro já retido como taxa de falta.
  await releaseCreditAsRetained({
    clinicId,
    chargeId: charge.id,
    appointmentId,
    amount: charge.amount,
  });
}

/**
 * Erro RETENTÁVEL: o gateway diz que o paciente pagou, mas a conciliação (webhook)
 * ainda não chegou. Voltar depois é a única resposta correta — cancelar a cobrança
 * apagaria um pagamento real, e fechar como não-paga perderia o dinheiro de vista.
 */
class ChargeNotSettledYetError extends Error {
  constructor(appointmentId: string) {
    super(`cobrança do agendamento ${appointmentId} foi paga e ainda não conciliada`);
    this.name = 'ChargeNotSettledYetError';
  }
}

/**
 * 404 do provedor. Raro neste caminho — o Asaas **não** devolve 404 para cobrança
 * apagada (ver `ProviderPayment.deleted`) —, mas continua valendo para id que
 * nunca existiu naquela conta.
 */
function isNotFound(err: unknown): boolean {
  return err instanceof BillingProviderError && err.httpStatus === 404;
}

/**
 * Recusa DEFINITIVA do gateway (4xx que não seja 404 nem 429).
 *
 * Retentar repete a mesma recusa e queima o orçamento de retentativas do worker
 * sem chance de desfecho diferente; o que serve ao operador é o evento parar como
 * `failed`, visível, agora. Mesma decisão do `deposit-charge` para 4xx.
 *
 * **429 fica de fora de propósito**: é 4xx mas é justamente o único que muda
 * sozinho com o tempo — tratá-lo como terminal jogaria fora um estorno que só
 * precisava esperar.
 */
function rethrowGatewayError(
  err: unknown,
  ctx: { clinicId: string; appointmentId: string; chargeId: string; op: string },
): never {
  const status = err instanceof BillingProviderError ? err.httpStatus : null;
  if (status !== null && status >= 400 && status < 500 && status !== 429) {
    metrics.emit('payments.deposit.gateway_rejected', {
      ...ctx,
      status,
      code: (err as BillingProviderError).providerErrorCodes[0] ?? 'billing_provider_error',
    });
    throw new PoisonPillError(
      `${ctx.op} recusado pelo gateway no agendamento ${ctx.appointmentId}`,
      `${ctx.op}_rejected`,
    );
  }
  throw err;
}

/**
 * Mata o link de uma cobrança que nunca foi paga.
 *
 * A ordem importa: apaga no gateway ANTES de fechar no banco. Se o processo cair
 * no meio, a reentrega encontra a cobrança já marcada `deleted` e conclui. O
 * inverso — fechar primeiro — deixaria um link pagável que o sistema já esqueceu.
 */
async function voidCharge(args: {
  client: AsaasClient | null;
  clinicId: string;
  appointmentId: string;
  charge: OpenCharge;
  outcome: 'cancelled' | 'expired';
}): Promise<void> {
  const { client, clinicId, appointmentId, charge } = args;

  if (charge.providerPaymentId && client) {
    let payment = null;
    try {
      payment = await client.getPayment(charge.providerPaymentId, { attempts: 1 });
    } catch (err) {
      if (!isNotFound(err)) {
        rethrowGatewayError(err, {
          clinicId,
          appointmentId,
          chargeId: charge.id,
          op: 'consulta_da_cobranca',
        });
      }
    }

    // `deleted` e não 404: o Asaas responde 200 para cobrança já removida, com o
    // `status` congelado no que era antes (verificado ao vivo). Confiar só no
    // status faria uma cobrança apagada parecer viva.
    const live = payment !== null && !payment.deleted ? payment : null;

    if (live && SETTLED_STATUSES.has(live.status)) {
      // Corrida real: o paciente pagou entre a criação do link e o cancelamento,
      // e o webhook ainda não conciliou. Apagar aqui destruiria o registro de um
      // pagamento que ENTROU na conta da clínica.
      metrics.emit('payments.deposit.void_blocked_paid', {
        clinicId,
        appointmentId,
        chargeId: charge.id,
        providerStatus: live.status,
      });
      throw new ChargeNotSettledYetError(appointmentId);
    }

    if (live) {
      try {
        await client.cancelPayment(charge.providerPaymentId);
      } catch (err) {
        if (!isNotFound(err)) {
          rethrowGatewayError(err, {
            clinicId,
            appointmentId,
            chargeId: charge.id,
            op: 'cancelamento_da_cobranca',
          });
        }
      }
    }
  } else if (charge.providerPaymentId && !client) {
    // Conta desconectada: o link continua vivo no Asaas e não temos como apagá-lo.
    // Fecha o registro mesmo assim (ele TEM de refletir o agendamento) e deixa o
    // órfão visível — corrigir exige a chave, que só a clínica tem.
    metrics.emit('payments.deposit.void_orphan_link', {
      clinicId,
      appointmentId,
      chargeId: charge.id,
    });
  }

  const closed = await closeCharge({
    clinicId,
    chargeId: charge.id,
    from: 'pending',
    outcome: args.outcome,
    kind: charge.kind,
    appointmentId,
    amount: charge.amount,
    closedAt: new Date(),
  });
  if (closed) {
    metrics.emit('payments.deposit.voided', {
      clinicId,
      appointmentId,
      chargeId: charge.id,
      outcome: args.outcome,
    });
  }
}

/** Devolve o sinal ao paciente. */
async function refundCharge(args: {
  client: AsaasClient | null;
  clinicId: string;
  appointmentId: string;
  charge: OpenCharge;
}): Promise<void> {
  const { client, clinicId, appointmentId, charge } = args;

  if (!client || !charge.providerPaymentId) {
    // Sem chave (conta desconectada) ou sem id no gateway não há como devolver.
    // NÃO se fecha a cobrança: marcar `refunded` sem ter estornado seria o
    // sistema mentindo que o paciente recebeu o dinheiro de volta.
    metrics.emit('payments.deposit.refund_skipped', {
      clinicId,
      appointmentId,
      chargeId: charge.id,
      reason: client ? 'sem_provider_payment_id' : 'conta_desconectada',
    });
    return;
  }

  const gateway = { clinicId, appointmentId, chargeId: charge.id, op: 'estorno' };
  const payment = await client
    .getPayment(charge.providerPaymentId, { attempts: 1 })
    .catch((err: unknown) => rethrowGatewayError(err, gateway));

  if (!REFUNDED_STATUSES.has(payment.status)) {
    if (!SETTLED_STATUSES.has(payment.status)) {
      // Nosso banco diz `paid`, o Asaas diz que não recebeu. Divergência que uma
      // pessoa precisa olhar — estornar dinheiro que não entrou é pior que não
      // estornar.
      metrics.emit('payments.deposit.refund_skipped', {
        clinicId,
        appointmentId,
        chargeId: charge.id,
        reason: 'provider_nao_confirma_pagamento',
        providerStatus: payment.status,
      });
      return;
    }
    if (!REFUNDABLE_BILLING_TYPES.has(payment.billingType ?? '')) {
      // Pago por boleto ou marcado como recebido em dinheiro: a devolução existe,
      // mas quem a faz é uma pessoa, pelo painel. Deixar a cobrança `paid` é o
      // registro honesto — `refunded` diria que o paciente já recebeu de volta.
      metrics.emit('payments.deposit.refund_skipped', {
        clinicId,
        appointmentId,
        chargeId: charge.id,
        reason: 'forma_de_pagamento_nao_estornavel',
        billingType: payment.billingType,
      });
      return;
    }
    await client
      .refundPayment(charge.providerPaymentId)
      .catch((err: unknown) => rethrowGatewayError(err, gateway));
  }
  // `REFUNDED` sem passar pelo POST = uma execução anterior estornou e caiu antes
  // de gravar. Segue para o fechamento em vez de estornar de novo.

  const closed = await closeCharge({
    clinicId,
    chargeId: charge.id,
    from: 'paid',
    outcome: 'refunded',
    kind: charge.kind,
    appointmentId,
    amount: charge.amount,
    closedAt: new Date(),
  });
  if (closed) {
    metrics.emit('payments.deposit.refunded', {
      clinicId,
      appointmentId,
      chargeId: charge.id,
      amount: charge.amount,
    });
  }
}

/**
 * Ramo A — o paciente faltou.
 *
 * Pago ⇒ retido (é a taxa de no-show; o produto inteiro existe para isto).
 * Não pago ⇒ o link morre, senão a falta ainda gera pagamento depois.
 */
export async function closeChargeForNoShow(ctx: {
  clinicId: string;
  appointmentId: string;
}): Promise<void> {
  const { clinicId, appointmentId } = ctx;
  const charge = await findOpenCharge(clinicId, appointmentId);
  if (!charge) return;

  if (charge.status === 'paid') {
    await retain(clinicId, appointmentId, charge, 'no_show');
    return;
  }

  const client = await getClinicAsaasClient(clinicId);
  await voidCharge({ client, clinicId, appointmentId, charge, outcome: 'cancelled' });
}

/**
 * Ramo C — o agendamento foi cancelado.
 *
 * `cancelledAt` vem do evento porque a decisão é sobre ANTECEDÊNCIA: usar o
 * relógio do worker faria um cancelamento feito a tempo virar "tarde demais"
 * sempre que o outbox atrasasse — e o paciente perderia dinheiro por causa de
 * uma fila nossa.
 */
export async function closeChargeForCancellation(ctx: {
  clinicId: string;
  appointmentId: string;
  cancelReason: string;
  cancelledAt: Date;
}): Promise<void> {
  const { clinicId, appointmentId, cancelReason, cancelledAt } = ctx;
  const charge = await findOpenCharge(clinicId, appointmentId);
  if (!charge) return;

  const client = await getClinicAsaasClient(clinicId);

  if (charge.status === 'pending') {
    // `deposit_expired` é o próprio hold vencendo: o desfecho correto é `expired`,
    // não `cancelled`. Sem isto a linha ficaria `pending` para sempre (a varredura
    // da 1.3 só mexe em `appointments`) e o link seguiria pagável.
    await voidCharge({
      client,
      clinicId,
      appointmentId,
      charge,
      outcome: cancelReason === 'deposit_expired' ? 'expired' : 'cancelled',
    });
    return;
  }

  if (ALWAYS_REFUND_REASONS.has(cancelReason)) {
    await refundCharge({ client, clinicId, appointmentId, charge });
    return;
  }

  const appointment = await schedulingApiV1.lookupAppointment(clinicId, appointmentId);
  if (!appointment) {
    // Agendamento sumiu (hard-delete do paciente leva o registro junto). Sem o
    // horário não há como julgar a janela; devolver às cegas move dinheiro sem
    // base — mesma postura do `resolveDepositAmount`, que devolve `null` na dúvida.
    metrics.emit('payments.deposit.refund_skipped', {
      clinicId,
      appointmentId,
      chargeId: charge.id,
      reason: 'agendamento_nao_encontrado',
    });
    return;
  }

  const policy = await getDepositPolicy(clinicId);
  const refundable = isRefundableCancellation({
    policy,
    startsAt: new Date(appointment.scheduledAt),
    cancelledAt,
  });

  if (!refundable) {
    await retain(clinicId, appointmentId, charge, 'cancelamento_fora_da_janela');
    return;
  }

  await refundCharge({ client, clinicId, appointmentId, charge });
}
