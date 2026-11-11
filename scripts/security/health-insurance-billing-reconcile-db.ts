/**
 * Convênios P7.4 — "convênio sem guia": prova da migration 0149 e da recuperação
 * automática em Postgres DESCARTÁVEL, com o código real:
 *
 *   conclusão (`applyTransition` real) → worker real do outbox → handler real
 *   → guia pronta OU pendência persistente com motivo e responsável;
 *   reconcile real (`listBillingGapCandidates` + `reconcileInsuranceBilling`, o mesmo
 *   par que o cron `financial-reconcile` chama) → recupera evento perdido, falho,
 *   travado ou fora de ordem, sem duplicar guia nem número;
 *   correção administrativa real (`correctCoverageInTx`) → cobertura depois do
 *   atendimento só com pendência aberta, nota e autor.
 *
 * Cenários exigidos pelo fundador (11/11): evento perdido, duplicado e fora de
 * ordem; worker interrompido; falha temporária e persistente; cobertura
 * cadastrada depois; contrato corrigido; autorização recebida depois da consulta;
 * duas reconciliações simultâneas; particular; cancelado; guia já emitida; guia
 * substituída. Mais: o banco exige prova para fechar, RLS, nenhuma cobrança ao
 * paciente, LGPD.
 *
 * O pool do app aponta para o cluster local (nenhuma origem de conexão nova).
 * Não toca DEV nem produção; nenhuma chamada ao Asaas. Uso:
 *   NODE_OPTIONS=--conditions=react-server npx tsx scripts/security/health-insurance-billing-reconcile-db.ts
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { startScratchSchema } from './scratch-schema';

const cluster = await startScratchSchema({ port: 55506, maxConnections: 32 });
const { sql } = cluster;
process.env.DATABASE_URL = cluster.url;
delete process.env.DATABASE_URL_RUNTIME;
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://ci.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_ci';
process.env.OUTBOX_CRON_ALLOW_NON_VERCEL = 'true';
// Chave mestra e sal SINTÉTICOS, só para este cluster local (a anonimização LGPD cifra o CPF vazio).
process.env.CRYPTO_SECRET_BACKEND = 'env';
process.env.CRYPTO_MASTER_KEY_V1 = Buffer.alloc(32, 7).toString('base64');
process.env.CRYPTO_LOOKUP_SALT = Buffer.alloc(32, 9).toString('base64');
if (!/@(?:127\.0\.0\.1|localhost):55506\//u.test(cluster.url))
  throw new Error('não é o cluster local');

const { withTenant } = await import('../../src/lib/db/tenant');
await import('../../src/app/api/cron/outbox/handlers'); // registra os handlers reais
const { runOutboxOnce } = await import('../../src/lib/outbox/worker');
const { applyTransition } = await import('../../src/contexts/scheduling/internal/appointment-core');
const { recordAppointmentCoverage } =
  await import('../../src/contexts/health-insurance/internal/coverage-service');
const { listBillingGapCandidates, reconcileInsuranceBilling } =
  await import('../../src/contexts/health-insurance');
const { processInsuranceBilling } =
  await import('../../src/contexts/health-insurance/internal/billing-recovery');
const { handleInsuranceCompleted } =
  await import('../../src/contexts/health-insurance/internal/handlers/insurance-completed');
const {
  correctCoverageInTx,
  dismissBillingGapInTx,
  reopenBillingGapInTx,
  BillingGapActionError,
} = await import('../../src/contexts/health-insurance/internal/billing-gap-actions');
const { MAX_AUTOMATIC_ATTEMPTS } =
  await import('../../src/contexts/health-insurance/internal/billing-gap-policy');
const { hardDeletePatients } = await import('../../src/contexts/patient/internal/hard-delete');

const SYS = '00000000-0000-0000-0000-0000000000aa';
const HASH = (c: string) => c.repeat(64);
const CIPHER = 'AQAAAAAAAAAAAAAAAAAAAAAAAAAAAA==';
let passed = 0;
const pass = (msg: string): void => {
  passed += 1;
  console.log(`PASS: ${msg}`);
};
async function rejects(code: string, op: () => Promise<unknown>, hint?: RegExp): Promise<void> {
  await assert.rejects(op, (e: unknown) => {
    const err = e as { code?: string; message?: string; cause?: { code?: string; message?: string } };
    assert.equal(err.code ?? err.cause?.code, code, String(err.message));
    if (hint) assert.match(`${err.message} ${err.cause?.message ?? ''}`, hint);
    return true;
  });
}
async function asTenant<T>(clinicId: string, fn: (tx: typeof sql) => Promise<T>, actor?: string): Promise<T> {
  return (await sql.begin(async (tx) => {
    await tx.unsafe('SET LOCAL ROLE authenticated');
    await tx`select set_config('app.current_clinic', ${clinicId}, true)`;
    if (actor) await tx`select set_config('app.current_user', ${actor}, true)`;
    return fn(tx as unknown as typeof sql);
  })) as T;
}

let slot = 0;
async function setupClinic(label: string) {
  const clinicId = randomUUID();
  const doctorId = randomUUID();
  const billerId = randomUUID();
  for (const id of [doctorId, billerId]) {
    await sql`insert into auth.users (id, email) values (${id}::uuid, ${`${id}@example.invalid`})`;
  }
  await sql`insert into public.clinics (id, slug, nome, status)
    values (${clinicId}::uuid, ${`gap-${clinicId.slice(0, 8)}`}, ${`Clínica ${label}`}, 'active')`;
  await sql`insert into public.profiles (id, clinic_id, nome, role, ativo)
    values (${doctorId}::uuid, ${clinicId}::uuid, 'Profissional sintético', 'doctor', true),
           (${billerId}::uuid, ${clinicId}::uuid, 'Faturista sintética', 'financial', true)`;
  await sql`insert into public.hi_clinic_settings (clinic_id, enabled, enabled_at, enabled_by, provider_kind, cnes_status)
    values (${clinicId}::uuid, true, now(), ${SYS}, 'PJ', 'none_declared')`;
  const [ins] = await sql`insert into public.hi_insurers
      (clinic_id, name, registro_ans, provider_id_kind, provider_id_value, status, created_by)
    values (${clinicId}::uuid, 'Operadora Um', '123456', 'codigoPrestadorNaOperadora', 'TESTE001', 'active', ${SYS}::uuid)
    returning id`;
  await sql`insert into public.hi_professional_profiles (clinic_id, professional_id, council, council_number, council_uf, cbo)
    values (${clinicId}::uuid, ${doctorId}::uuid, '06', '12345', '35', '225125')`;
  const proc = async (codigo: string) =>
    (
      await sql`insert into public.procedures (clinic_id, codigo, descricao, valor_padrao, duracao_padrao_min, ativo)
        values (${clinicId}::uuid, ${codigo}, 'Consulta sintética', 150, 30, true) returning id`
    )[0]!.id as string;
  const consulta = await proc('CONS');
  const withAuth = await proc('AUT');
  const uncontracted = await proc('SEMCT');
  const uncontracted2 = await proc('SEMCT2');
  const contract = async (procedureId: string, code: string, cents: number, requiresAuth = false) =>
    (
      await sql`insert into public.hi_procedure_contracts
          (clinic_id, insurer_id, guide_type, table_code, procedure_code, description, procedure_id,
           unit_value_cents, valid_from, requires_authorization, copay_kind, copay_percentage, created_by)
        values (${clinicId}::uuid, ${ins!.id}::uuid, 'consulta', '22', ${code}, 'Consulta em consultório',
          ${procedureId}::uuid, ${cents}, '2026-01-01', ${requiresAuth}, 'percentage', 30, ${SYS}::uuid)
        returning id`
    )[0]!.id as string;
  await contract(consulta, '10101012', 15000);
  await contract(withAuth, '10101039', 22000, true);
  const patient = async (tag: string) =>
    (
      await sql`insert into public.patients (clinic_id, nome, cpf_encrypted, cpf_hash)
        values (${clinicId}::uuid, ${`Paciente ${tag}`}, 'ciphertext-de-teste', ${`hash-${randomUUID()}`}) returning id`
    )[0]!.id as string;
  const card = async (patientId: string) =>
    (
      await sql`insert into public.hi_memberships
          (clinic_id, patient_id, insurer_id, card_number_encrypted, card_number_hash, card_last4, created_by)
        values (${clinicId}::uuid, ${patientId}::uuid, ${ins!.id}::uuid, ${CIPHER}, ${randomUUID().replace(/-/g, '').padEnd(64, '0')}, '9876', ${SYS}::uuid)
        returning id`
    )[0]!.id as string;
  /** Paciente novo com carteirinha e um atendimento (uma pessoa por cenário: sem janela de retorno cruzada). */
  const visit = async (procedureId: string, mode: 'particular' | 'convenio', status = 'agendado') => {
    slot += 1;
    const patientId = await patient(`${label}-${slot}`);
    const cardId = await card(patientId);
    const [a] = await sql`insert into public.appointments (
        clinic_id, doctor_id, patient_id, procedure_id, scheduled_at, duration_min, status, valor,
        snapshot_procedure_name, snapshot_procedure_valor, snapshot_procedure_duracao_min, snapshot_doctor_nome, created_via)
      values (${clinicId}::uuid, ${doctorId}::uuid, ${patientId}::uuid, ${procedureId}::uuid,
        '2026-11-12T12:00:00Z'::timestamptz + ${slot} * interval '1 hour', 30, ${status}::appointment_status, 150,
        'Consulta', 150, 30, 'Profissional sintético', 'attendant') returning id`;
    if (mode === 'convenio') {
      await sql`update public.appointments set billing_mode = 'convenio' where id = ${a!.id}::uuid`;
    }
    return { appointmentId: a!.id as string, patientId, cardId, procedureId };
  };
  return {
    clinicId,
    doctorId,
    billerId,
    insurerId: ins!.id as string,
    consulta,
    withAuth,
    uncontracted,
    uncontracted2,
    contract,
    visit,
  };
}
type Clinic = Awaited<ReturnType<typeof setupClinic>>;
type Visit = Awaited<ReturnType<Clinic['visit']>>;

const coverage = (c: Clinic, v: Visit, authorizationId: string | null = null) =>
  withTenant(
    c.clinicId,
    (tx) =>
      recordAppointmentCoverage(tx, {
        clinicId: c.clinicId,
        appointmentId: v.appointmentId,
        patientId: v.patientId,
        procedureId: v.procedureId,
        appointmentDate: '2026-11-12',
        guideType: 'consulta',
        insurerId: c.insurerId,
        planId: null,
        membershipId: v.cardId,
        authorizationId,
        actor: { kind: 'user', userId: c.doctorId },
      }),
    c.doctorId,
  );

/** Médico conclui: prontuário assinado (invariante clínica) + transição real. */
async function complete(c: Clinic, v: Visit): Promise<void> {
  await sql`update public.appointments set status = 'em_atendimento' where id = ${v.appointmentId}::uuid`;
  await sql`insert into public.prontuarios (clinic_id, patient_id, doctor_id, appointment_id, status, signed_at, signed_by, content_encrypted)
    values (${c.clinicId}::uuid, ${v.patientId}::uuid, ${c.doctorId}::uuid, ${v.appointmentId}::uuid, 'assinado', now(), ${c.doctorId}::uuid,
      'ciphertext-sintetico-do-prontuario')`;
  await withTenant(
    c.clinicId,
    (tx) =>
      applyTransition(tx, {
        clinicId: c.clinicId,
        appointmentId: v.appointmentId,
        target: 'atendido',
        transitionedBy: c.doctorId,
        actorType: 'user',
        clientKey: `concluir-${v.appointmentId}`,
        correlationId: null,
      }),
    c.doctorId,
  );
}
async function drainOutbox(): Promise<void> {
  for (let i = 0; i < 8; i++) {
    const [{ n }] = (await sql`select count(*)::int as n from public.outbox where status = 'pending'
      and next_attempt_at <= now()`) as unknown as [{ n: number }];
    if (n === 0) return;
    await runOutboxOnce({ batchSize: 50, parallelism: 1 });
  }
}
/** Passa a janela de carência (15 min) sem disparar gatilhos de `appointments`. */
async function age(v: Visit): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`set local session_replication_role = replica`;
    await tx`update public.appointments set updated_at = now() - interval '20 minutes' where id = ${v.appointmentId}::uuid`;
  });
}
const forceDue = (v: Visit) =>
  sql`update public.hi_billing_gaps set next_attempt_at = now() - interval '1 minute'
       where appointment_id = ${v.appointmentId}::uuid and status = 'open'`;
const insuranceEvent = (v: Visit) =>
  sql`select id, status from public.outbox where event_type = 'scheduling.appointment.insurance_completed'
       and payload->>'appointmentId' = ${v.appointmentId}`;
const reconcile = async () => reconcileInsuranceBilling(await listBillingGapCandidates(50));
const gapOf = async (v: Visit) =>
  (
    await sql`select id, status, reason, owner, recovery, event_state, attempts, next_attempt_at, last_error_code,
        guide_id, coverage_id, resolution, resolution_note, resolved_by, detected_by, version, issues
      from public.hi_billing_gaps where appointment_id = ${v.appointmentId}::uuid`
  )[0] ?? null;
const guidesOf = async (v: Visit) =>
  sql`select g.id, g.number, g.status, g.live, g.issues,
        (select count(*)::int from public.hi_guide_items i where i.guide_id = g.id) as items
      from public.hi_guides g
     where g.idempotency_key = ${`appointment:${v.appointmentId}:consulta`}
        or exists (select 1 from public.hi_guide_items i where i.guide_id = g.id and i.appointment_id = ${v.appointmentId}::uuid)`;
const counter = async (c: Clinic) =>
  (
    await sql`select coalesce(max(last_value), 0)::int as n from public.hi_counters
               where clinic_id = ${c.clinicId}::uuid and kind = 'guide'`
  )[0]!.n as number;
const patientCharges = async (v: Visit) =>
  (
    await sql`select count(*)::int as n from public.lancamentos
               where appointment_id = ${v.appointmentId}::uuid and tipo = 'receber'`
  )[0]!.n as number;

/** Falha injetada no INSERT de guias (simula queda transitória do banco no meio do trabalho). */
async function installFault(): Promise<void> {
  await sql`create table if not exists public.harness_fault (active boolean not null)`;
  await sql`delete from public.harness_fault`;
  await sql`insert into public.harness_fault values (true)`;
  await sql.unsafe(`
    create or replace function public.harness_guide_fault() returns trigger language plpgsql
      security definer set search_path = public, pg_temp as $f$
    begin
      if exists (select 1 from public.harness_fault where active) then
        raise exception 'falha injetada pelo harness' using errcode = '40P01';
      end if;
      return new;
    end $f$;
    drop trigger if exists harness_guide_fault on public.hi_guides;
    create trigger harness_guide_fault before insert on public.hi_guides
      for each row execute function public.harness_guide_fault();`);
}
const clearFault = () => sql`update public.harness_fault set active = false`;

/** pending/ready → reviewed → snapshot → approved, como a emissão faz (P7.5). */
async function approve(c: Clinic, guideId: string): Promise<void> {
  await asTenant(
    c.clinicId,
    async (tx) => {
      await tx`update public.hi_guides set status = 'reviewed', reviewed_by = ${c.billerId}::uuid where id = ${guideId}::uuid`;
      const [g] = await tx`select revision from public.hi_guides where id = ${guideId}::uuid`;
      const [snap] = await tx`insert into public.hi_guide_snapshots
          (clinic_id, guide_id, revision, content_encrypted, content_sha256, tiss_version, terminology_version,
           created_via, created_by)
        values (${c.clinicId}::uuid, ${guideId}::uuid, ${g!.revision}, ${CIPHER}, ${HASH('c')}, '4.03.00', '202609',
          'user', ${c.billerId}::uuid)
        returning id`;
      await tx`update public.hi_guides set status = 'approved', approved_snapshot_id = ${snap!.id}::uuid,
          approved_by = ${c.billerId}::uuid
        where id = ${guideId}::uuid and status = 'reviewed'`;
    },
    c.billerId,
  );
}

try {
  await sql`GRANT SELECT ON public.clinics TO authenticated`;
  await sql`insert into public.tiss_terminology_versions (version, archive_url, archive_sha256, manifest_sha256)
    values ('202609', 'https://example.invalid/tuss.zip', ${HASH('a')}, ${HASH('b')})
    on conflict (version) do nothing`;
  const A = await setupClinic('A');
  const B = await setupClinic('B');

  // ── 1. Particular: nada muda, nenhuma pendência possível ──────────────
  const vPart = await A.visit(A.consulta, 'particular');
  await complete(A, vPart);
  await drainOutbox();
  await age(vPart);
  await reconcile();
  assert.equal((await sql`select valor::text as v from public.lancamentos where appointment_id = ${vPart.appointmentId}::uuid`)[0]!.v, '150.00');
  assert.equal(await gapOf(vPart), null);
  assert.equal((await guidesOf(vPart)).length, 0);
  assert.equal((await insuranceEvent(vPart)).length, 0);
  const partOutcome = await withTenant(A.clinicId, (tx) =>
    processInsuranceBilling(tx, { clinicId: A.clinicId, appointmentId: vPart.appointmentId, detectedBy: 'reconcile', eventState: 'not_checked', lock: 'wait' }),
  );
  assert.equal(partOutcome.kind, 'ignored');
  await rejects('23514', () => sql`insert into public.hi_billing_gaps (clinic_id, appointment_id, reason, owner, recovery, detected_by)
    values (${A.clinicId}::uuid, ${vPart.appointmentId}::uuid, 'coverage_missing', 'recepcao', 'human', 'reconcile')`, /convênio/u);
  pass('particular: recebível de R$ 150 como antes; nenhuma guia, evento de convênio ou pendência; o banco recusa pendência de convênio para particular');

  // ── 2. Convênio no caminho feliz: guia pronta e NENHUMA pendência ─────
  const vOk = await A.visit(A.consulta, 'convenio');
  await coverage(A, vOk);
  await complete(A, vOk);
  await drainOutbox();
  const okGuides = await guidesOf(vOk);
  assert.deepEqual(okGuides.map((g) => [g.status, g.items]), [['ready_for_review', 1]]);
  assert.equal(await gapOf(vOk), null);
  await age(vOk);
  const okCandidates = (await listBillingGapCandidates(50)).filter((c) => c.appointmentId === vOk.appointmentId);
  assert.equal(okCandidates.length, 0);
  pass('convênio completo: o evento gera a guia pronta para conferência; nenhuma pendência; o reconcile não o considera');

  // ── 3. Evento perdido ────────────────────────────────────────────────
  const vLost = await A.visit(A.consulta, 'convenio');
  await coverage(A, vLost);
  await complete(A, vLost);
  await sql`delete from public.outbox where event_type = 'scheduling.appointment.insurance_completed'
    and payload->>'appointmentId' = ${vLost.appointmentId}`;
  await drainOutbox();
  assert.equal((await guidesOf(vLost)).length, 0);
  await age(vLost);
  const lostRun = await reconcile();
  assert.ok(lostRun.guideReady >= 1);
  const lostGap = await gapOf(vLost);
  assert.deepEqual(
    [(await guidesOf(vLost)).map((g) => g.status), lostGap!.reason, lostGap!.event_state, lostGap!.status, lostGap!.resolution],
    [['ready_for_review'], 'event_not_processed', 'missing', 'resolved', 'guide_ready'],
  );
  pass('evento perdido: o reconcile acha o atendimento sem guia, gera a guia pronta e deixa o registro (evento "missing", pendência fechada com a prova da guia)');

  // ── 4. Evento duplicado ──────────────────────────────────────────────
  const beforeDup = await counter(A);
  const payload = {
    appointmentId: vOk.appointmentId,
    clinicId: A.clinicId,
    patientId: vOk.patientId,
    doctorId: A.doctorId,
    procedureId: vOk.procedureId,
    scheduledAt: new Date().toISOString(),
  };
  for (let i = 0; i < 3; i++) {
    await withTenant(A.clinicId, (tx) =>
      handleInsuranceCompleted({ tx, clinicId: A.clinicId, payload, eventId: randomUUID() }),
    );
  }
  assert.deepEqual([(await guidesOf(vOk)).length, await counter(A), await gapOf(vOk)], [1, beforeDup, null]);
  pass('evento duplicado: três entregas do mesmo evento → uma guia, numeração intacta, nenhuma pendência');

  // ── 5. Evento fora de ordem (reconcile antes do worker) ──────────────
  const vOrder = await A.visit(A.consulta, 'convenio');
  await coverage(A, vOrder);
  await sql`update public.outbox set next_attempt_at = now() + interval '1 day' where status = 'pending'`;
  await complete(A, vOrder);
  await sql`update public.outbox set next_attempt_at = now() + interval '1 day'
    where event_type = 'scheduling.appointment.insurance_completed' and status = 'pending'`;
  await age(vOrder);
  await reconcile();
  const orderGuide = await guidesOf(vOrder);
  assert.equal(orderGuide.length, 1);
  assert.equal((await gapOf(vOrder))!.event_state, 'pending');
  await sql`update public.outbox set next_attempt_at = now() where status = 'pending'`;
  const beforeLate = await counter(A);
  await drainOutbox();
  const [lateEvent] = await insuranceEvent(vOrder);
  assert.deepEqual(
    [(await guidesOf(vOrder)).length, await counter(A), lateEvent!.status, (await gapOf(vOrder))!.status],
    [1, beforeLate, 'processed', 'resolved'],
  );
  pass('evento fora de ordem: o reconcile chega antes do worker e gera a guia; o evento atrasado é processado sem segunda guia nem número');

  // ── 6. Worker interrompido (evento travado em "processing") e evento falho ──
  const vStuck = await A.visit(A.consulta, 'convenio');
  const vFailed = await A.visit(A.consulta, 'convenio');
  for (const v of [vStuck, vFailed]) {
    await coverage(A, v);
    await complete(A, v);
  }
  await sql`update public.outbox set status = 'processing', processing_started_at = now()
    where event_type = 'scheduling.appointment.insurance_completed' and payload->>'appointmentId' = ${vStuck.appointmentId}`;
  await sql`update public.outbox set status = 'failed', attempts = 5, last_error = 'erro sintético', error_code = 'handler_error',
      first_failed_at = now(), last_failed_at = now()
    where event_type = 'scheduling.appointment.insurance_completed' and payload->>'appointmentId' = ${vFailed.appointmentId}`;
  await drainOutbox();
  await age(vStuck);
  await age(vFailed);
  await reconcile();
  const stuckGap = await gapOf(vStuck);
  const failedGap = await gapOf(vFailed);
  assert.deepEqual(
    [(await guidesOf(vStuck)).length, stuckGap!.event_state, stuckGap!.status, (await guidesOf(vFailed)).length, failedGap!.event_state, failedGap!.status],
    [1, 'processing', 'resolved', 1, 'failed', 'resolved'],
  );
  pass('worker interrompido e evento esgotado: o reconcile retoma os dois atendimentos, registra o estado do evento ("processing", "failed") e fecha com a guia');

  // ── 7. Falha temporária do banco → recuperação ──────────────────────
  await installFault();
  const vTemp = await A.visit(A.consulta, 'convenio');
  await coverage(A, vTemp);
  await complete(A, vTemp);
  await sql`delete from public.outbox where event_type = 'scheduling.appointment.insurance_completed'
    and payload->>'appointmentId' = ${vTemp.appointmentId}`;
  await drainOutbox();
  await age(vTemp);
  const beforeFault = await counter(A);
  const faultRun = await reconcile();
  const tempGap = await gapOf(vTemp);
  assert.deepEqual(
    [faultRun.failed >= 1, tempGap!.reason, tempGap!.owner, tempGap!.recovery, tempGap!.attempts, tempGap!.last_error_code, (await guidesOf(vTemp)).length, await counter(A)],
    [true, 'processing_failed', 'suporte', 'automatic', 1, 'pg_40p01', 0, beforeFault],
  );
  assert.ok(new Date(tempGap!.next_attempt_at as string).getTime() > Date.now() + 10 * 60_000);
  await clearFault();
  await forceDue(vTemp);
  await reconcile();
  const tempAfter = await gapOf(vTemp);
  assert.deepEqual([(await guidesOf(vTemp)).map((g) => g.status), tempAfter!.status, tempAfter!.resolution, tempAfter!.attempts],
    [['ready_for_review'], 'resolved', 'guide_ready', 1]);
  const tempHistory = await sql`select to_status, reason, attempts, error_code from public.hi_billing_gap_events
    where gap_id = ${tempAfter!.id}::uuid order by created_at, attempts`;
  assert.ok(tempHistory.some((e) => e.reason === 'processing_failed' && e.error_code === 'pg_40p01'));
  assert.equal(tempHistory.at(-1)!.to_status, 'resolved');
  pass('falha temporária: o savepoint desfaz a guia e o número; a pendência registra a falha (código sem dado pessoal, espera de 15 min); sem a falha, a próxima volta recupera e o histórico mostra o caminho');

  // ── 8. Falha persistente → humana ───────────────────────────────────
  await sql`update public.harness_fault set active = true`;
  const vPersist = await A.visit(A.consulta, 'convenio');
  await coverage(A, vPersist);
  await complete(A, vPersist);
  await sql`delete from public.outbox where event_type = 'scheduling.appointment.insurance_completed'
    and payload->>'appointmentId' = ${vPersist.appointmentId}`;
  await drainOutbox();
  await age(vPersist);
  for (let i = 0; i < MAX_AUTOMATIC_ATTEMPTS; i++) {
    await reconcile();
    await sql`update public.hi_billing_gaps set next_attempt_at = now() - interval '1 minute'
      where appointment_id = ${vPersist.appointmentId}::uuid and next_attempt_at is not null`;
  }
  const persistGap = await gapOf(vPersist);
  assert.deepEqual(
    [persistGap!.attempts, persistGap!.recovery, persistGap!.owner, persistGap!.next_attempt_at, persistGap!.status],
    [MAX_AUTOMATIC_ATTEMPTS, 'human', 'suporte', null, 'open'],
  );
  await reconcile();
  assert.equal((await gapOf(vPersist))!.attempts, MAX_AUTOMATIC_ATTEMPTS);
  await clearFault();
  pass(`falha persistente: ${MAX_AUTOMATIC_ATTEMPTS} tentativas com espera crescente, depois a recuperação vira humana (suporte), sem próxima tentativa e fora do reconcile`);

  // ── 9. Cobertura cadastrada depois (correção administrativa) ─────────
  const vNoCov = await A.visit(A.consulta, 'convenio');
  await complete(A, vNoCov);
  await drainOutbox();
  const noCovGap = await gapOf(vNoCov);
  assert.deepEqual(
    [noCovGap!.reason, noCovGap!.owner, noCovGap!.recovery, noCovGap!.detected_by, (await guidesOf(vNoCov)).length],
    ['coverage_missing', 'recepcao', 'human', 'event', 0],
  );
  await rejects('42501', () => asTenant(A.clinicId, (tx) => tx`insert into public.hi_appointment_coverages
      (clinic_id, appointment_id, patient_id, insurer_id, membership_id, created_via, correction_note, corrected_by)
    values (${A.clinicId}::uuid, ${vNoCov.appointmentId}::uuid, ${vNoCov.patientId}::uuid, ${A.insurerId}::uuid,
      ${vNoCov.cardId}::uuid, 'automation', 'Correção sem usuário autenticado', ${A.billerId}::uuid)`));
  await rejects('55000', () => asTenant(A.clinicId, (tx) => tx`insert into public.hi_appointment_coverages
      (clinic_id, appointment_id, patient_id, insurer_id, membership_id, created_via)
    values (${A.clinicId}::uuid, ${vNoCov.appointmentId}::uuid, ${vNoCov.patientId}::uuid, ${A.insurerId}::uuid,
      ${vNoCov.cardId}::uuid, 'user')`, A.billerId), /antes do atendimento/u);
  const correctionInput = {
    clinicId: A.clinicId,
    appointmentId: vNoCov.appointmentId,
    guideType: 'consulta' as const,
    insurerId: A.insurerId,
    planId: null,
    membershipId: vNoCov.cardId,
    authorizationId: null,
  };
  await assert.rejects(
    () => withTenant(A.clinicId, (tx) => correctCoverageInTx(tx, { ...correctionInput, note: 'curta' }, A.billerId), A.billerId),
  );
  const corrected = await withTenant(
    A.clinicId,
    (tx) => correctCoverageInTx(tx, { ...correctionInput, note: 'Paciente apresentou a carteirinha depois da consulta' }, A.billerId),
    A.billerId,
  );
  const [covRow] = await sql`select corrected_by, corrected_at is not null as stamped, correction_note
    from public.hi_appointment_coverages where appointment_id = ${vNoCov.appointmentId}::uuid`;
  const noCovAfter = await gapOf(vNoCov);
  assert.deepEqual(
    [corrected.kind, (await guidesOf(vNoCov)).map((g) => g.status), noCovAfter!.status, noCovAfter!.resolution, covRow!.corrected_by, covRow!.stamped],
    ['guide_ready', ['ready_for_review'], 'resolved', 'guide_ready', A.billerId, true],
  );
  await assert.rejects(
    () => withTenant(A.clinicId, (tx) => correctCoverageInTx(tx, { ...correctionInput, note: 'Outra correção depois de resolvida' }, A.billerId), A.billerId),
    BillingGapActionError,
  );
  pass('cobertura cadastrada depois: pendência "coverage_missing" (recepção); o banco só aceita a cobertura tardia com pendência aberta, nota e usuário autenticado; a correção gera a guia e fecha a pendência; sem pendência aberta, não há correção');

  // ── 10. Contrato corrigido ──────────────────────────────────────────
  const vNoContract = await A.visit(A.uncontracted, 'convenio');
  await coverage(A, vNoContract);
  await complete(A, vNoContract);
  await drainOutbox();
  const [ncGuide] = await guidesOf(vNoContract);
  const ncGap = await gapOf(vNoContract);
  assert.deepEqual(
    [ncGuide!.status, ncGuide!.items, ncGap!.reason, ncGap!.owner, ncGap!.guide_id],
    ['pending_data', 0, 'contract_missing', 'gestor', ncGuide!.id],
  );
  await A.contract(A.uncontracted, '10101020', 18000);
  await forceDue(vNoContract);
  await age(vNoContract);
  await reconcile();
  const [ncAfter] = await guidesOf(vNoContract);
  const ncGapAfter = await gapOf(vNoContract);
  assert.deepEqual(
    [ncAfter!.id, ncAfter!.number, ncAfter!.status, ncAfter!.items, ncGapAfter!.status, ncGapAfter!.resolution],
    [ncGuide!.id, ncGuide!.number, 'ready_for_review', 1, 'resolved', 'guide_ready'],
  );
  pass('contrato corrigido: a guia nasce em edição sem procedimento e a pendência aponta o gestor; com o contrato cadastrado, o reconcile reavalia A MESMA guia (mesmo número), põe o item do contrato e fecha a pendência');

  // ── 11. Autorização recebida depois da consulta ─────────────────────
  const vAuth = await A.visit(A.withAuth, 'convenio');
  await coverage(A, vAuth);
  await complete(A, vAuth);
  await drainOutbox();
  const [authGuide] = await guidesOf(vAuth);
  const authGap = await gapOf(vAuth);
  assert.deepEqual(
    [authGuide!.status, (authGuide!.issues as Array<{ code: string }>).map((i) => i.code), authGap!.reason, authGap!.owner],
    ['pending_data', ['AUTHORIZATION_MISSING'], 'authorization_pending', 'recepcao'],
  );
  await forceDue(vAuth);
  await age(vAuth);
  await reconcile();
  assert.equal((await guidesOf(vAuth))[0]!.status, 'pending_data');
  await sql`insert into public.hi_authorizations
      (clinic_id, insurer_id, membership_id, guide_type, origin, status, authorized_on, recorded_by, operator_guide_number, created_by)
    values (${A.clinicId}::uuid, ${A.insurerId}::uuid, ${vAuth.cardId}::uuid, 'consulta', 'manual', 'authorized', '2026-11-10',
      ${SYS}::uuid, 'OP-SINT-1', ${SYS}::uuid)`;
  await forceDue(vAuth);
  await reconcile();
  const [authAfter] = await sql`select status, authorization_id is not null as linked from public.hi_guides where id = ${authGuide!.id}::uuid`;
  assert.deepEqual([authAfter!.status, authAfter!.linked, (await gapOf(vAuth))!.status], ['ready_for_review', true, 'resolved']);
  pass('autorização recebida depois: sem a autorização concedida a guia continua em edição (nada presumido); registrada a da operadora, o reconcile liga a autorização à mesma guia e fecha a pendência');

  // ── 12. Duas reconciliações simultâneas ─────────────────────────────
  const many: Visit[] = [];
  for (let i = 0; i < 6; i++) {
    const v = await A.visit(A.consulta, 'convenio');
    await coverage(A, v);
    await complete(A, v);
    await sql`delete from public.outbox where event_type = 'scheduling.appointment.insurance_completed'
      and payload->>'appointmentId' = ${v.appointmentId}`;
    many.push(v);
  }
  await drainOutbox();
  for (const v of many) await age(v);
  const beforeRace = await counter(A);
  const candidates = await listBillingGapCandidates(50);
  const [r1, r2] = await Promise.all([reconcileInsuranceBilling(candidates), reconcileInsuranceBilling(candidates)]);
  const perAppointment = await Promise.all(many.map(async (v) => (await guidesOf(v)).length));
  assert.deepEqual(perAppointment, [1, 1, 1, 1, 1, 1]);
  assert.equal(await counter(A), beforeRace + 6);
  assert.equal(r1.failed + r2.failed, 0);
  const raceGaps = await Promise.all(many.map(gapOf));
  assert.ok(raceGaps.every((g) => g!.status === 'resolved' && g!.attempts === 1));
  pass(`duas reconciliações simultâneas sobre os mesmos 6 atendimentos: 6 guias, numeração +6, cada pendência com UMA tentativa (ocupados pulados: ${r1.busy + r2.busy})`);

  // ── 13. Cancelado ───────────────────────────────────────────────────
  const vCancel = await A.visit(A.consulta, 'convenio');
  await coverage(A, vCancel);
  await sql`update public.appointments set status = 'cancelado' where id = ${vCancel.appointmentId}::uuid`;
  await age(vCancel);
  await reconcile();
  const cancelOut = await withTenant(A.clinicId, (tx) =>
    processInsuranceBilling(tx, { clinicId: A.clinicId, appointmentId: vCancel.appointmentId, detectedBy: 'reconcile', eventState: 'not_checked', lock: 'wait' }),
  );
  assert.deepEqual([cancelOut.kind, await gapOf(vCancel), (await guidesOf(vCancel)).length], ['not_applicable', null, 0]);
  pass('atendimento cancelado: fora do reconcile; processar não cria guia nem pendência');

  // ── 14. Guia já emitida e guia substituída ──────────────────────────
  const [okGuide] = await guidesOf(vOk);
  await approve(A, okGuide!.id as string);
  await age(vOk);
  const emitted = await withTenant(A.clinicId, (tx) =>
    processInsuranceBilling(tx, { clinicId: A.clinicId, appointmentId: vOk.appointmentId, detectedBy: 'reconcile', eventState: 'not_checked', lock: 'wait' }),
  );
  assert.deepEqual([emitted.kind, await gapOf(vOk)], ['guide_ready', null]);
  // Substituição: a original vai a lote e é exportada (código do banco com dono); a substituta é aprovada.
  for (const status of ['in_batch', 'exported']) {
    await sql`update public.hi_guides set status = ${status} where id = ${okGuide!.id}::uuid`;
  }
  const [line] = await sql`select id from public.hi_procedure_contracts where clinic_id = ${A.clinicId}::uuid and procedure_code = '10101012'`;
  const [sub] = await asTenant(A.clinicId, (tx) => tx`insert into public.hi_guides
      (clinic_id, guide_type, number, insurer_id, patient_id, membership_id, executant_professional_id, status,
       replaces_guide_id, terminology_version, total_value_cents, idempotency_key, created_via, created_by)
    values (${A.clinicId}::uuid, 'consulta', 'SUB1', ${A.insurerId}::uuid, ${vOk.patientId}::uuid, ${vOk.cardId}::uuid,
      ${A.doctorId}::uuid, 'ready_for_review', ${okGuide!.id}::uuid, '202609', 15000, ${`substitute:${okGuide!.id}`}, 'user', ${A.billerId}::uuid)
    returning id`, A.billerId);
  await asTenant(A.clinicId, (tx) => tx`insert into public.hi_guide_items
      (clinic_id, guide_id, sequence, appointment_id, contract_line_id, executed_on, table_code, procedure_code, description,
       quantity, factor_hundredths, unit_value_cents, total_value_cents)
    values (${A.clinicId}::uuid, ${sub!.id}::uuid, 1, ${vOk.appointmentId}::uuid, ${line!.id}::uuid, '2026-11-12', '22', '10101012',
      'Consulta em consultório', 1, 100, 15000, 15000)`, A.billerId);
  await approve(A, sub!.id as string);
  const [orig] = await sql`select status, live from public.hi_guides where id = ${okGuide!.id}::uuid`;
  const replaced = await withTenant(A.clinicId, (tx) =>
    processInsuranceBilling(tx, { clinicId: A.clinicId, appointmentId: vOk.appointmentId, detectedBy: 'reconcile', eventState: 'not_checked', lock: 'wait' }),
  );
  assert.deepEqual(
    [orig!.status, orig!.live, replaced.kind, replaced.kind === 'guide_ready' ? replaced.guideId : null, await gapOf(vOk)],
    ['replaced', false, 'guide_ready', sub!.id, null],
  );
  pass('guia já emitida (aprovada com snapshot) e guia substituída: o atendimento segue faturado pela substituta aprovada; nenhuma pendência, nenhuma guia nova');

  // ── 15. Guia cancelada sem substituta → decisão humana ──────────────
  const [lostGuide] = await guidesOf(vLost);
  await asTenant(A.clinicId, (tx) => tx`update public.hi_guides set status = 'cancelled', cancelled_by = ${A.billerId}::uuid, cancel_reason = 'Lançada para a operadora errada'
    where id = ${lostGuide!.id}::uuid`, A.billerId);
  await age(vLost);
  await reconcile();
  const cancelledGap = await gapOf(vLost);
  assert.deepEqual(
    [cancelledGap!.status, cancelledGap!.reason, cancelledGap!.owner, cancelledGap!.recovery, (await guidesOf(vLost)).length],
    ['open', 'guide_cancelled', 'financeiro', 'human', 1],
  );
  await rejects('42501', () => asTenant(A.clinicId, (tx) => tx`update public.hi_billing_gaps
      set status = 'dismissed', resolution = 'dismissed', resolution_note = 'Encerrada sem usuário autenticado'
    where id = ${cancelledGap!.id}::uuid`));
  await assert.rejects(
    () => withTenant(A.clinicId, (tx) => dismissBillingGapInTx(tx, { clinicId: A.clinicId, gapId: cancelledGap!.id as string, note: 'curto', expectedVersion: cancelledGap!.version as number }), A.billerId),
    BillingGapActionError,
  );
  await withTenant(
    A.clinicId,
    (tx) => dismissBillingGapInTx(tx, { clinicId: A.clinicId, gapId: cancelledGap!.id as string, note: 'Paciente pagou como particular no balcão', expectedVersion: cancelledGap!.version as number }),
    A.billerId,
  );
  const dismissed = await gapOf(vLost);
  await reconcile();
  const autoReopen = await withTenant(A.clinicId, (tx) =>
    processInsuranceBilling(tx, { clinicId: A.clinicId, appointmentId: vLost.appointmentId, detectedBy: 'reconcile', eventState: 'not_checked', lock: 'wait' }),
  );
  await rejects('42501', () => asTenant(A.clinicId, (tx) => tx`update public.hi_billing_gaps set status = 'open' where id = ${dismissed!.id}::uuid`));
  await withTenant(
    A.clinicId,
    (tx) => reopenBillingGapInTx(tx, { clinicId: A.clinicId, gapId: dismissed!.id as string, expectedVersion: (dismissed!.version as number) }),
    A.billerId,
  );
  assert.deepEqual(
    [dismissed!.status, dismissed!.resolved_by, autoReopen.kind, (await gapOf(vLost))!.status, (await guidesOf(vLost)).length],
    ['dismissed', A.billerId, 'dismissed', 'open', 1],
  );
  pass('guia cancelada sem substituta: pendência humana do financeiro; encerrar sem faturar só por usuário, com motivo; o automático nunca reabre nem gera guia nova; só um usuário reabre');

  // ── 16. O banco exige prova para fechar ─────────────────────────────
  await rejects('23514', () => sql`update public.hi_billing_gaps set status = 'resolved', resolution = 'guide_ready', guide_id = ${ncGuide!.id}::uuid
    where appointment_id = ${vAuth.appointmentId}::uuid`, /deste atendimento/u);
  const vProof = await A.visit(A.uncontracted2, 'convenio');
  await coverage(A, vProof);
  await complete(A, vProof);
  await drainOutbox();
  const proofGap = await gapOf(vProof);
  await rejects('23514', () => sql`update public.hi_billing_gaps set status = 'resolved', resolution = 'guide_ready'
    where id = ${proofGap!.id}::uuid`, /pronta/u);
  await rejects('23514', () => sql`update public.hi_billing_gaps set status = 'resolved', resolution = 'not_applicable'
    where id = ${proofGap!.id}::uuid`, /concluído/u);
  await rejects('55000', () => sql`update public.hi_billing_gaps set attempts = attempts + 2 where id = ${proofGap!.id}::uuid`);
  await rejects('42501', () => asTenant(A.clinicId, (tx) => tx`delete from public.hi_billing_gaps where id = ${proofGap!.id}::uuid`));
  await rejects('42501', () => asTenant(A.clinicId, (tx) => tx`update public.hi_billing_gap_events set note = 'x'`));
  pass('o banco exige prova: guia de outro atendimento, guia ainda em edição e "não se aplica" com atendimento concluído são recusados; tentativas só avançam de uma em uma; runtime não apaga pendência nem edita o histórico');

  // ── 17. RLS por clínica ─────────────────────────────────────────────
  const seenByB = await asTenant(B.clinicId, async (tx) => [
    ...(await tx`select id from public.hi_billing_gaps`),
    ...(await tx`select id from public.hi_billing_gap_events`),
  ]);
  const seenByA = await asTenant(A.clinicId, (tx) => tx`select id from public.hi_billing_gaps`);
  assert.deepEqual([seenByB.length, seenByA.length > 5], [0, true]);
  await rejects('42501', () => asTenant(B.clinicId, (tx) => tx`insert into public.hi_billing_gaps
      (clinic_id, appointment_id, reason, owner, recovery, detected_by)
    values (${A.clinicId}::uuid, ${vProof.appointmentId}::uuid, 'coverage_missing', 'recepcao', 'human', 'reconcile')`));
  pass('RLS: a clínica B não lê nem grava pendência ou histórico da clínica A');

  // ── 18. Nenhuma cobrança ao paciente em nenhum cenário de convênio ─────
  const convenio = [vOk, vLost, vOrder, vStuck, vFailed, vTemp, vPersist, vNoCov, vNoContract, vAuth, vCancel, vProof, ...many];
  const charges = await Promise.all(convenio.map(patientCharges));
  assert.ok(charges.every((n) => n === 0), `recebível indevido: ${charges.join(',')}`);
  const [{ n: asaas }] = (await sql`select count(*)::int as n from public.patient_charges`) as unknown as [{ n: number }];
  assert.equal(asaas, 0);
  pass(`financeiro: nos ${convenio.length} atendimentos de convênio (evento perdido, falho, duplicado, fora de ordem, correções, falhas) nenhum recebível do paciente e nenhuma cobrança Asaas`);

  // ── 19. LGPD: a pendência não segura a exclusão do paciente ─────────
  // Sem prontuário: o prontuário assinado é OUTRA causa de retenção e esconderia o que se prova aqui.
  const vLgpd = await A.visit(A.consulta, 'convenio');
  await sql`update public.appointments set status = 'atendido' where id = ${vLgpd.appointmentId}::uuid`;
  await withTenant(A.clinicId, (tx) =>
    processInsuranceBilling(tx, { clinicId: A.clinicId, appointmentId: vLgpd.appointmentId, detectedBy: 'event', eventState: 'processed', lock: 'wait' }),
  );
  const lgpdGap = await gapOf(vLgpd);
  assert.equal(lgpdGap!.reason, 'coverage_missing');
  const del = await hardDeletePatients(A.clinicId, [vLgpd.patientId]);
  const [stillGap] = await sql`select g.id, a.patient_id from public.hi_billing_gaps g
    join public.appointments a on a.id = g.appointment_id where g.id = ${lgpdGap!.id}::uuid`;
  assert.deepEqual([del.deleted, del.anonymized, del.failed, stillGap!.patient_id], [1, 0, 0, null]);
  pass('LGPD: paciente só com pendência (sem guia) é excluído; a pendência fica sem dado pessoal, ligada ao atendimento anonimizado');

  console.log(`\nOK — ${passed}/19 provas da P7.4 (0149) em Postgres descartável.`);
} finally {
  await cluster.stop();
}
