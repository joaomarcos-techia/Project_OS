/**
 * Dunning candidates (C14) — read-model PRIVILEGIADO do Financial.
 *
 * O Financial é dono da regra de "o que é cobrável e vencido" (ADR review C14,
 * C1/C2): `pending ≠ inadimplente`. Aqui = recebível `pendente`, com `due_date`
 * preenchido e VENCIDO por dias-calendário no tz da clínica (C2: due_date NULL
 * nunca entra). Scan cross-tenant via dbAdmin (BYPASSRLS) — mesma justificativa
 * do cron billing-dunning. Sem PII (só ids + snapshot operacional).
 *
 * `daysOverdue` é dia-CALENDÁRIO no tz da clínica (ADR-2), computado em SQL via
 * `AT TIME ZONE`. O cron escolhe lembrete automático (D+3 / D+7) ou encaminha
 * dívidas antigas para o fluxo persistido de cobrança manual.
 */
import 'server-only';

import { sql } from 'drizzle-orm';

import { dbAdmin } from '@/lib/db';

export interface DunningCandidate {
  clinicId: string;
  lancamentoId: string;
  patientId: string;
  valor: number;
  /** Vencimento YYYY-MM-DD. */
  dueDate: string;
  /** Dias-calendário vencidos no tz da clínica. */
  daysOverdue: number;
  procedureNome: string | null;
  timezone: string;
}

export async function listDunningCandidates(limit = 500): Promise<DunningCandidate[]> {
  const rows = (await dbAdmin.execute(
    sql`WITH ranked AS (
        SELECT l.clinic_id::text                                          AS clinic_id,
               l.id::text                                                 AS lancamento_id,
               l.patient_id::text                                         AS patient_id,
               (l.valor - l.valor_pago)                                   AS valor,
               l.due_date::text                                           AS due_date,
               ((now() AT TIME ZONE c.timezone)::date - l.due_date)::int  AS days_overdue,
               l.snapshot_procedure_name                                  AS procedure_nome,
               c.timezone                                                 AS timezone,
               row_number() OVER (
                 PARTITION BY l.clinic_id ORDER BY l.due_date, l.created_at, l.id
               )                                                          AS clinic_rank
          FROM lancamentos l
          JOIN clinics c ON c.id = l.clinic_id
          JOIN patients p ON p.id = l.patient_id AND p.clinic_id = l.clinic_id
         WHERE l.tipo = 'receber'
           AND l.status IN ('pendente', 'parcial')
           AND l.valor > l.valor_pago
           AND l.patient_id IS NOT NULL
           AND p.deleted_at IS NULL
           AND p.obito_em IS NULL
           AND l.due_date IS NOT NULL
           AND ((now() AT TIME ZONE c.timezone)::date - l.due_date) >= 3
        )
        SELECT clinic_id, lancamento_id, patient_id, valor, due_date, days_overdue,
               procedure_nome, timezone
          FROM ranked
         ORDER BY clinic_rank, due_date, clinic_id, lancamento_id
         LIMIT ${limit}`,
  )) as unknown as Array<{
    clinic_id: string;
    lancamento_id: string;
    patient_id: string;
    valor: string | number;
    due_date: string;
    days_overdue: number;
    procedure_nome: string | null;
    timezone: string;
  }>;

  return rows.map((r) => ({
    clinicId: r.clinic_id,
    lancamentoId: r.lancamento_id,
    patientId: r.patient_id,
    valor: Number(r.valor),
    dueDate: r.due_date,
    daysOverdue: Number(r.days_overdue),
    procedureNome: r.procedure_nome,
    timezone: r.timezone,
  }));
}

/** Read-model privilegiado mínimo; mutações usam o seam tenant-bound de collection cases. */
export async function listOpenCollectionCaseClinicIds(): Promise<string[]> {
  const rows = (await dbAdmin.execute(
    sql`SELECT DISTINCT clinic_id::text AS clinic_id
          FROM collection_cases
         WHERE status = 'open'
         ORDER BY clinic_id`,
  )) as unknown as Array<{ clinic_id: string }>;
  return rows.map((row) => row.clinic_id);
}
