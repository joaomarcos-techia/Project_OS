/**
 * `pnpm tsx scripts/diag-c9.ts` — diagnóstico READ-ONLY do estado C9.
 * Mostra outbox (completed + financial.*), lançamentos, atendimentos atendidos e
 * pendências, para entender por que algo não apareceu no Caixa. SÓ DEV.
 */
import { assertDevContext } from './_env';

import { sql } from 'drizzle-orm';

import { dbAdmin } from '@/lib/db';

assertDevContext();

function table(rows: unknown[]): void {
  if (rows.length === 0) {
    console.log('  (vazio)');
    return;
  }
  for (const r of rows) console.log('  ', JSON.stringify(r));
}

const outbox = await dbAdmin.execute(sql`
  SELECT event_type, status, attempts, error_code, left(coalesce(last_error,''), 160) AS last_error,
         to_char(created_at, 'HH24:MI:SS') AS created,
         to_char(next_attempt_at, 'HH24:MI:SS') AS next_attempt,
         payload->>'appointmentId' AS appt, clinic_id::text AS clinic
    FROM outbox
   WHERE event_type IN ('scheduling.appointment.completed','financial.lancamento.created',
                        'financial.faturamento.pendente','financial.lancamento.paid')
   ORDER BY created_at DESC
   LIMIT 30
`);
console.log('\n=== OUTBOX (completed + financial.*) ===');
table(outbox as unknown as unknown[]);

const lanc = await dbAdmin.execute(sql`
  SELECT id::text AS id, clinic_id::text AS clinic, tipo, status, valor::text AS valor,
         created_via, appointment_id::text AS appt, descricao
    FROM lancamentos ORDER BY created_at DESC LIMIT 30
`);
console.log('\n=== LANCAMENTOS ===');
table(lanc as unknown as unknown[]);

const appts = await dbAdmin.execute(sql`
  SELECT id::text AS id, clinic_id::text AS clinic, status, faturamento_pendente AS pend,
         to_char(updated_at, 'HH24:MI:SS') AS updated
    FROM appointments WHERE status = 'atendido' ORDER BY updated_at DESC LIMIT 30
`);
console.log('\n=== APPOINTMENTS atendidos ===');
table(appts as unknown as unknown[]);

const pend = await dbAdmin.execute(sql`
  SELECT clinic_id::text AS clinic, appointment_id::text AS appt, status, motivo
    FROM faturamento_pendencias ORDER BY created_at DESC LIMIT 30
`);
console.log('\n=== FATURAMENTO_PENDENCIAS ===');
table(pend as unknown as unknown[]);

const clinics = await dbAdmin.execute(sql`SELECT id::text AS id, slug, nome FROM clinics ORDER BY created_at`);
console.log('\n=== CLINICS ===');
table(clinics as unknown as unknown[]);

process.exit(0);
