/**
 * Smoke C7 — validação pós-migration 0017 (Clinical Core), nível DB/worker.
 *
 * Cobre os testes que NÃO dependem de sessão HTTP (Server Actions usam
 * requireUser/headers — validados no app/runbook):
 *   #11/R9  handler scheduling.appointment.started → cria prontuário rascunho
 *           + emite clinical.prontuario.created; re-entrega NÃO duplica (idempotente)
 *   walk-in patientId=null → handler é no-op
 *   #5      imutabilidade: UPDATE direto de prontuário assinado → bloqueado (trigger)
 *   R2      bypass app.allow_signed_edit: altera só content (ok); signed_at (bloqueado)
 *   #6/R1   versionamento: arquiva revisão + bump de version (fluxo editSigned)
 *   #13     RLS — clínica B não enxerga prontuário de A
 *   GRANTs explícitos nas 4 tabelas
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
import { runOutboxOnce } from '@/lib/outbox/worker';
import { patients } from '@/contexts/patient/schema';
import { appointments, procedures } from '@/contexts/scheduling/schema';
import { prontuarioVersions, prontuarios } from '@/contexts/clinical/schema';

// Catálogo (todos os event schemas) + registro do handler de Clinical p/ o worker.
import '@/lib/db/schema';
import '@/contexts/clinical/internal/handlers/appointment-started';

assertDevContext();

// --- harness (espelha smoke-c6) --------------------------------------------
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
async function expectThrows(fn: () => Promise<unknown>, matcher: RegExp): Promise<void> {
  try {
    await fn();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    assert(matcher.test(msg), `erro não casou ${matcher}: ${msg}`);
    return;
  }
  throw new Error(`esperava throw casando ${matcher}, mas não lançou`);
}
async function processUntil(done: () => Promise<boolean>, maxTicks = 8): Promise<boolean> {
  for (let i = 0; i < maxTicks; i++) {
    if (await done()) return true;
    await runOutboxOnce();
  }
  return done();
}
async function eventProcessed(idemKey: string): Promise<boolean> {
  const r = (await dbAdmin.execute(
    sql`SELECT status FROM outbox WHERE idempotency_key = ${idemKey} LIMIT 1`,
  )) as unknown as Array<{ status: string }>;
  return r[0]?.status === 'processed' || r[0]?.status === 'skipped';
}

const CLINIC_A = randomUUID();
const CLINIC_B = randomUUID();
const slugA = `c7a${Date.now().toString(36)}`.slice(0, 30);
const slugB = `c7b${Date.now().toString(36)}`.slice(0, 30);
const doctorEmail = `c7-doctor-${Date.now().toString(36)}@smoke.local`;
const supabase = createAdminClient();

let doctorId = '';
let procedureId = '';
let patientId = '';

async function insertAppt(opts: {
  clinicId: string;
  scheduledAt: Date;
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
        status: 'em_atendimento',
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

/** Insere rascunho e assina (OLD.signed_at IS NULL ⇒ trigger não dispara). */
async function createSignedProntuario(): Promise<string> {
  return withTenant(CLINIC_A, async (tx) => {
    const [row] = await tx
      .insert(prontuarios)
      .values({
        clinicId: CLINIC_A,
        patientId,
        doctorId,
        status: 'rascunho',
        content: { queixa_principal: 'dor', conduta: 'repouso' },
        createdBy: doctorId,
      })
      .returning({ id: prontuarios.id });
    const pid = row!.id;
    await tx
      .update(prontuarios)
      .set({
        status: 'assinado',
        signedAt: new Date(),
        signedBy: doctorId,
        signedDoctorNome: 'Dra. Smoke',
        signedDoctorCrm: '123456',
        signedDoctorCrmUf: 'SP',
        rowVersion: 2,
      })
      .where(eq(prontuarios.id, pid));
    return pid;
  });
}

function tomorrow(h: number, m = 0): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCHours(h, m, 0, 0);
  return d;
}

async function main(): Promise<void> {
  await tryStep('GRANTs explícitos (has_table_privilege) nas 4 tabelas', async () => {
    const tables = ['prontuarios', 'prontuario_versions', 'prescriptions', 'medical_documents'];
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

  // Fixtures: clínicas + doctor (com CRM) + procedure + patient.
  await dbAdmin.execute(sql`
    INSERT INTO clinics (id, slug, nome, status) VALUES
      (${CLINIC_A}::uuid, ${slugA}, 'Smoke C7 A', 'active'),
      (${CLINIC_B}::uuid, ${slugB}, 'Smoke C7 B', 'active')
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
        email: `c7-pac-${Date.now().toString(36)}@x.com`,
      })
      .returning({ id: patients.id }),
  );
  patientId = patRows[0]!.id;

  // --- #11: handler appointment.started → cria rascunho + emite created -----
  let apptId = '';
  await tryStep('#11 — appointment.started → handler cria prontuário rascunho', async () => {
    apptId = await insertAppt({ clinicId: CLINIC_A, scheduledAt: tomorrow(8), patientId });
    await withTenant(CLINIC_A, (tx) =>
      publishEvent(tx, {
        clinicId: CLINIC_A,
        eventType: 'scheduling.appointment.started',
        payload: { appointmentId: apptId, clinicId: CLINIC_A, doctorId, patientId, procedureId },
        idempotencyKey: `smoke-started-${apptId}`,
      }),
    );
    const ok = await processUntil(async () => {
      const r = await withTenant(CLINIC_A, (tx) =>
        tx.select({ id: prontuarios.id, status: prontuarios.status }).from(prontuarios).where(eq(prontuarios.appointmentId, apptId)),
      );
      return r.length === 1 && r[0]?.status === 'rascunho';
    });
    assert(ok, 'handler não criou exatamente 1 prontuário rascunho para o appointment');
    const evt = (await dbAdmin.execute(
      sql`SELECT count(*)::int AS n FROM outbox WHERE event_type='clinical.prontuario.created' AND payload->>'appointmentId' = ${apptId}`,
    )) as unknown as Array<{ n: number }>;
    assert((evt[0]?.n ?? 0) >= 1, 'handler não emitiu clinical.prontuario.created');
  });

  await tryStep('#11/R9 — re-entrega NÃO duplica (idempotente)', async () => {
    const k2 = `smoke-started2-${apptId}`;
    await withTenant(CLINIC_A, (tx) =>
      publishEvent(tx, {
        clinicId: CLINIC_A,
        eventType: 'scheduling.appointment.started',
        payload: { appointmentId: apptId, clinicId: CLINIC_A, doctorId, patientId, procedureId },
        idempotencyKey: k2,
      }),
    );
    await processUntil(() => eventProcessed(k2));
    const cnt = await withTenant(CLINIC_A, (tx) =>
      tx.select({ id: prontuarios.id }).from(prontuarios).where(eq(prontuarios.appointmentId, apptId)),
    );
    assert(cnt.length === 1, `esperava 1 prontuário após re-entrega, veio ${cnt.length}`);
  });

  await tryStep('walk-in (patientId=null) → handler é no-op', async () => {
    const walkAppt = await insertAppt({ clinicId: CLINIC_A, scheduledAt: tomorrow(9), patientId: null });
    const k = `smoke-walkin-${walkAppt}`;
    await withTenant(CLINIC_A, (tx) =>
      publishEvent(tx, {
        clinicId: CLINIC_A,
        eventType: 'scheduling.appointment.started',
        payload: { appointmentId: walkAppt, clinicId: CLINIC_A, doctorId, patientId: null, procedureId },
        idempotencyKey: k,
      }),
    );
    await processUntil(() => eventProcessed(k));
    const r = await withTenant(CLINIC_A, (tx) =>
      tx.select({ id: prontuarios.id }).from(prontuarios).where(eq(prontuarios.appointmentId, walkAppt)),
    );
    assert(r.length === 0, `walk-in não deveria gerar prontuário, veio ${r.length}`);
  });

  // --- #5 / R2: imutabilidade pós-assinatura --------------------------------
  await tryStep('#5 — UPDATE direto de prontuário assinado é bloqueado pela trigger', async () => {
    const pid = await createSignedProntuario();
    await expectThrows(
      () =>
        withTenant(CLINIC_A, (tx) =>
          tx.update(prontuarios).set({ content: { conduta: 'hack' } }).where(eq(prontuarios.id, pid)),
        ),
      /imutável/,
    );
  });

  await tryStep('R2 — bypass altera só content; signed_at permanece imutável', async () => {
    const pid = await createSignedProntuario();
    // content-only com bypass: passa
    await withTenant(CLINIC_A, async (tx) => {
      await tx.execute(sql`SELECT set_config('app.allow_signed_edit','on', true)`);
      await tx.update(prontuarios).set({ content: { conduta: 'corrigido' } }).where(eq(prontuarios.id, pid));
    });
    const after = await withTenant(CLINIC_A, (tx) =>
      tx.select({ content: prontuarios.content }).from(prontuarios).where(eq(prontuarios.id, pid)),
    );
    assert((after[0]?.content as { conduta?: string })?.conduta === 'corrigido', 'content não foi corrigido com bypass');
    // signed_at com bypass: bloqueado
    await expectThrows(
      () =>
        withTenant(CLINIC_A, async (tx) => {
          await tx.execute(sql`SELECT set_config('app.allow_signed_edit','on', true)`);
          await tx.update(prontuarios).set({ signedAt: new Date(0) }).where(eq(prontuarios.id, pid));
        }),
      /apenas o conteúdo/,
    );
  });

  // --- #6 / R1: versionamento (fluxo editSigned) ----------------------------
  await tryStep('#6/R1 — editSigned arquiva revisão e incrementa version', async () => {
    const pid = await createSignedProntuario();
    await withTenant(CLINIC_A, async (tx) => {
      const [row] = await tx.select().from(prontuarios).where(eq(prontuarios.id, pid)).limit(1);
      await tx.insert(prontuarioVersions).values({
        clinicId: CLINIC_A,
        prontuarioId: pid,
        version: row!.version,
        content: row!.content,
        editedBy: doctorId,
        reason: 'smoke correção',
      });
      await tx.execute(sql`SELECT set_config('app.allow_signed_edit','on', true)`);
      await tx
        .update(prontuarios)
        .set({ content: { conduta: 'v2' }, version: row!.version + 1, rowVersion: row!.rowVersion + 1 })
        .where(eq(prontuarios.id, pid));
    });
    const cur = await withTenant(CLINIC_A, (tx) =>
      tx.select({ version: prontuarios.version }).from(prontuarios).where(eq(prontuarios.id, pid)),
    );
    const arch = await withTenant(CLINIC_A, (tx) =>
      tx.select({ version: prontuarioVersions.version, reason: prontuarioVersions.reason }).from(prontuarioVersions).where(eq(prontuarioVersions.prontuarioId, pid)),
    );
    assert(cur[0]?.version === 2, `version atual deveria ser 2, veio ${cur[0]?.version}`);
    assert(arch.length === 1 && arch[0]?.version === 1, 'revisão 1 não foi arquivada em prontuario_versions');
  });

  // --- #13: RLS -------------------------------------------------------------
  await tryStep('#13 — RLS: clínica B não enxerga prontuário de A', async () => {
    const fromB = await withTenant(CLINIC_B, (tx) => tx.select({ id: prontuarios.id }).from(prontuarios));
    assert(fromB.length === 0, `B não deveria ver prontuário de A, viu ${fromB.length}`);
    const fromA = await withTenant(CLINIC_A, (tx) => tx.select({ id: prontuarios.id }).from(prontuarios));
    assert(fromA.length > 0, 'A deveria ver seus próprios prontuários');
  });
}

async function cleanup(): Promise<void> {
  const ids = sql`(${CLINIC_A}::uuid, ${CLINIC_B}::uuid)`;
  try {
    await dbAdmin.execute(sql`DELETE FROM prescriptions WHERE clinic_id IN ${ids}`);
    await dbAdmin.execute(sql`DELETE FROM medical_documents WHERE clinic_id IN ${ids}`);
    await dbAdmin.execute(sql`DELETE FROM prontuario_versions WHERE clinic_id IN ${ids}`);
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
