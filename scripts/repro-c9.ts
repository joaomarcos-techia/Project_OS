/**
 * `pnpm tsx --conditions=react-server scripts/repro-c9.ts` — repro isolado do
 * faturamento automático sobre um appointment `atendido` real. SÓ DEV.
 */
import { assertDevContext } from './_env';

import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';

import { dbAdmin } from '@/lib/db';
import { withTenant } from '@/lib/db/tenant';
import { publishEvent } from '@/lib/outbox/publish';

import '@/lib/db/schema';
import '@/app/api/cron/outbox/handlers';
import { runOutboxOnce } from '@/lib/outbox/worker';

assertDevContext();

const [appt] = (await dbAdmin.execute(sql`
  SELECT id::text AS id, clinic_id::text AS clinic, doctor_id::text AS doctor,
         patient_id::text AS patient, procedure_id::text AS procedure, unit_id::text AS unit,
         valor::text AS valor, snapshot_procedure_name AS proc_name, snapshot_doctor_nome AS doc_name,
         to_char(scheduled_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS sched
    FROM appointments WHERE status = 'atendido' ORDER BY updated_at DESC LIMIT 1
`)) as unknown as Array<{
  id: string;
  clinic: string;
  doctor: string;
  patient: string | null;
  procedure: string;
  unit: string | null;
  valor: string;
  proc_name: string;
  doc_name: string;
  sched: string;
}>;

if (!appt) {
  console.log('Nenhum appointment atendido encontrado.');
  process.exit(0);
}
console.log('appointment:', appt);

const key = `repro-${randomUUID()}`;
await withTenant(appt.clinic, (tx) =>
  publishEvent(tx, {
    clinicId: appt.clinic,
    eventType: 'scheduling.appointment.completed',
    payload: {
      appointmentId: appt.id,
      clinicId: appt.clinic,
      doctorId: appt.doctor,
      patientId: appt.patient,
      procedureId: appt.procedure,
      unitId: appt.unit,
      valor: Number(appt.valor),
      snapshotProcedureName: appt.proc_name ?? 'Consulta',
      snapshotDoctorNome: appt.doc_name ?? 'Médico',
      scheduledAt: appt.sched,
    },
    idempotencyKey: key,
  }),
);
console.log('publicado completed, key =', key, 'valor =', appt.valor);

for (let i = 0; i < 6; i++) {
  const s = await runOutboxOnce();
  console.log(
    `tick ${i}:`,
    JSON.stringify({
      processed: s.processed,
      failed: s.failed,
      skipped: s.skipped,
      empty: s.empty,
    }),
  );
}

const lanc = await dbAdmin.execute(sql`
  SELECT id::text AS id, status, valor::text AS valor, created_via, appointment_id::text AS appt
    FROM lancamentos WHERE appointment_id = ${appt.id}::uuid
`);
console.log('\nLANCAMENTOS p/ este appointment:');
console.log(JSON.stringify(lanc, null, 2));

const evts = await dbAdmin.execute(sql`
  SELECT event_type, status, attempts, error_code, left(coalesce(last_error,''),120) AS err
    FROM outbox WHERE idempotency_key = ${key} OR payload->>'appointmentId' = ${appt.id}
   ORDER BY created_at DESC LIMIT 10
`);
console.log('\nOUTBOX relacionados:');
console.log(JSON.stringify(evts, null, 2));

process.exit(0);
