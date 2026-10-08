/**
 * ADR-049 / D35 consumer: link pagável pronto → mensagem ao paciente.
 *
 * Reage a `payments.patient_charge.link_ready`. Este era o elo que faltava desde
 * a 1.3: a cobrança era criada, o `invoice_url` ficava guardado em
 * `patient_charges`, e **nada o entregava** — a vaga expirava sem o paciente
 * jamais ter recebido como pagar.
 *
 * **A IA continua read-only em cobrança (ADR-023).** Quem gera a cobrança é o
 * sistema, quem envia é a fila C14 com template aprovado na Meta. Não há LLM em
 * nenhum ponto deste caminho: o agente entrega o que o sistema decidiu, e não
 * decide nada sobre dinheiro.
 *
 * Enfileira na fila C14 em vez de abrir caminho paralelo de envio — lease,
 * backoff, janela 8-20h, supressão, consentimento, dedup e at-most-once no Meta
 * já estão resolvidos lá. Reimplementar isso pior, num caminho que manda LINK DE
 * PAGAMENTO para paciente, seria a pior troca possível.
 *
 * `scheduledFor = agora`: o hold é de 24h e cada hora sem o link é uma hora a
 * menos para pagar. O `claimDue` ainda aplica a janela 8-20h local, então um
 * agendamento feito de madrugada só vira mensagem pela manhã — preferível a
 * acordar o paciente, e o hold ainda deixa margem.
 *
 * Idempotente em dupla defesa: UNIQUE(clinic_id, dedup_key) + onConflictDoNothing.
 * A chave é a COBRANÇA: uma cobrança tem um link, e um link se avisa uma vez.
 */
import { metrics } from '@/lib/observability/metrics';
import { registerHandler } from '@/lib/outbox/registry';
import type { Tx } from '@/lib/db';

/* eslint-disable boundaries/element-types -- evento + tipo são o contrato PÚBLICO do Payments (mesma exceção dos demais handlers que consomem contratos de vizinhos). */
import { PAYMENTS_EVENTS, type PatientChargeLinkReadyPayload } from '@/contexts/payments';
/* eslint-enable boundaries/element-types */

import type { DepositLinkPayload, RemainderLinkPayload } from '../../domain/types';
import { insertJobTx } from '../../infra/repository';

/**
 * O link do RESTANTE espera 2 h (08/10/2026). O restante pode ser pago na
 * clínica, inclusive em dinheiro: a cobrança nasce quando o atendimento é
 * concluído, e o paciente costuma acertar na recepção logo depois. A espera
 * dá tempo de a recepção registrar o pagamento — o que fecha o link antes do
 * envio — em vez de o paciente receber um link pelo que acabou de pagar. O
 * sinal não espera: cada hora sem o link é uma hora a menos do hold.
 */
export const REMAINDER_LINK_DELAY_MS = 2 * 60 * 60 * 1000;

async function enqueuePaymentLink(ctx: {
  tx: Tx;
  clinicId: string;
  payload: PatientChargeLinkReadyPayload;
  eventId: string;
}): Promise<void> {
  const { tx, clinicId, payload } = ctx;
  // O schema do evento fecha os valores conhecidos; o check continua fail-closed
  // para replay legado/corrompido que chegue à borda sem passar pelo catálogo.
  const kind: string = payload.kind;

  if (kind !== 'deposit' && kind !== 'remainder') {
    metrics.emit('proactive.deposit_link.skipped_kind', {
      clinicId,
      chargeId: payload.chargeId,
      kind,
    });
    return;
  }

  const type = kind === 'deposit' ? 'deposit_link' : 'remainder_link';
  const identity = {
    patientId: payload.patientId,
    chargeId: payload.chargeId,
    appointmentId: payload.appointmentId,
    amount: payload.amount,
  };
  const job: DepositLinkPayload | RemainderLinkPayload =
    kind === 'deposit' ? { ...identity, holdExpiresAt: payload.holdExpiresAt } : identity;

  await insertJobTx(tx, {
    clinicId,
    type,
    scheduledFor: kind === 'deposit' ? new Date() : new Date(Date.now() + REMAINDER_LINK_DELAY_MS),
    payload: job,
    dedupKey: `${type}:${payload.chargeId}`,
  });
}

registerHandler<PatientChargeLinkReadyPayload>(
  PAYMENTS_EVENTS.CHARGE_LINK_READY,
  enqueuePaymentLink,
);
