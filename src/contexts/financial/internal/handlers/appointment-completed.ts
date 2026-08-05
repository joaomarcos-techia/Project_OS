/**
 * Financial consumer: appointment completed → cria lançamento a receber (C9).
 *
 * Reage a `scheduling.appointment.completed` (substitui o placeholder temp do C6).
 * Idempotente em DUPLA defesa: UNIQUE parcial em lancamentos(appointment_id) +
 * onConflictDoNothing — a re-entrega at-least-once do worker NÃO duplica.
 *
 * Timeout (spec): o corpo roda sob um teto de 5s; exceder vira erro RETENTÁVEL
 * (backoff do worker). Falha de NEGÓCIO (valor inválido) NÃO retenta: registra
 * pendência + emite `financial.faturamento.pendente` (Scheduling marca a flag) e
 * conclui — o evento fica `processed`, o banner do Caixa aparece (vazamento zero).
 *
 * Ownership (R3): este handler NÃO escreve `appointments`. Quem marca/limpa
 * `appointments.faturamento_pendente` é o Scheduling, reagindo aos eventos abaixo.
 */
import { eq, sql } from 'drizzle-orm';

import type { Tx } from '@/lib/db';
import { PoisonPillError } from '@/lib/outbox/errors';
import { publishEvent } from '@/lib/outbox/publish';
import { registerHandler } from '@/lib/outbox/registry';

/* eslint-disable boundaries/element-types -- evento + tipo são o contrato PÚBLICO do Scheduling (mesma exceção do handler clinical/appointment-started). */
import { SCHEDULING_EVENTS, type AppointmentCompletedPayload } from '@/contexts/scheduling';
/* eslint-enable boundaries/element-types */

import { FINANCIAL_EVENTS } from '../../events';
import { atendimentoDescricao, round2 } from '../../logic';
import { faturamentoPendencias, lancamentos } from '../../schema';

// Timeout do handler (spec: 5s). Aplicado como `statement_timeout` no nível do
// banco (SET LOCAL na TX do worker) em vez de um Promise.race em JS. Motivo: o
// Promise.race NÃO cancela a query em andamento — num timeout ele deixa queries
// órfãs numa transação que está sendo desfeita, e dispara espúrio em conexão
// lenta (cada query soma). statement_timeout faz o Postgres abortar a query (57014)
// de forma transaction-safe → handler falha → worker retenta → reconcile cobre.
const STATEMENT_TIMEOUT_MS = 5_000;
const DEFAULT_TZ = 'America/Sao_Paulo';

/** 'YYYY-MM-DD' do dia atual na timezone da clínica (due_date). */
function todayInTz(tz: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

async function faturarAtendimento(ctx: {
  tx: Tx;
  clinicId: string;
  payload: AppointmentCompletedPayload;
  eventId: string;
}): Promise<void> {
  const { tx, clinicId, payload, eventId } = ctx;

  // Timeout de 5s por statement (SET LOCAL → escopo desta TX do worker). Aborta
  // queries lentas de forma transaction-safe (sem Promise.race / órfãos).
  await tx.execute(
    sql`SELECT set_config('statement_timeout', ${String(STATEMENT_TIMEOUT_MS)}, true)`,
  );

  // Defesa: clinicId do payload deve bater com o contexto RLS do worker.
  if (payload.clinicId !== clinicId) {
    throw new PoisonPillError(
      `clinicId divergente: payload=${payload.clinicId} ctx=${clinicId}`,
      'clinic_mismatch',
    );
  }

  // Falha de negócio: valor inválido/zerado → pendência (sem lançamento, sem retry).
  if (!(payload.valor > 0)) {
    const motivo = 'Atendimento concluído com valor inválido ou zerado.';
    await tx
      .insert(faturamentoPendencias)
      .values({
        clinicId,
        appointmentId: payload.appointmentId,
        motivo,
        valor: round2(payload.valor).toFixed(2),
        status: 'aberta',
      })
      .onConflictDoUpdate({
        target: faturamentoPendencias.appointmentId,
        set: { motivo, status: 'aberta', resolvedAt: null, resolvedBy: null },
      });
    await publishEvent(tx, {
      clinicId,
      eventType: FINANCIAL_EVENTS.FATURAMENTO_PENDENTE,
      payload: {
        appointmentId: payload.appointmentId,
        clinicId,
        motivo,
        valor: round2(payload.valor),
      },
      idempotencyKey: `faturamento-pendente:${eventId}`,
      correlationId: eventId,
    });
    return;
  }

  // tz da clínica (single-table read da fundação tenancy; não é JOIN cross-context).
  const tzRows = await tx.execute<{ timezone: string | null }>(
    sql`SELECT timezone FROM clinics WHERE id = ${clinicId} LIMIT 1`,
  );
  const tz = tzRows[0]?.timezone ?? DEFAULT_TZ;

  const [row] = await tx
    .insert(lancamentos)
    .values({
      clinicId,
      unitId: payload.unitId,
      tipo: 'receber',
      descricao: atendimentoDescricao(payload.snapshotProcedureName),
      valor: round2(payload.valor).toFixed(2),
      valorPago: '0',
      status: 'pendente',
      dueDate: todayInTz(tz),
      patientId: payload.patientId,
      appointmentId: payload.appointmentId,
      createdVia: 'auto',
      snapshotProcedureName: payload.snapshotProcedureName,
      snapshotDoctorNome: payload.snapshotDoctorNome,
    })
    .onConflictDoNothing({
      target: lancamentos.appointmentId,
      where: sql`appointment_id IS NOT NULL`,
    })
    .returning({ id: lancamentos.id });

  if (!row) return; // já existia (UNIQUE appointment_id) ⇒ idempotente, não republica.

  // Resolve qualquer pendência aberta deste atendimento (recuperação de falha anterior).
  await tx
    .update(faturamentoPendencias)
    .set({ status: 'resolvida', resolvedAt: sql`now()` })
    .where(eq(faturamentoPendencias.appointmentId, payload.appointmentId));

  await publishEvent(tx, {
    clinicId,
    eventType: FINANCIAL_EVENTS.LANCAMENTO_CREATED,
    payload: {
      lancamentoId: row.id,
      clinicId,
      tipo: 'receber' as const,
      valor: round2(payload.valor),
      appointmentId: payload.appointmentId, // não-nulo → Scheduling limpa a flag
      patientId: payload.patientId,
      createdVia: 'auto' as const,
    },
    idempotencyKey: `appt-completed:${eventId}`,
    correlationId: eventId,
  });
}

registerHandler<AppointmentCompletedPayload>(SCHEDULING_EVENTS.COMPLETED, faturarAtendimento);
