import 'server-only';

import { sql } from 'drizzle-orm';

import type { Tx } from '@/lib/db';
import { withTenant } from '@/lib/db/tenant';

import { SchedulingValidationError } from '../errors';

const DEFAULT_TZ = 'America/Sao_Paulo';

/**
 * Fuso da clínica (congelado: 1 clínica = 1 tz).
 *
 * Lê `clinics.timezone` direto, dentro do tx tenant-scoped — mesmo padrão que
 * `queries.ts` já usa em `getAvailableSlots`. O helper `getClinicTimezone` vive
 * no contexto de tenancy e context→context é proibido pelos boundaries.
 */
export async function readClinicTimeZone(clinicId: string): Promise<string> {
  const rows = await withTenant(clinicId, (tx) =>
    tx.execute<{ timezone: string | null }>(
      sql`SELECT timezone FROM clinics WHERE id = ${clinicId} LIMIT 1`,
    ),
  );
  return rows[0]?.timezone ?? DEFAULT_TZ;
}

/**
 * DATA-007 — "o mesmo paciente não tem dois atendimentos ativos com o mesmo
 * profissional no mesmo dia", verificado para TODAS as ocorrências e DENTRO da
 * transação que as cria.
 *
 * ===================================================================
 * O que estava errado
 * ===================================================================
 * A guarda existia, mas na app-layer (`agenda/actions.ts`), fora da transação
 * e recebendo apenas `input.date` — a data da PRIMEIRA ocorrência. O core
 * percorria as demais sem repeti-la. O pentest criou uma consulta isolada no
 * segundo dia da futura série e depois a série: a segunda ocorrência foi aceita
 * ao lado da consulta existente, e o dia terminou com duas consultas ativas do
 * mesmo par.
 *
 * As constraints do banco não cobriam: o EXCLUDE protege colisão de HORÁRIO
 * (mesmo instante), não duplicidade diária em horários diferentes.
 *
 * ===================================================================
 * Por que dentro da transação, e com lock
 * ===================================================================
 * Fora dela, duas sessões simultâneas passariam as duas pela checagem e
 * inseririam as duas séries. O `FOR UPDATE` nas linhas existentes do par
 * serializa concorrentes pelo mesmo paciente/profissional; a checagem de
 * colisão DENTRO do lote fecha o caso de a própria série repetir um dia
 * (intervalo que cai no mesmo dia da semana já visto).
 *
 * Falha ⇒ a transação inteira reverte: zero série, zero appointment, zero
 * audit/outbox/idempotência. O EXCLUDE de horário continua como defesa
 * independente.
 */
export async function assertNoDailyDuplicate(
  tx: Tx,
  args: {
    clinicId: string;
    patientId: string;
    doctorId: string;
    timeZone: string;
    occurrences: Date[];
  },
): Promise<void> {
  const { clinicId, patientId, doctorId, timeZone, occurrences } = args;
  if (occurrences.length === 0) return;

  // Datas CIVIS das ocorrências, no fuso da clínica — é a granularidade da
  // regra ("no mesmo dia"), não o instante.
  const localDates = occurrences.map((instant) => localDate(instant, timeZone));

  // 1. Colisão DENTRO do próprio lote: uma série com intervalo que reincide no
  //    mesmo dia civil se auto-duplicaria sem que nenhuma linha existisse antes.
  const seen = new Set<string>();
  for (const [index, date] of localDates.entries()) {
    if (seen.has(date)) {
      throw new SchedulingValidationError(
        `a ocorrência ${index + 1} cai no mesmo dia (${date}) de outra ocorrência da série`,
      );
    }
    seen.add(date);
  }

  // 2. Colisão com o que JÁ existe. `FOR UPDATE` serializa duas sessões
  //    concorrentes criando séries para o mesmo par.
  const dateList = sql.join(
    localDates.map((date) => sql`${date}::date`),
    sql`, `,
  );
  const rows = (await tx.execute(sql`
    SELECT (scheduled_at AT TIME ZONE ${timeZone})::date::text AS local_date
      FROM appointments
     WHERE clinic_id = ${clinicId}::uuid
       AND patient_id = ${patientId}::uuid
       AND doctor_id = ${doctorId}::uuid
       AND status IN ('agendado', 'confirmado', 'chegou', 'em_atendimento')
       AND (scheduled_at AT TIME ZONE ${timeZone})::date IN (${dateList})
     FOR UPDATE
  `)) as unknown as Array<{ local_date: string }>;

  const clash = rows[0]?.local_date;
  if (clash) {
    const position = localDates.indexOf(clash) + 1;
    throw new SchedulingValidationError(
      `este paciente já tem um atendimento ativo com este profissional em ${clash}` +
        (position > 0 ? ` (ocorrência ${position} da série)` : ''),
    );
  }
}

/** Instante UTC → data civil 'YYYY-MM-DD' no fuso informado. */
function localDate(instant: Date, timeZone: string): string {
  // 'en-CA' formata como YYYY-MM-DD, que é exatamente o literal que o
  // PostgreSQL aceita como `date`.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}
