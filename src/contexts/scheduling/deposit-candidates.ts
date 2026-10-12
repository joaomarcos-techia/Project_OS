/**
 * Deposit candidates (ADR-049 1.3b) — read-model PRIVILEGIADO do Scheduling.
 *
 * Irmão do `reminder-candidates`, e pelo mesmo motivo: o Scheduling é dono da
 * regra de "qual agendamento ainda pode receber cobrança de sinal". Scan
 * cross-tenant via `dbAdmin` (BYPASSRLS) — mesma justificativa dos crons
 * financeiros: rotear várias clínicas num passo só.
 *
 * O scan periódico recupera agendamentos sem cobrança mesmo após falha do worker
 * ou do gateway. Para os criados pela IA, um evento próprio antecipa a tentativa
 * e usa a leitura tenant-scoped abaixo. `scheduling.appointment.created` continua
 * reservado ao metering do Billing; o registry aceita um handler por evento.
 *
 * A regra aqui é só de AGENDA: `agendado` (quem já confirmou não precisa de sinal),
 * consulta no futuro, criado dentro da janela de varredura. Se JÁ existe cobrança,
 * quem sabe é o Payments — e é ele quem filtra.
 *
 * NÃO retorna PII: ids, valor e horário. Nome e CPF são resolvidos depois, pelo
 * seam do Patient, e só para quem realmente vai ser cobrado.
 *
 * Query pelo builder do Drizzle (e não SQL cru como o `reminder-candidates`, que
 * precisa de `AT TIME ZONE`): a lista de clínicas é um parâmetro, e parâmetro
 * concatenado em string vira injeção no dia em que a origem da lista mudar.
 */
import 'server-only';

import { and, desc, eq, gt, inArray, isNotNull, sql } from 'drizzle-orm';

import { dbAdmin } from '@/lib/db';
import { withTenant } from '@/lib/db/tenant';

import { appointments } from './schema';

export interface DepositCandidate {
  clinicId: string;
  appointmentId: string;
  patientId: string;
  /** Instante UTC (ISO) da consulta. */
  scheduledAt: string;
  /** Valor cheio do procedimento — a base do percentual do sinal. */
  valor: number;
  commercialPaymentMethod: 'pix' | 'cash' | 'credit_card' | null;
  commercialInstallmentCount: number | null;
}

/** Leitura fresca e tenant-scoped para o pedido acelerado do sinal pela IA. */
export async function lookupDepositCandidate(
  clinicId: string,
  appointmentId: string,
): Promise<DepositCandidate | null> {
  const rows = await withTenant(clinicId, (tx) =>
    tx
      .select({
        clinicId: appointments.clinicId,
        appointmentId: appointments.id,
        patientId: appointments.patientId,
        scheduledAt: appointments.scheduledAt,
        valor: appointments.valor,
        commercialPaymentMethod: appointments.commercialPaymentMethod,
        commercialInstallmentCount: appointments.commercialInstallmentCount,
      })
      .from(appointments)
      .where(
        and(
          eq(appointments.clinicId, clinicId),
          eq(appointments.id, appointmentId),
          isNotNull(appointments.patientId),
          eq(appointments.status, 'agendado'),
          gt(appointments.scheduledAt, sql`now()`),
        ),
      )
      .limit(1),
  );
  const row = rows[0];
  if (!row?.patientId) return null;
  return {
    clinicId: row.clinicId,
    appointmentId: row.appointmentId,
    patientId: row.patientId,
    scheduledAt: new Date(row.scheduledAt).toISOString(),
    valor: Number(row.valor),
    commercialPaymentMethod: row.commercialPaymentMethod,
    commercialInstallmentCount: row.commercialInstallmentCount,
  };
}

/**
 * Agendamentos elegíveis a sinal nas clínicas informadas.
 *
 * `createdWithinHours` existe para o scan não varrer a agenda inteira a cada tick.
 * A janela é generosa de propósito (padrão 24h): é ela que torna o mecanismo
 * auto-curável depois de uma indisponibilidade longa.
 */
export async function listDepositCandidates(
  clinicIds: readonly string[],
  opts?: { createdWithinHours?: number; limit?: number },
): Promise<DepositCandidate[]> {
  if (clinicIds.length === 0) return [];
  const hours = opts?.createdWithinHours ?? 24;
  const limit = opts?.limit ?? 500;

  const rows = await dbAdmin
    .select({
      clinicId: appointments.clinicId,
      appointmentId: appointments.id,
      patientId: appointments.patientId,
      scheduledAt: appointments.scheduledAt,
      valor: appointments.valor,
      commercialPaymentMethod: appointments.commercialPaymentMethod,
      commercialInstallmentCount: appointments.commercialInstallmentCount,
    })
    .from(appointments)
    .where(
      and(
        inArray(appointments.clinicId, [...clinicIds]),
        isNotNull(appointments.patientId),
        eq(appointments.status, 'agendado'),
        gt(appointments.scheduledAt, sql`now()`),
        gt(appointments.createdAt, sql`now() - (${hours}::int * interval '1 hour')`),
      ),
    )
    .orderBy(desc(appointments.createdAt))
    .limit(limit);

  return rows.flatMap((r) =>
    r.patientId === null
      ? []
      : [
          {
            clinicId: r.clinicId,
            appointmentId: r.appointmentId,
            patientId: r.patientId,
            scheduledAt: new Date(r.scheduledAt).toISOString(),
            valor: Number(r.valor),
            commercialPaymentMethod: r.commercialPaymentMethod,
            commercialInstallmentCount: r.commercialInstallmentCount,
          },
        ],
  );
}

// --- restante do atendimento (ADR-051 1.5b.3) --------------------------------

export interface RemainderCandidate {
  clinicId: string;
  appointmentId: string;
  patientId: string;
  /** Instante UTC (ISO) do atendimento concluído. */
  scheduledAt: string;
  /** Valor CHEIO do procedimento. O saldo é calculado pelo Payments. */
  valor: number;
  commercialPaymentMethod: 'pix' | 'cash' | 'credit_card' | null;
  commercialInstallmentCount: number | null;
}

/**
 * Atendimentos CONCLUÍDOS que ainda podem gerar cobrança do restante.
 *
 * A regra aqui é só de AGENDA, igual ao irmão do sinal: `atendido`, com paciente,
 * com valor, e concluído dentro da janela de varredura. **Quem sabe se já existe
 * cobrança, e quanto ainda falta, é o Payments** — este read-model não conhece
 * `patient_charges` nem `patient_credits`, e é isso que o mantém do lado certo
 * da fronteira.
 *
 * `completedWithinHours` existe para o scan não varrer o histórico inteiro a cada
 * tick. A janela é generosa de propósito: é ela que torna o mecanismo
 * auto-curável depois de uma indisponibilidade longa.
 *
 * Cross-tenant via `dbAdmin`, mesma justificativa do `listDepositCandidates`:
 * rotear várias clínicas num passo só.
 */
export async function listRemainderCandidates(
  clinicIds: readonly string[],
  opts?: { completedWithinHours?: number; limit?: number },
): Promise<RemainderCandidate[]> {
  if (clinicIds.length === 0) return [];
  const hours = opts?.completedWithinHours ?? 72;
  const limit = opts?.limit ?? 500;

  const rows = await dbAdmin
    .select({
      clinicId: appointments.clinicId,
      appointmentId: appointments.id,
      patientId: appointments.patientId,
      scheduledAt: appointments.scheduledAt,
      valor: appointments.valor,
      commercialPaymentMethod: appointments.commercialPaymentMethod,
      commercialInstallmentCount: appointments.commercialInstallmentCount,
    })
    .from(appointments)
    .where(
      and(
        inArray(appointments.clinicId, [...clinicIds]),
        isNotNull(appointments.patientId),
        eq(appointments.status, 'atendido'),
        gt(appointments.updatedAt, sql`now() - (${hours}::int * interval '1 hour')`),
      ),
    )
    .orderBy(desc(appointments.updatedAt))
    .limit(limit);

  return rows.flatMap((r) =>
    r.patientId === null
      ? []
      : [
          {
            clinicId: r.clinicId,
            appointmentId: r.appointmentId,
            patientId: r.patientId,
            scheduledAt: new Date(r.scheduledAt).toISOString(),
            valor: Number(r.valor),
            commercialPaymentMethod: r.commercialPaymentMethod,
            commercialInstallmentCount: r.commercialInstallmentCount,
          },
        ],
  );
}
