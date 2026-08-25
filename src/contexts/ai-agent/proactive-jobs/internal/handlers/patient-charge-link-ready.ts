/**
 * ADR-049 1.6a consumer: link do sinal pronto → mensagem ao paciente.
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

import type { DepositLinkPayload } from '../../domain/types';
import { insertJobTx } from '../../infra/repository';

async function enqueueDepositLink(ctx: {
  tx: Tx;
  clinicId: string;
  payload: PatientChargeLinkReadyPayload;
  eventId: string;
}): Promise<void> {
  const { tx, clinicId, payload } = ctx;

  // Só o SINAL é entregue por esta fila. O restante (1.5b) tem outra natureza —
  // não segura vaga, não tem prazo de hold, e a copy do template diz "para
  // garantir seu horário", o que estaria errado depois do atendimento.
  //
  // ⚠️ **LACUNA CONHECIDA (1.6c).** A cobrança do restante É criada e o link
  // fica em `patient_charges.invoice_url`, mas **ninguém o entrega ao paciente**
  // automaticamente. Até a 1.6c existir, quem envia é a clínica, pelo painel —
  // ou a régua de dunning, quando o recebível vencer.
  //
  // A métrica existe para que essa lacuna seja CONTÁVEL em vez de silenciosa: é
  // exatamente o formato do D32 (peça verde, jornada incompleta), e a diferença
  // entre um gap conhecido e um bug é alguém conseguir vê-lo.
  if (payload.kind !== 'deposit') {
    metrics.emit('proactive.deposit_link.skipped_kind', {
      clinicId,
      chargeId: payload.chargeId,
      kind: payload.kind,
    });
    return;
  }

  const job: DepositLinkPayload = {
    patientId: payload.patientId,
    chargeId: payload.chargeId,
    appointmentId: payload.appointmentId,
    amount: payload.amount,
    holdExpiresAt: payload.holdExpiresAt,
  };

  await insertJobTx(tx, {
    clinicId,
    type: 'deposit_link',
    scheduledFor: new Date(),
    payload: job,
    dedupKey: `deposit_link:${payload.chargeId}`,
  });
}

registerHandler<PatientChargeLinkReadyPayload>(
  PAYMENTS_EVENTS.CHARGE_LINK_READY,
  enqueueDepositLink,
);
