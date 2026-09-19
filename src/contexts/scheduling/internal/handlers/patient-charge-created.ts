/**
 * Scheduling consumer: sinal gerado → segura a vaga (ADR-049 1.3).
 *
 * Este handler é o outro lado da regra R3: o Payments cria a cobrança e **não
 * toca em `appointments`**; quem projeta o fato na agenda é a agenda, aqui,
 * reagindo ao evento. Mesma divisão que o Financial já usa com
 * `financial.lancamento.created` → `faturamento_pendente`.
 *
 * Idempotente sem `if`: `applyDepositHold` só casa agendamento `agendado` e ainda
 * sem hold. Reentrega do worker não reescreve prazo, e um agendamento que já foi
 * confirmado/cancelado enquanto o evento esperava na fila simplesmente não é
 * afetado — o `WHERE` decide, não uma leitura anterior que já pode estar velha.
 */
import type { Tx } from '@/lib/db';
import { registerHandler } from '@/lib/outbox/registry';

/* eslint-disable boundaries/element-types -- evento + tipo são o contrato PÚBLICO do Payments (mesma exceção dos demais handlers que consomem contratos de vizinhos). */
import { PAYMENTS_EVENTS, type PatientChargeCreatedPayload } from '@/contexts/payments';
/* eslint-enable boundaries/element-types */

import { applyDepositHold } from '../deposit-hold';

async function holdSlotForDeposit(ctx: {
  tx: Tx;
  clinicId: string;
  payload: PatientChargeCreatedPayload;
}): Promise<void> {
  // Só o sinal segura vaga. O restante (`remainder`, sub-fase 1.5) é cobrado
  // depois do atendimento e não tem nada a segurar.
  if (ctx.payload.kind !== 'deposit') return;

  await applyDepositHold(ctx.tx, {
    clinicId: ctx.clinicId,
    appointmentId: ctx.payload.appointmentId,
    holdExpiresAt: new Date(ctx.payload.holdExpiresAt),
  });
}

registerHandler<PatientChargeCreatedPayload>(PAYMENTS_EVENTS.CHARGE_CREATED, (ctx) =>
  holdSlotForDeposit({ tx: ctx.tx, clinicId: ctx.clinicId, payload: ctx.payload }),
);
