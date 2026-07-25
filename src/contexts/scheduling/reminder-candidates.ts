/**
 * Reminder candidates (C14) — read-model PRIVILEGIADO do Scheduling.
 *
 * O Scheduling é dono da regra de "qual consulta precisa de lembrete D-1"
 * (ADR review C14, C5/ADR-1): consultas ATIVAS cuja data-calendário LOCAL é
 * amanhã. Scan cross-tenant via dbAdmin (BYPASSRLS) — mesma justificativa dos
 * crons financeiros/billing: roteamento por todas as clínicas num passo. NÃO
 * retorna PII (só ids + snapshot operacional); contato do paciente é resolvido
 * depois, por clínica, em withTenant.
 *
 * Idempotência semântica (ADR-1): a query é função pura do estado atual — uma
 * consulta cancelada/remarcada/atendida some dos candidatos. O dedup_key do job
 * (reminder:{appointmentId}) garante uma linha; o guard de send-time garante um
 * lembrete por visita real.
 *
 * tz (ADR-2): a janela "amanhã" é dia-CALENDÁRIO no tz da clínica, computada em
 * SQL via `AT TIME ZONE` (não horas UTC).
 */
import 'server-only';

import { sql } from 'drizzle-orm';

import { dbAdmin } from '@/lib/db';

export interface ReminderCandidate {
  clinicId: string;
  appointmentId: string;
  patientId: string;
  /** Instante UTC (ISO) da consulta. */
  scheduledAt: string;
  doctorNome: string;
  /** IANA tz da clínica (p/ computar scheduled_for 18h local no enqueue). */
  timezone: string;
}

/** Consultas ativas cuja data local é amanhã (limite p/ bound do scan). */
export async function listReminderCandidates(limit = 500): Promise<ReminderCandidate[]> {
  const rows = (await dbAdmin.execute(
    sql`WITH ranked AS (
        SELECT a.clinic_id::text                         AS clinic_id,
               a.id::text                                AS appointment_id,
               a.patient_id::text                        AS patient_id,
               a.scheduled_at                            AS scheduled_at,
               a.snapshot_doctor_nome                    AS doctor_nome,
               c.timezone                                AS timezone,
               row_number() OVER (
                 PARTITION BY a.clinic_id ORDER BY a.scheduled_at, a.id
               )                                         AS clinic_rank
          FROM appointments a
          JOIN clinics c ON c.id = a.clinic_id
         WHERE a.patient_id IS NOT NULL
           AND a.status IN ('agendado', 'confirmado')
           AND (a.scheduled_at AT TIME ZONE c.timezone)::date
               = ((now() AT TIME ZONE c.timezone)::date + 1)
        )
        SELECT clinic_id, appointment_id, patient_id, scheduled_at, doctor_nome, timezone
          FROM ranked
         ORDER BY clinic_rank, scheduled_at, clinic_id, appointment_id
         LIMIT ${limit}`,
  )) as unknown as Array<{
    clinic_id: string;
    appointment_id: string;
    patient_id: string;
    scheduled_at: Date | string;
    doctor_nome: string;
    timezone: string;
  }>;

  return rows.map((r) => ({
    clinicId: r.clinic_id,
    appointmentId: r.appointment_id,
    patientId: r.patient_id,
    scheduledAt: r.scheduled_at instanceof Date ? r.scheduled_at.toISOString() : r.scheduled_at,
    doctorNome: r.doctor_nome,
    timezone: r.timezone,
  }));
}
