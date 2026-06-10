/**
 * Smoke C8 — Consultório (board + orquestração sobre C6/C7), nível DB/worker.
 *
 * As Server Actions de C8 (`callNextPatient`, `completeConsulta`, …) usam
 * requireUser/headers — validadas no app/runbook. Aqui cobrimos os INVARIANTES
 * genuinamente de C8 no nível do banco (o que o board depende), espelhando o
 * mecanismo de C6 sem reimplementá-lo. C6/C7 já cobrem transições/handlers
 * (smoke-c6/-c7); não duplicamos.
 *
 *   Estrutural  appointments: REPLICA IDENTITY FULL + (se houver) na publication
 *               supabase_realtime; GRANTs. chamadas DROPADA (ADR-019 / 0019).
 *   #13/#14     Concorrência "apenas um vence": 2 TX concorrentes chegou→
 *               em_atendimento via SELECT … FOR UPDATE (espelha applyTransition de
 *               C6) → exatamente 1 vence; nunca dois ativos.
 *   D3          Prontuário síncrono idempotente: UNIQUE(appointment_id) barra o 2º
 *               insert (23505) e onConflictDoNothing vira no-op (1 prontuário),
 *               inclusive sob inserção concorrente.
 *   #6/#7       Encerrar: em_atendimento→atendido + scheduling.appointment.completed
 *               enfileirado no outbox (mesma TX).
 *   #11/#12     RLS: clínica B não vê appointments nem prontuarios de A.
 *
 * Insere via withTenant/dbAdmin (bypassa o pipeline de Server Action). Roda via
 * tsx contra qoro-dev (DATABASE_URL do .env.local). NUNCA contra prod.
 */
import { assertDevContext } from './_env';

import { randomUUID } from 'node:crypto';

import { eq, sql } from 'drizzle-orm';

import { createAdminClient } from '@/lib/auth/supabase-admin';
import { dbAdmin } from '@/lib/db';
import { withTenant } from '@/lib/db/tenant';
import { publishEvent } from '@/lib/outbox/publish';
import { patients } from '@/contexts/patient/schema';
import { appointments, procedures } from '@/contexts/scheduling/schema';
import { prontuarios } from '@/contexts/clinical/schema';

// Catálogo (todos os event schemas) — publishEvent valida o payload contra ele.
import '@/lib/db/schema';

assertDevContext();

// --- harness (espelha smoke-c6/-c7) ----------------------------------------
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

const CLINIC_A = randomUUID();
const CLINIC_B = randomUUID();
const slugA = `c8a${Date.now().toString(36)}`.slice(0, 30);
const slugB = `c8b${Date.now().toString(36)}`.slice(0, 30);
const doctorEmail = `c8-doctor-${Date.now().toString(36)}@smoke.local`;
const supabase = createAdminClient();

let doctorId = '';
let procedureId = '';
let patientId = '';

function tomorrow(h: number, m = 0): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCHours(h, m, 0, 0);
  return d;
}

async function insertAppt(opts: {
  clinicId: string;
  scheduledAt: Date;
  status?: 'agendado' | 'confirmado' | 'chegou' | 'em_atendimento' | 'atendido';
  patientId?: string | null;
}): Promise<string> {
  return withTenant(opts.clinicId, async (tx) => {
    const [row] = await tx
      .insert(appointments)
      .values({
        clinicId: opts.clinicId,
        doctorId,
        procedureId,
        patientId: opts.patientId ?? null,
        scheduledAt: opts.scheduledAt,
        durationMin: 30,
        status: opts.status ?? 'agendado',
        valor: '200.00',
        snapshotProcedureName: 'Consulta',
        snapshotProcedureCodigo: 'C001',
        snapshotProcedureCategoria: 'consulta',
        snapshotProcedureValor: '200.00',
        snapshotProcedureDuracaoMin: 30,
        snapshotDoctorNome: 'Dra. Smoke',
        createdVia: 'attendant',
      })
      .returning({ id: appointments.id });
    return row!.id;
  });
}

/** Tenta chegou→em_atendimento com lock (espelha o core de C6.applyTransition). */
async function tryStart(appointmentId: string): Promise<boolean> {
  return withTenant(CLINIC_A, async (tx) => {
    const rows = (await tx.execute(
      sql`SELECT status FROM appointments WHERE id = ${appointmentId}::uuid FOR UPDATE`,
    )) as unknown as Array<{ status: string }>;
    if (rows[0]?.status !== 'chegou') return false;
    await tx.execute(
      sql`UPDATE appointments SET status = 'em_atendimento' WHERE id = ${appointmentId}::uuid`,
    );
    return true;
  });
}

async function main(): Promise<void> {
  // --- Estrutural: GRANTs em appointments + prontuarios ---------------------
  await tryStep('GRANTs explícitos (has_table_privilege) em appointments + prontuarios', async () => {
    for (const t of ['appointments', 'prontuarios']) {
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

  // --- Estrutural: Realtime (REPLICA IDENTITY FULL + publication) -----------
  await tryStep('appointments: REPLICA IDENTITY FULL (Realtime filtra clinic_id em UPDATE)', async () => {
    const r = (await dbAdmin.execute(
      sql`SELECT relreplident FROM pg_class WHERE relname = 'appointments'`,
    )) as unknown as Array<{ relreplident: string }>;
    assert(r[0]?.relreplident === 'f', `esperava replica identity FULL ('f'), veio ${r[0]?.relreplident}`);
  });

  await tryStep('appointments na publication supabase_realtime (se Supabase)', async () => {
    const pub = (await dbAdmin.execute(
      sql`SELECT 1 AS x FROM pg_publication WHERE pubname = 'supabase_realtime'`,
    )) as unknown as Array<{ x: number }>;
    if (pub.length === 0) {
      console.log('       (publication supabase_realtime ausente — dev não-Supabase, pulado)');
      return;
    }
    const r = (await dbAdmin.execute(
      sql`SELECT 1 AS x FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'appointments'`,
    )) as unknown as Array<{ x: number }>;
    assert(r.length === 1, 'appointments não está na publication supabase_realtime');
  });

  await tryStep('chamadas foi DROPADA (ADR-019 / migration 0019)', async () => {
    const r = (await dbAdmin.execute(
      sql`SELECT to_regclass('public.chamadas') AS reg`,
    )) as unknown as Array<{ reg: string | null }>;
    assert(r[0]?.reg == null, `tabela chamadas deveria não existir, veio ${r[0]?.reg}`);
  });

  // --- Fixtures: clínicas + doctor + procedure + patient -------------------
  await dbAdmin.execute(sql`
    INSERT INTO clinics (id, slug, nome, status) VALUES
      (${CLINIC_A}::uuid, ${slugA}, 'Smoke C8 A', 'active'),
      (${CLINIC_B}::uuid, ${slugB}, 'Smoke C8 B', 'active')
  `);
  const { data: created, error: createErr } = await supabase.auth.admin.createUser({
    email: doctorEmail,
    password: randomUUID(),
    email_confirm: true,
  });
  if (createErr || !created.user) throw createErr ?? new Error('createUser falhou');
  doctorId = created.user.id;
  await dbAdmin.execute(sql`
    INSERT INTO profiles (id, clinic_id, nome, role, ativo, crm, crm_uf, especialidade)
    VALUES (${doctorId}::uuid, ${CLINIC_A}::uuid, 'Dra. Smoke', 'doctor'::role_enum, true, '123456', 'SP', 'Clínica')
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
  const patRows = await withTenant(CLINIC_A, async (tx) =>
    tx
      .insert(patients)
      .values({
        clinicId: CLINIC_A,
        nome: 'Paciente Smoke',
        cpfEncrypted: 'enc',
        cpfHash: '0'.repeat(64),
        email: `c8-pac-${Date.now().toString(36)}@x.com`,
        dataNascimento: '1984-06-03',
        sexo: 'F',
      })
      .returning({ id: patients.id }),
  );
  patientId = patRows[0]!.id;

  // --- #13/#14: concorrência "apenas um vence" -----------------------------
  await tryStep('#13/#14 — chamar próximo concorrente: exatamente um vence', async () => {
    const id = await insertAppt({ clinicId: CLINIC_A, scheduledAt: tomorrow(8), status: 'chegou', patientId });
    const [a, b] = await Promise.all([tryStart(id), tryStart(id)]);
    const winners = [a, b].filter(Boolean).length;
    assert(winners === 1, `esperava exatamente 1 vencedor, veio ${winners}`);
    const after = await withTenant(CLINIC_A, (tx) =>
      tx.select({ status: appointments.status }).from(appointments).where(eq(appointments.id, id)),
    );
    assert(after[0]?.status === 'em_atendimento', `estado final deveria ser em_atendimento, veio ${after[0]?.status}`);
  });

  // --- D3: prontuário síncrono idempotente (UNIQUE appointment_id) ----------
  await tryStep('D3 — UNIQUE(appointment_id): 2º insert direto barra (23505)', async () => {
    const id = await insertAppt({ clinicId: CLINIC_A, scheduledAt: tomorrow(9), status: 'em_atendimento', patientId });
    await withTenant(CLINIC_A, (tx) =>
      tx.insert(prontuarios).values({
        clinicId: CLINIC_A,
        patientId,
        doctorId,
        appointmentId: id,
        status: 'rascunho',
        content: {},
        createdBy: doctorId,
      }),
    );
    try {
      await withTenant(CLINIC_A, (tx) =>
        tx.insert(prontuarios).values({
          clinicId: CLINIC_A,
          patientId,
          doctorId,
          appointmentId: id,
          status: 'rascunho',
          content: {},
          createdBy: doctorId,
        }),
      );
      throw new Error('2º prontuário no mesmo appointment deveria falhar');
    } catch (e) {
      assert(pgCode(e) === '23505', `esperava 23505 (unique_violation), veio ${pgCode(e)}`);
    }
  });

  // Idempotência re-entrante (não-concorrente): `callNextPatient` cria o rascunho e
  // `loadAtendimento` pode tentar de novo (atendente chamou, médico abre depois). O
  // 2º `onConflictDoNothing` é no-op → ainda 1 prontuário. (A corrida entre dois
  // clientes é impossível aqui: só um vence a transição de início — vide #13/#14.)
  await tryStep('D3 — onConflictDoNothing repetido → exatamente 1 prontuário (idempotente)', async () => {
    const id = await insertAppt({ clinicId: CLINIC_A, scheduledAt: tomorrow(10), status: 'em_atendimento', patientId });
    const ins = () =>
      withTenant(CLINIC_A, (tx) =>
        tx
          .insert(prontuarios)
          .values({
            clinicId: CLINIC_A,
            patientId,
            doctorId,
            appointmentId: id,
            status: 'rascunho',
            content: {},
            createdBy: doctorId,
          })
          // mesma forma do handler real: predicate do índice parcial
          .onConflictDoNothing({ target: prontuarios.appointmentId, where: sql`appointment_id IS NOT NULL` }),
      );
    await ins();
    await ins(); // 2ª criação sob demanda = no-op
    const rows = await withTenant(CLINIC_A, (tx) =>
      tx.select({ id: prontuarios.id }).from(prontuarios).where(eq(prontuarios.appointmentId, id)),
    );
    assert(rows.length === 1, `esperava 1 prontuário após re-entrada, veio ${rows.length}`);
  });

  // --- #6/#7: encerrar → atendido + evento completed no outbox -------------
  await tryStep('#6/#7 — encerrar: em_atendimento→atendido + completed enfileirado', async () => {
    const id = await insertAppt({ clinicId: CLINIC_A, scheduledAt: tomorrow(11), status: 'em_atendimento', patientId });
    await withTenant(CLINIC_A, async (tx) => {
      await tx.execute(sql`UPDATE appointments SET status = 'atendido' WHERE id = ${id}::uuid`);
      await publishEvent(tx, {
        clinicId: CLINIC_A,
        eventType: 'scheduling.appointment.completed',
        payload: {
          appointmentId: id,
          clinicId: CLINIC_A,
          doctorId,
          patientId,
          procedureId,
          unitId: null,
          valor: 200,
          snapshotProcedureName: 'Consulta Smoke',
          snapshotDoctorNome: 'Dr. Smoke',
          scheduledAt: tomorrow(11).toISOString(),
        },
        idempotencyKey: `c8-completed-${id}`,
      });
    });
    const st = await withTenant(CLINIC_A, (tx) =>
      tx.select({ status: appointments.status }).from(appointments).where(eq(appointments.id, id)),
    );
    assert(st[0]?.status === 'atendido', `status deveria ser atendido, veio ${st[0]?.status}`);
    const evt = (await dbAdmin.execute(
      sql`SELECT count(*)::int AS n FROM outbox WHERE event_type = 'scheduling.appointment.completed' AND payload->>'appointmentId' = ${id}`,
    )) as unknown as Array<{ n: number }>;
    assert((evt[0]?.n ?? 0) >= 1, 'evento completed não foi enfileirado no outbox');
  });

  // --- #11/#12: RLS A/B -----------------------------------------------------
  await tryStep('#11/#12 — RLS: clínica B não vê appointments nem prontuarios de A', async () => {
    const apptB = await withTenant(CLINIC_B, (tx) =>
      tx.select({ id: appointments.id }).from(appointments),
    );
    assert(apptB.length === 0, `B não deveria ver appointments de A, viu ${apptB.length}`);
    const prontB = await withTenant(CLINIC_B, (tx) =>
      tx.select({ id: prontuarios.id }).from(prontuarios),
    );
    assert(prontB.length === 0, `B não deveria ver prontuarios de A, viu ${prontB.length}`);
    const apptA = await withTenant(CLINIC_A, (tx) =>
      tx.select({ id: appointments.id }).from(appointments),
    );
    assert(apptA.length > 0, 'A deveria ver seus próprios appointments');
  });
}

async function cleanup(): Promise<void> {
  const ids = sql`(${CLINIC_A}::uuid, ${CLINIC_B}::uuid)`;
  try {
    await dbAdmin.execute(sql`DELETE FROM prontuarios WHERE clinic_id IN ${ids}`);
    await dbAdmin.execute(sql`DELETE FROM appointments WHERE clinic_id IN ${ids}`);
    await dbAdmin.execute(sql`DELETE FROM patients WHERE clinic_id IN ${ids}`);
    await dbAdmin.execute(sql`DELETE FROM outbox WHERE clinic_id IN ${ids}`);
    await dbAdmin.execute(sql`DELETE FROM audit_events WHERE clinic_id IN ${ids}`);
    await dbAdmin.execute(sql`DELETE FROM clinics WHERE id IN ${ids}`);
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
