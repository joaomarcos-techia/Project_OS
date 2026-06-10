/**
 * Scheduling consumer: faturamento pendente → marca a flag em appointments (C9).
 *
 * Reage a `financial.faturamento.pendente`. Ownership (ADR-014 R11/M12 + R3 do
 * plano C9): Scheduling é o DONO FÍSICO da tabela `appointments`; Financial é o
 * dono SEMÂNTICO do estado de faturamento. Financial decide via evento, Scheduling
 * escreve a própria tabela. Mantém o boundary limpo (Financial nunca dá UPDATE
 * em appointments).
 *
 * Idempotente: setar faturamento_pendente=true repetidamente é no-op.
 */
import { and, eq, sql } from 'drizzle-orm';

import { registerHandler } from '@/lib/outbox/registry';

/* eslint-disable boundaries/element-types -- evento + tipo são o contrato PÚBLICO do Financial (mesma exceção do clinical consumindo scheduling). */
import { FINANCIAL_EVENTS, type FaturamentoPendentePayload } from '@/contexts/financial';
/* eslint-enable boundaries/element-types */

import { appointments } from '../../schema';

registerHandler<FaturamentoPendentePayload>(
  FINANCIAL_EVENTS.FATURAMENTO_PENDENTE,
  async ({ tx, clinicId, payload }) => {
    await tx
      .update(appointments)
      .set({ faturamentoPendente: true, updatedAt: sql`now()` })
      .where(and(eq(appointments.clinicId, clinicId), eq(appointments.id, payload.appointmentId)));
  },
);
