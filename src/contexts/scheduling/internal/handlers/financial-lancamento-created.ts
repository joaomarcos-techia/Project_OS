/**
 * Scheduling consumer: lançamento criado → limpa faturamento_pendente (C9).
 *
 * Reage a `financial.lancamento.created`. Quando o lançamento tem origem em
 * appointment (appointmentId não-nulo), o atendimento foi faturado com sucesso →
 * Scheduling limpa a flag na própria tabela (ownership: ver
 * financial-faturamento-pendente.ts). Lançamento manual (appointmentId=null) =
 * no-op.
 *
 * Idempotente: setar faturamento_pendente=false repetidamente é no-op.
 */
import { and, eq, sql } from 'drizzle-orm';

import { registerHandler } from '@/lib/outbox/registry';

/* eslint-disable boundaries/element-types -- evento + tipo são o contrato PÚBLICO do Financial (mesma exceção do clinical consumindo scheduling). */
import { FINANCIAL_EVENTS, type LancamentoCreatedPayload } from '@/contexts/financial';
/* eslint-enable boundaries/element-types */

import { appointments } from '../../schema';

registerHandler<LancamentoCreatedPayload>(
  FINANCIAL_EVENTS.LANCAMENTO_CREATED,
  async ({ tx, clinicId, payload }) => {
    if (payload.appointmentId === null) return; // lançamento manual: nada a fazer
    await tx
      .update(appointments)
      .set({ faturamentoPendente: false, updatedAt: sql`now()` })
      .where(and(eq(appointments.clinicId, clinicId), eq(appointments.id, payload.appointmentId)));
  },
);
