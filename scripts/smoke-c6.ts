/**
 * Smoke C6 — validação pós-migration 0015/0016 (Scheduling Core).
 *
 * Cobre os testes 6.6.x DB-level que NÃO dependem de sessão HTTP (Server Actions
 * usam requireUser/headers — validados no app/runbook):
 *   6.6.1  race/overlap: 2 appts no mesmo slot → 2º falha (23505/23P01)
 *   R12    overlap de doctor_availability → 23P01
 *   6.6.2  snapshot imutável (trigger barra UPDATE de snapshot_*)
 *   M8     crm/especialidade: backfill único NULL→valor, depois congela
 *   6.6.4  cancelamento libera slot (slot_occupies_instant flip)
 *   6.6.5  walk-in coexiste (isento do EXCLUDE; scheduled_at distinto)
 *   6.6.8  RLS — clínica A não enxerga appointment de B
 *   FK     procedure com appointment não pode ser deletado (RESTRICT)
 *   GRANTs explícitos nas 6 tabelas
 *
 * Insere via withTenant tx (bypassa o pipeline de Server Action). Roda via tsx
 * contra qoro-dev (DATABASE_URL do .env.local). NUNCA contra prod.
 */
import { assertDevContext } from './_env';

import { randomUUID } from 'node:crypto';

import { and, eq, gte, lt, sql } from 'drizzle-orm';

import { createAdminClient } from '@/lib/auth/supabase-admin';
import { dbAdmin } from '@/lib/db';
import { withTenant } from '@/lib/db/tenant';
import { publishEvent } from '@/lib/outbox/publish';
import { runOutboxOnce } from '@/lib/outbox/worker';
import { patients } from '@/contexts/patient/schema';
import { appointments, doctorAvailability, procedures } from '@/contexts/scheduling/schema';

// Catálogo (todos os event schemas) + registro dos handlers de Scheduling para o
// worker dispatch (6.6.6 / 6.6.7 rodam pelo dbWorker, sem requireUser).
import '@/lib/db/schema';
import '@/contexts/scheduling/internal/handlers/patient-deleted';
import '@/contexts/scheduling/internal/handlers/appointment-completed-temp';

assertDevContext();

// --- harness ---------------------------------------------------------------
type Result = { name: string; ok: boolean; detail?: string };
const results: Result[] = [];
function record(name: string, ok: boolean, detail?: string): void {
  results.push(detail === undefined ? { name, ok } : { name, ok, detail });
  console.log(ok ? `[OK]   ${name}` : `[FAIL] ${name}${detail ? `\n       ${detail}` : ''}`);
}
async function tryStep(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    record(name, true);
  } catch (e) {
    record(name, false, e instanceof Error ? e.message : String(e));
  }
}
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}
function pgCode(e: unknown): string | undefined {
  let cur: unknown = e;
  for (let i = 0; i < 5 && cur; i++) {
    const c = (cur as { code?: string }).code;
    if (typeof c === 'string') return c;
    cur = (cur as { cause?: unknown }).cause;
  }
  return undefined;
}
/** Roda o worker até `done()` ou esgotar os ticks (eventos podem dividir batches). */
async function processUntil(done: () => Promise<boolean>, maxTicks = 8): Promise<boolean> {
  for (let i = 0; i < maxTicks; i++) {
    if (await done()) return true;
    await runOutboxOnce();
  }
  return done();
}

const CLINIC_A = randomUUID();
const CLINIC_B = randomUUID();
const slugA = `c6a${Date.now().toString(36)}`.slice(0, 30);
const slugB = `c6b${Date.now().toString(36)}`.slice(0, 30);
const doctorEmail = `c6-doctor-${Date.now().toString(36)}@smoke.local`;
const supabase = createAdminClient();

let doctorId = '';
let procedureId = '';

// Insert an appointment directly (bypasses Server Action; trigger is BEFORE UPDATE).
async function insertAppt(opts: {
  clinicId: string;
  scheduledAt: string | Date;
  durationMin?: number;
  status?: string;
  createdVia?: string;
  patientId?: string;
}): Promise<string> {
  return withTenant(opts.clinicId, async (tx) => {
    const [row] = await tx
      .insert(appointments)
      .values({
        clinicId: opts.clinicId,
        doctorId,
        procedureId,
        patientId: opts.patientId ?? null,
        scheduledAt: typeof opts.scheduledAt === 'string' ? new Date(opts.scheduledAt) : opts.scheduledAt,
        durationMin: opts.durationMin ?? 30,
        status: (opts.status ?? 'agendado') as 'agendado',
        valor: '200.00',
        snapshotProcedureName: 'Consulta',
        snapshotProcedureCodigo: 'C001',
        snapshotProcedureCategoria: 'consulta',
        snapshotProcedureValor: '200.00',
        snapshotProcedureDuracaoMin: 30,
        snapshotDoctorNome: 'Dr. Smoke',
        createdVia: (opts.createdVia ?? 'attendant') as 'attendant',
      })
      .returning({ id: appointments.id });
    return row!.id;
  });
}

async function main(): Promise<void> {
  // GRANTs nas 6 tabelas.
  await tryStep('GRANTs explícitos (has_table_privilege) nas 6 tabelas', async () => {
    const tables = [
      'procedures',
      'procedure_history',
      'doctor_availability',
      'clinic_holidays',
      'appointments',
      'appointment_state_log',
    ];
    for (const t of tables) {
      for (const role of ['authenticated', 'service_role']) {
        for (const priv of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
          const r = (await dbAdmin.execute(
            sql`SELECT has_table_privilege(${role}, ${`public.${t}`}, ${priv}) AS ok`,
          )) as unknown as Array<{ ok: boolean }>;
          assert(r[0]?.ok === true, `${role} sem ${priv} em ${t}`);
        }
      }
    }
  });

  // Fixtures: clínicas + doctor + procedure.
  await dbAdmin.execute(sql`
    INSERT INTO clinics (id, slug, nome, status) VALUES
      (${CLINIC_A}::uuid, ${slugA}, 'Smoke C6 A', 'active'),
      (${CLINIC_B}::uuid, ${slugB}, 'Smoke C6 B', 'active')
  `);
  const { data: created, error: createErr } = await supabase.auth.admin.createUser({
    email: doctorEmail,
    password: randomUUID(),
    email_confirm: true,
  });
  if (createErr || !created.user) throw createErr ?? new Error('createUser falhou');
  doctorId = created.user.id;
  await dbAdmin.execute(sql`
    INSERT INTO profiles (id, clinic_id, nome, role, ativo)
    VALUES (${doctorId}::uuid, ${CLINIC_A}::uuid, 'Dr. Smoke', 'doctor'::role_enum, true)
    ON CONFLICT (id) DO UPDATE SET clinic_id = ${CLINIC_A}::uuid
  `);
  const procRows = await withTenant(CLINIC_A, async (tx) =>
    tx
      .insert(procedures)
      .values({
        clinicId: CLINIC_A,
        codigo: 'C001',
        descricao: 'Consulta',
        categoria: 'consulta',
        valorPadrao: '200.00',
        duracaoPadraoMin: 30,
      })
      .returning({ id: procedures.id }),
  );
  procedureId = procRows[0]!.id;

  const tomorrow = (h: number, m = 0) => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + 1);
    d.setUTCHours(h, m, 0, 0);
    return d;
  };

  await tryStep('6.6.1 — exato mesmo slot bloqueado (23505/23P01)', async () => {
    await insertAppt({ clinicId: CLINIC_A, scheduledAt: tomorrow(13) });
    try {
      await insertAppt({ clinicId: CLINIC_A, scheduledAt: tomorrow(13) });
      throw new Error('2º agendamento no mesmo instante deveria falhar');
    } catch (e) {
      const code = pgCode(e);
      assert(code === '23505' || code === '23P01', `esperava 23505/23P01, veio ${code}`);
    }
  });

  await tryStep('6.6.1b — overlap de faixa bloqueado pelo EXCLUDE (23P01)', async () => {
    await insertAppt({ clinicId: CLINIC_A, scheduledAt: tomorrow(14), durationMin: 30 });
    try {
      await insertAppt({ clinicId: CLINIC_A, scheduledAt: tomorrow(14, 15), durationMin: 30 });
      throw new Error('appt sobreposto deveria falhar');
    } catch (e) {
      assert(pgCode(e) === '23P01', `esperava 23P01, veio ${pgCode(e)}`);
    }
  });

  await tryStep('R12 — overlap de doctor_availability bloqueado (23P01)', async () => {
    await withTenant(CLINIC_A, (tx) =>
      tx.insert(doctorAvailability).values({
        clinicId: CLINIC_A,
        doctorId,
        weekday: 1,
        startTime: '08:00',
        endTime: '12:00',
      }),
    );
    try {
      await withTenant(CLINIC_A, (tx) =>
        tx.insert(doctorAvailability).values({
          clinicId: CLINIC_A,
          doctorId,
          weekday: 1,
          startTime: '10:00',
          endTime: '14:00',
        }),
      );
      throw new Error('janela sobreposta deveria falhar');
    } catch (e) {
      assert(pgCode(e) === '23P01', `esperava 23P01, veio ${pgCode(e)}`);
    }
  });

  await tryStep('6.6.2 — snapshot imutável (trigger barra UPDATE)', async () => {
    const id = await insertAppt({ clinicId: CLINIC_A, scheduledAt: tomorrow(9) });
    try {
      await withTenant(CLINIC_A, (tx) =>
        tx.update(appointments).set({ snapshotProcedureValor: '300.00' }).where(eq(appointments.id, id)),
      );
      throw new Error('UPDATE de snapshot deveria falhar');
    } catch (e) {
      assert(pgCode(e) === '23514', `esperava 23514 (check_violation), veio ${pgCode(e)}`);
    }
  });

  await tryStep('M8 — crm: backfill único NULL→valor, depois congela', async () => {
    const id = await insertAppt({ clinicId: CLINIC_A, scheduledAt: tomorrow(10) });
    await withTenant(CLINIC_A, (tx) =>
      tx.update(appointments).set({ snapshotDoctorCrm: 'CRM-12345' }).where(eq(appointments.id, id)),
    ); // NULL→valor: permitido
    try {
      await withTenant(CLINIC_A, (tx) =>
        tx.update(appointments).set({ snapshotDoctorCrm: 'CRM-99999' }).where(eq(appointments.id, id)),
      );
      throw new Error('2ª mudança de crm deveria falhar');
    } catch (e) {
      assert(pgCode(e) === '23514', `esperava 23514, veio ${pgCode(e)}`);
    }
  });

  await tryStep('6.6.4 — cancelamento libera slot', async () => {
    const id = await insertAppt({ clinicId: CLINIC_A, scheduledAt: tomorrow(16) });
    // mesmo slot bloqueado enquanto ativo
    let blocked = false;
    try {
      await insertAppt({ clinicId: CLINIC_A, scheduledAt: tomorrow(16) });
    } catch {
      blocked = true;
    }
    assert(blocked, 'slot deveria estar bloqueado antes do cancelamento');
    await withTenant(CLINIC_A, (tx) =>
      tx.update(appointments).set({ status: 'cancelado' }).where(eq(appointments.id, id)),
    );
    // agora o mesmo slot deve aceitar (slot_occupies_instant=false no cancelado)
    await insertAppt({ clinicId: CLINIC_A, scheduledAt: tomorrow(16) });
  });

  await tryStep('6.6.5 — walk-in coexiste sobreposto (isento do EXCLUDE)', async () => {
    await insertAppt({ clinicId: CLINIC_A, scheduledAt: tomorrow(11), durationMin: 30 });
    // Walk-in às 11:15 — DENTRO da faixa [11:00,11:30] do regular. created_via='walkin'
    // → slot_blocks_overlap=false → EXCLUDE não bloqueia. scheduled_at distinto (11:15
    // ≠ 11:00) → UNIQUE de instante exato também não colide. (O action real usa now(),
    // microssegundos, então instantes sempre diferem.)
    await insertAppt({
      clinicId: CLINIC_A,
      scheduledAt: tomorrow(11, 15),
      status: 'chegou',
      createdVia: 'walkin',
    });
    const rows = await withTenant(CLINIC_A, (tx) =>
      tx
        .select({ id: appointments.id })
        .from(appointments)
        .where(
          and(
            eq(appointments.doctorId, doctorId),
            gte(appointments.scheduledAt, tomorrow(11)),
            lt(appointments.scheduledAt, tomorrow(12)),
          ),
        ),
    );
    assert(rows.length === 2, `esperava 2 appts coexistindo, veio ${rows.length}`);
  });

  await tryStep('FK — procedure com appointment não pode ser deletado (RESTRICT)', async () => {
    try {
      await withTenant(CLINIC_A, (tx) =>
        tx.delete(procedures).where(eq(procedures.id, procedureId)),
      );
      throw new Error('DELETE de procedure com appointments deveria falhar');
    } catch (e) {
      assert(pgCode(e) === '23503', `esperava 23503 (fk_violation), veio ${pgCode(e)}`);
    }
  });

  await tryStep('6.6.8 — RLS: clínica B não enxerga appointment de A', async () => {
    const fromB = await withTenant(CLINIC_B, (tx) =>
      tx.select({ id: appointments.id }).from(appointments),
    );
    assert(fromB.length === 0, `B não deveria ver nenhum appt de A, viu ${fromB.length}`);
    const fromA = await withTenant(CLINIC_A, (tx) =>
      tx.select({ id: appointments.id }).from(appointments),
    );
    assert(fromA.length > 0, 'A deveria ver seus próprios appointments');
  });

  await tryStep('6.6.6 — appointment.completed processado pelo worker (handler temp)', async () => {
    const id = await insertAppt({ clinicId: CLINIC_A, scheduledAt: tomorrow(7), status: 'em_atendimento' });
    const idemKey = `smoke-completed-${id}`;
    await withTenant(CLINIC_A, (tx) =>
      publishEvent(tx, {
        clinicId: CLINIC_A,
        eventType: 'scheduling.appointment.completed',
        payload: {
          appointmentId: id,
          clinicId: CLINIC_A,
          doctorId,
          patientId: null,
          procedureId,
          valor: 200,
          scheduledAt: tomorrow(7).toISOString(),
        },
        idempotencyKey: idemKey,
      }),
    );
    const processed = await processUntil(async () => {
      const r = (await dbAdmin.execute(
        sql`SELECT status FROM outbox WHERE event_type = 'scheduling.appointment.completed' AND idempotency_key = ${idemKey} LIMIT 1`,
      )) as unknown as Array<{ status: string }>;
      return r[0]?.status === 'processed';
    });
    assert(processed, 'evento completed não chegou a status=processed');
  });

  await tryStep('6.6.7 — patient.core.deleted → worker cancela agendamentos futuros', async () => {
    const [p] = await withTenant(CLINIC_A, (tx) =>
      tx
        .insert(patients)
        .values({
          clinicId: CLINIC_A,
          nome: 'Paciente Smoke',
          cpfEncrypted: 'enc',
          cpfHash: '0'.repeat(64),
          email: `smoke-pac-${Date.now().toString(36)}@x.com`,
        })
        .returning({ id: patients.id }),
    );
    const patientId = p!.id;
    const apptId = await insertAppt({
      clinicId: CLINIC_A,
      scheduledAt: tomorrow(6),
      status: 'agendado',
      patientId,
    });
    await withTenant(CLINIC_A, (tx) =>
      publishEvent(tx, {
        clinicId: CLINIC_A,
        eventType: 'patient.core.deleted',
        payload: { patientId, clinicId: CLINIC_A, soft: true },
        idempotencyKey: `smoke-pdel-${patientId}`,
      }),
    );
    const cancelled = await processUntil(async () => {
      const r = await withTenant(CLINIC_A, (tx) =>
        tx.select({ status: appointments.status }).from(appointments).where(eq(appointments.id, apptId)),
      );
      return r[0]?.status === 'cancelado';
    });
    assert(cancelled, 'appointment futuro não foi cancelado pelo handler');
    // E o handler emitiu scheduling.appointment.cancelled com cancelReason explícito.
    const evt = (await dbAdmin.execute(
      sql`SELECT payload->>'cancelReason' AS reason FROM outbox WHERE event_type = 'scheduling.appointment.cancelled' AND payload->>'appointmentId' = ${apptId} LIMIT 1`,
    )) as unknown as Array<{ reason: string }>;
    assert(evt[0]?.reason === 'patient_deleted', `esperava cancelReason=patient_deleted, veio ${evt[0]?.reason}`);
  });
}

async function cleanup(): Promise<void> {
  try {
    // appointments primeiro (doctor_id → profiles é NO ACTION; bloquearia cascade).
    await dbAdmin.execute(
      sql`DELETE FROM appointments WHERE clinic_id IN (${CLINIC_A}::uuid, ${CLINIC_B}::uuid)`,
    );
    // outbox/audit não têm FK p/ clinics → não cascateiam; limpar manualmente.
    await dbAdmin.execute(
      sql`DELETE FROM outbox WHERE clinic_id IN (${CLINIC_A}::uuid, ${CLINIC_B}::uuid)`,
    );
    await dbAdmin.execute(
      sql`DELETE FROM audit_events WHERE clinic_id IN (${CLINIC_A}::uuid, ${CLINIC_B}::uuid)`,
    );
    await dbAdmin.execute(
      sql`DELETE FROM clinics WHERE id IN (${CLINIC_A}::uuid, ${CLINIC_B}::uuid)`,
    );
    if (doctorId) await supabase.auth.admin.deleteUser(doctorId);
  } catch (e) {
    console.error('[cleanup] erro (não fatal):', e instanceof Error ? e.message : e);
  }
}

main()
  .catch((e) => record('main() exception', false, e instanceof Error ? e.stack : String(e)))
  .finally(async () => {
    await cleanup();
    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} OK`);
    process.exit(failed.length === 0 ? 0 : 1);
  });
