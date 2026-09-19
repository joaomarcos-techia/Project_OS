/**
 * Hold do sinal no agendamento (ADR-049 1.3).
 *
 * **Ownership (regra R3):** o Payments NÃO escreve `appointments`. Ele publica
 * `payments.patient_charge.*`; é AQUI que a agenda projeta esse fato nas suas
 * próprias colunas. A dona da vaga é a agenda.
 *
 * **A máquina de estados continua congelada.** `deposit_status` é uma dimensão
 * ORTOGONAL: segurar a vaga não inventa um estado novo de agendamento. Quando o
 * hold vence, o cancelamento passa por `applyTransition` como qualquer outro —
 * com `FOR UPDATE`, `assertTransition`, state log, evento e oferta da vaga para a
 * lista de espera. Nada de `UPDATE status` por fora.
 */
import 'server-only';

import { and, eq, sql } from 'drizzle-orm';

import { dbAdmin } from '@/lib/db';
import type { Tx } from '@/lib/db';
import { withTenant } from '@/lib/db/tenant';
import { metrics } from '@/lib/observability/metrics';

import { appointments } from '../schema';
import { applyTransition } from './appointment-core';

/**
 * Marca a vaga como segurada aguardando o sinal.
 *
 * Só age sobre agendamento `agendado` e ainda sem hold: se o paciente já
 * confirmou, cancelou ou compareceu, segurar a vaga agora seria retroceder um
 * estado que já andou — o `WHERE` é a trava, não um `if` antes.
 */
export async function applyDepositHold(
  tx: Tx,
  input: { clinicId: string; appointmentId: string; holdExpiresAt: Date },
): Promise<boolean> {
  const rows = await tx
    .update(appointments)
    .set({
      depositStatus: 'pending',
      holdExpiresAt: input.holdExpiresAt,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(appointments.id, input.appointmentId),
        eq(appointments.clinicId, input.clinicId),
        eq(appointments.status, 'agendado'),
        eq(appointments.depositStatus, 'none'),
      ),
    )
    .returning({ id: appointments.id });
  return rows.length > 0;
}

interface ExpiredHoldRow extends Record<string, unknown> {
  clinic_id: string;
  appointment_id: string;
}

/**
 * Holds vencidos, cross-tenant (mesma justificativa do `reminder-candidates`:
 * varrer todas as clínicas num passo). O CHECK da 0085 garante que `pending`
 * sempre tem prazo, então a comparação nunca encontra `NULL`.
 */
async function listExpiredHolds(limit: number): Promise<ExpiredHoldRow[]> {
  return dbAdmin.execute<ExpiredHoldRow>(sql`
    SELECT clinic_id::text AS clinic_id, id::text AS appointment_id
    FROM appointments
    WHERE deposit_status = 'pending'
      AND status = 'agendado'
      AND hold_expires_at < now()
    ORDER BY hold_expires_at
    LIMIT ${limit}
  `);
}

export interface ExpireHoldsSummary extends Record<string, unknown> {
  scanned: number;
  cancelled: number;
  failed: number;
}

/**
 * Cancela os agendamentos cujo sinal não foi pago dentro do hold.
 *
 * É a metade do anti-no-show que devolve a vaga: sem isto, um paciente que nunca
 * paga segura o horário até o dia da consulta e a clínica perde o slot de
 * qualquer jeito. `applyTransition` já oferece a vaga para a lista de espera.
 *
 * Um agendamento que falha não interrompe a varredura — a próxima passada tenta
 * de novo, porque a query é função pura do estado atual.
 */
export async function expireDepositHolds(opts?: { limit?: number }): Promise<ExpireHoldsSummary> {
  const rows = await listExpiredHolds(opts?.limit ?? 200);
  const summary: ExpireHoldsSummary = { scanned: rows.length, cancelled: 0, failed: 0 };

  for (const row of rows) {
    try {
      await withTenant(row.clinic_id, async (tx) => {
        await applyTransition(tx, {
          clinicId: row.clinic_id,
          appointmentId: row.appointment_id,
          target: 'cancelado',
          transitionedBy: null,
          actorType: 'system',
          reason: 'sinal não pago dentro do prazo',
          cancelReason: 'deposit_expired',
          clientKey: `deposit-expired:${row.appointment_id}`,
          correlationId: null,
        });
        // Depois da transição: o CHECK exige que sair de `pending` limpe o prazo.
        await tx
          .update(appointments)
          .set({ depositStatus: 'expired', holdExpiresAt: null, updatedAt: sql`now()` })
          .where(
            and(eq(appointments.id, row.appointment_id), eq(appointments.clinicId, row.clinic_id)),
          );
      });
      summary.cancelled += 1;
    } catch (err) {
      summary.failed += 1;
      metrics.emit('scheduling.deposit_hold.expire_error', {
        clinicId: row.clinic_id,
        appointmentId: row.appointment_id,
        error: err,
      });
    }
  }

  return summary;
}
