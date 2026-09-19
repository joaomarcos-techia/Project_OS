/**
 * Scheduling consumer: a cobrança do sinal fechou → a agenda projeta o desfecho
 * (ADR-049 1.5).
 *
 * **Ownership (regra R3):** o Payments decide o destino do dinheiro e publica; a
 * coluna `deposit_status` é da AGENDA, e quem a escreve é a agenda. Mesmo desenho
 * do `patient-charge-created` e do `patient-charge-paid`.
 *
 * **Nenhuma transição de status aqui.** Estornar não ressuscita nem mata
 * agendamento: quando este evento chega, o agendamento já é `cancelado` ou
 * `faltou` — quem o levou até lá foi `applyTransition`, e a máquina continua
 * congelada. `deposit_status` é dimensão ORTOGONAL (0085).
 *
 * O `WHERE` carrega o estado de ORIGEM esperado, e é ele que torna a projeção
 * segura sob reentrega e fora de ordem: a varredura de expiração da 1.3 já
 * escreve `expired` direto, então o evento correspondente encontra a coluna fora
 * de `pending` e não faz nada — em vez de sobrescrever um desfecho mais recente.
 */
import { and, eq, sql } from 'drizzle-orm';

import type { Tx } from '@/lib/db';
import { metrics } from '@/lib/observability/metrics';
import { registerHandler } from '@/lib/outbox/registry';

/* eslint-disable boundaries/element-types -- evento + tipo são o contrato PÚBLICO do Payments (mesma exceção dos demais handlers que consomem contratos de vizinhos). */
import { PAYMENTS_EVENTS, type PatientChargeClosedPayload } from '@/contexts/payments';
/* eslint-enable boundaries/element-types */

import { appointments } from '../../schema';

/**
 * `cancelled` vira `none` (e não um estado próprio): a cobrança nunca foi paga,
 * então do ponto de vista da AGENDA não há — e nunca houve — hold segurando a
 * vaga. É o mesmo mapeamento que a migration 0085 documenta.
 */
const TARGET_STATUS = {
  refunded: 'refunded',
  expired: 'expired',
  cancelled: 'none',
} as const;

/** De onde a coluna pode sair. Estornar exige ter estado pago; o resto, pendente. */
const SOURCE_STATUS = {
  refunded: 'paid',
  expired: 'pending',
  cancelled: 'pending',
} as const;

async function projectClosedCharge(ctx: {
  tx: Tx;
  clinicId: string;
  payload: PatientChargeClosedPayload;
  eventId: string;
}): Promise<void> {
  const { tx, clinicId, payload } = ctx;
  // Só o sinal move a coluna do hold. O restante (1.5b) não segura vaga.
  if (payload.kind !== 'deposit') return;

  const rows = await tx
    .update(appointments)
    .set({
      depositStatus: TARGET_STATUS[payload.outcome],
      // O CHECK da 0085 exige prazo APENAS em `pending`; nenhum destino aqui é
      // `pending`, então o prazo tem de sair junto ou o UPDATE é rejeitado.
      holdExpiresAt: null,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(appointments.id, payload.appointmentId),
        eq(appointments.clinicId, clinicId),
        eq(appointments.depositStatus, SOURCE_STATUS[payload.outcome]),
      ),
    )
    .returning({ id: appointments.id });

  // `expired` fica FORA da métrica de propósito: a varredura de holds
  // (`deposit-hold.ts`) já projeta `expired` na própria transação, então o no-op
  // aqui é o caminho NORMAL, não um sinal. Métrica que dispara em todo tick
  // treina o operador a ignorá-la — e aí ela não serve para os casos que
  // realmente importam (`refunded`/`cancelled` chegando fora de ordem).
  if (rows.length === 0 && payload.outcome !== 'expired') {
    metrics.emit('scheduling.deposit.close_noop', {
      clinicId,
      appointmentId: payload.appointmentId,
      outcome: payload.outcome,
    });
  }
}

registerHandler<PatientChargeClosedPayload>(PAYMENTS_EVENTS.CHARGE_CLOSED, (ctx) =>
  projectClosedCharge({
    tx: ctx.tx,
    clinicId: ctx.clinicId,
    payload: ctx.payload,
    eventId: ctx.eventId,
  }),
);
