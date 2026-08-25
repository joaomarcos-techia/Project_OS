/**
 * Deposit candidates (ADR-049 1.3b) — read-model PRIVILEGIADO do Scheduling.
 *
 * Irmão do `reminder-candidates`, e pelo mesmo motivo: o Scheduling é dono da
 * regra de "qual agendamento ainda pode receber cobrança de sinal". Scan
 * cross-tenant via `dbAdmin` (BYPASSRLS) — mesma justificativa dos crons
 * financeiros: rotear várias clínicas num passo só.
 *
 * **Por que um cron-scan e não um handler de evento:** `scheduling.appointment.created`
 * já tem dono (o metering do Billing) e o registry do outbox é estritamente 1
 * handler por evento — não existe fan-out. Este é o mesmo padrão que reminder e
 * dunning já usam, e ele tem uma vantagem própria: é **auto-curável**. Se o worker
 * ou o gateway ficarem fora do ar por horas, a próxima varredura pega os
 * agendamentos que ficaram sem cobrança, sem intervenção humana.
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

import { appointments } from './schema';

export interface DepositCandidate {
  clinicId: string;
  appointmentId: string;
  patientId: string;
  /** Instante UTC (ISO) da consulta. */
  scheduledAt: string;
  /** Valor cheio do procedimento — a base do percentual do sinal. */
  valor: number;
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
          },
        ],
  );
}
