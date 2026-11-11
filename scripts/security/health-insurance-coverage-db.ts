/**
 * Convênios (P1.6 + P10.1 + P4.5 + P7.4): prova da migration 0148 e do fluxo
 * PONTA A PONTA em ambiente isolado, com o código real:
 *
 *   recepção registra a cobertura (serviço, validado no servidor)
 *   → médico conclui o atendimento (`applyTransition` real do Scheduling)
 *   → o worker real do outbox (`runOutboxOnce`) entrega os eventos aos handlers
 *     reais (boot de `src/app/api/cron/outbox/handlers.ts`)
 *   → particular: recebível cheio, como sempre;
 *     convênio: guia automática, NENHUM recebível do paciente, nenhuma cobrança;
 *   → coparticipação conferida e confirmada → recebível SÓ pelo valor confirmado.
 *
 * Também prova o banco: modalidade só com o módulo ligado e até a chegada;
 * cobertura coerente e congelada; coparticipação com os seis valores e as
 * transições; e a rede de segurança em `lancamentos` (recebível de convênio só até
 * o cobrável confirmado, por qualquer caminho).
 *
 * O pool do app aponta para o Postgres descartável (nenhuma origem de conexão
 * nova). Nenhuma chamada ao Asaas: a prova confere que nada chegou a
 * `patient_charges`. Não toca DEV nem produção. Uso:
 *   NODE_OPTIONS=--conditions=react-server npx tsx scripts/security/health-insurance-coverage-db.ts
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { startScratchSchema } from './scratch-schema';

const cluster = await startScratchSchema({ port: 55504, maxConnections: 32 });
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
if (!/@(?:127\.0\.0\.1|localhost):55504\//u.test(cluster.url))
  throw new Error('não é o cluster local');

const { withTenant } = await import('../../src/lib/db/tenant');
await import('../../src/app/api/cron/outbox/handlers'); // registra os handlers reais
const { runOutboxOnce } = await import('../../src/lib/outbox/worker');
const { applyTransition } = await import('../../src/contexts/scheduling/internal/appointment-core');
const { listRemainderCandidates, listDepositCandidates } =
  await import('../../src/contexts/scheduling/deposit-candidates');
const { recordAppointmentCoverage, CoverageInputError } =
  await import('../../src/contexts/health-insurance/internal/coverage-service');
const { checkCopay, confirmCopay } =
  await import('../../src/contexts/health-insurance/internal/copay-service');

const SYS = '00000000-0000-0000-0000-0000000000aa';
let passed = 0;
const pass = (msg: string): void => {
  passed += 1;
  console.log(`PASS: ${msg}`);
};
async function rejects(code: string, op: () => Promise<unknown>, hint?: RegExp): Promise<void> {
  await assert.rejects(op, (e: unknown) => {
    const err = e as {
      code?: string;
      message?: string;
      cause?: { code?: string; message?: string };
    };
    assert.equal(err.code ?? err.cause?.code, code, String(err.message));
    if (hint) assert.match(`${err.message} ${err.cause?.message ?? ''}`, hint);
    return true;
  });
}
async function asTenant<T>(clinicId: string, fn: (tx: typeof sql) => Promise<T>): Promise<T> {
  return (await sql.begin(async (tx) => {
    await tx.unsafe('SET LOCAL ROLE authenticated');
    await tx`select set_config('app.current_clinic', ${clinicId}, true)`;
    return fn(tx as unknown as typeof sql);
  })) as T;
}

let slot = 0;
async function setupClinic(label: string, enabled: boolean) {
  const clinicId = randomUUID();
  const doctorId = randomUUID();
  await sql`insert into auth.users (id, email) values (${doctorId}::uuid, ${`${doctorId}@example.invalid`})`;
  await sql`insert into public.clinics (id, slug, nome, status)
    values (${clinicId}::uuid, ${`cv-${clinicId.slice(0, 8)}`}, ${`Clínica ${label}`}, 'active')`;
  await sql`insert into public.profiles (id, clinic_id, nome, role, ativo)
    values (${doctorId}::uuid, ${clinicId}::uuid, 'Profissional sintético', 'doctor', true)`;
  await sql`insert into public.hi_clinic_settings (clinic_id, enabled, enabled_at, enabled_by, provider_kind, cnes_status)
    values (${clinicId}::uuid, ${enabled}, case when ${enabled}::boolean then now() end,
      ${enabled ? SYS : null}, 'PJ', 'none_declared')`;
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
  // Consulta com coparticipação de 30%; outra que exige autorização, com coparticipação fixa de R$ 20.
  await sql`insert into public.hi_procedure_contracts
      (clinic_id, insurer_id, guide_type, table_code, procedure_code, description, procedure_id,
       unit_value_cents, valid_from, copay_kind, copay_percentage, created_by)
    values (${clinicId}::uuid, ${ins!.id}::uuid, 'consulta', '22', '10101012', 'Consulta em consultório',
      ${consulta}::uuid, 15000, '2026-01-01', 'percentage', 30, ${SYS}::uuid)`;
  await sql`insert into public.hi_procedure_contracts
      (clinic_id, insurer_id, guide_type, table_code, procedure_code, description, procedure_id,
       unit_value_cents, valid_from, requires_authorization, copay_kind, copay_fixed_cents, created_by)
    values (${clinicId}::uuid, ${ins!.id}::uuid, 'consulta', '22', '10101039', 'Consulta em domicílio',
      ${withAuth}::uuid, 22000, '2026-01-01', true, 'fixed', 2000, ${SYS}::uuid)`;
  const patient = async (tag: string) =>
    (
      await sql`insert into public.patients (clinic_id, nome, cpf_encrypted, cpf_hash)
        values (${clinicId}::uuid, ${`Paciente ${tag}`}, 'ciphertext-de-teste', ${`hash-${randomUUID()}`}) returning id`
    )[0]!.id as string;
  const p1 = await patient('Um');
  const p2 = await patient('Dois');
  const card = async (patientId: string, hash: string) =>
    (
      await sql`insert into public.hi_memberships
          (clinic_id, patient_id, insurer_id, card_number_encrypted, card_number_hash, card_last4, created_by)
        values (${clinicId}::uuid, ${patientId}::uuid, ${ins!.id}::uuid, 'AQAAAAAAAAAAAAAAAAAAAAAAAAAAAA==', ${hash}, '9876', ${SYS}::uuid)
        returning id`
    )[0]!.id as string;
  const card1 = await card(p1, 'a'.repeat(64));
  const card2 = await card(p2, 'b'.repeat(64));
  const appointment = async (patientId: string, procedureId: string, status = 'agendado') => {
    slot += 1;
    const [a] = await sql`insert into public.appointments (
        clinic_id, doctor_id, patient_id, procedure_id, scheduled_at, duration_min, status, valor,
        snapshot_procedure_name, snapshot_procedure_valor, snapshot_procedure_duracao_min, snapshot_doctor_nome, created_via)
      values (${clinicId}::uuid, ${doctorId}::uuid, ${patientId}::uuid, ${procedureId}::uuid,
        '2026-11-12T12:00:00Z'::timestamptz + ${slot} * interval '1 hour', 30, ${status}::appointment_status, 150,
        'Consulta', 150, 30, 'Profissional sintético', 'attendant') returning id`;
    return a!.id as string;
  };
  return {
    clinicId,
    doctorId,
    insurerId: ins!.id as string,
    consulta,
    withAuth,
    p1,
    p2,
    card1,
    card2,
    appointment,
  };
}
type Clinic = Awaited<ReturnType<typeof setupClinic>>;

/** Recepção: cobertura pelo serviço real, dentro do withTenant real. */
const recordCoverage = (
  c: Clinic,
  appointmentId: string,
  patientId: string,
  membershipId: string | null,
  procedureId: string,
  authorizationId: string | null = null,
) =>
  withTenant(
    c.clinicId,
    (tx) =>
      recordAppointmentCoverage(tx, {
        clinicId: c.clinicId,
        appointmentId,
        patientId,
        procedureId,
        appointmentDate: '2026-11-12',
        guideType: 'consulta',
        insurerId: c.insurerId,
        planId: null,
        membershipId,
        authorizationId,
        actor: { kind: 'user', userId: c.doctorId },
      }),
    c.doctorId,
  );

/** Médico conclui: prontuário assinado (invariante clínica) + transição real. */
async function complete(c: Clinic, appointmentId: string, patientId: string): Promise<void> {
  await sql`update public.appointments set status = 'em_atendimento' where id = ${appointmentId}::uuid`;
  await sql`insert into public.prontuarios (clinic_id, patient_id, doctor_id, appointment_id, status, signed_at, signed_by, content_encrypted)
    values (${c.clinicId}::uuid, ${patientId}::uuid, ${c.doctorId}::uuid, ${appointmentId}::uuid, 'assinado', now(), ${c.doctorId}::uuid,
      'ciphertext-sintetico-do-prontuario')`;
  await withTenant(
    c.clinicId,
    (tx) =>
      applyTransition(tx, {
        clinicId: c.clinicId,
        appointmentId,
        target: 'atendido',
        transitionedBy: c.doctorId,
        actorType: 'user',
        clientKey: `concluir-${appointmentId}`,
        correlationId: null,
      }),
    c.doctorId,
  );
}

async function drainOutbox(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    const [{ n }] = (await sql`select count(*)::int as n from public.outbox where status = 'pending'
      and next_attempt_at <= now()`) as unknown as [{ n: number }];
    if (n === 0) return;
    await runOutboxOnce({ batchSize: 50, parallelism: 1 });
  }
}
const receivablesOf = async (appointmentId: string) =>
  sql`select valor::text as valor, patient_id is not null as has_patient, descricao from public.lancamentos
    where appointment_id = ${appointmentId}::uuid and tipo = 'receber'`;
const count = async (q: PromiseLike<readonly unknown[]>): Promise<number> =>
  ((await q)[0] as { n: number }).n;

try {
  // O Supabase concede SELECT em `clinics` ao `authenticated` por privilégio padrão da
  // plataforma (fora das migrations); o cluster local não. Mesmo ajuste dos harnesses
  // ai-handoff-reliability-db.ts e signup-provision-db.ts. Os handlers leem o fuso da clínica.
  await sql`GRANT SELECT ON public.clinics TO authenticated`;
  const A = await setupClinic('A', true);
  const B = await setupClinic('B', false);

  // ── 1. Modalidade ────────────────────────────────────────────────────
  const apDefault = await A.appointment(A.p1, A.consulta);
  const [{ mode }] =
    (await sql`select billing_mode as mode from public.appointments where id = ${apDefault}::uuid`) as unknown as [
      { mode: string },
    ];
  assert.equal(mode, 'particular');
  const apB = await B.appointment(B.p1, B.consulta);
  await rejects(
    '55000',
    () => sql`update public.appointments set billing_mode = 'convenio' where id = ${apB}::uuid`,
    /habilitado/u,
  );
  await sql`update public.appointments set billing_mode = 'convenio' where id = ${apDefault}::uuid`;
  const apLate = await A.appointment(A.p1, A.consulta, 'em_atendimento');
  await rejects(
    '55000',
    () => sql`update public.appointments set billing_mode = 'convenio' where id = ${apLate}::uuid`,
    /chegada/u,
  );
  pass(
    'modalidade: nasce particular; convênio só com o módulo ligado na clínica e só até a chegada do paciente',
  );

  // ── 2. Cobertura validada no servidor ────────────────────────────────
  await assert.rejects(
    () => recordCoverage(A, apDefault, A.p1, A.card2, A.consulta),
    CoverageInputError,
  );
  const cov = await recordCoverage(A, apDefault, A.p1, A.card1, A.consulta);
  assert.deepEqual([cov.status, cov.issues, cov.copay?.expectedCents], ['ready', [], 4500]);
  const apAuth = await A.appointment(A.p1, A.withAuth);
  await sql`update public.appointments set billing_mode = 'convenio' where id = ${apAuth}::uuid`;
  const covAuth = await recordCoverage(A, apAuth, A.p1, A.card1, A.withAuth);
  assert.equal(covAuth.status, 'pending_authorization');
  const apNoCard = await A.appointment(A.p2, A.consulta);
  const covNoCard = await recordCoverage(A, apNoCard, A.p2, null, A.consulta);
  assert.deepEqual(
    [covNoCard.status, covNoCard.issues.map((i) => [i.code, i.owner])],
    ['incomplete', [['MEMBERSHIP_MISSING', 'recepcao']]],
  );
  pass(
    'cobertura validada no servidor: carteirinha de outro paciente recusada; autorização exigida fica pendente; falta vira pendência com responsável; coparticipação estimada (30% de R$ 150 = R$ 45)',
  );

  // ── 3. Cobertura: o banco confere de novo ────────────────────────────
  await rejects(
    '23514',
    () => sql`insert into public.hi_appointment_coverages
      (clinic_id, appointment_id, patient_id, insurer_id, membership_id, created_via)
    values (${A.clinicId}::uuid, ${apNoCard}::uuid, ${A.p2}::uuid, ${A.insurerId}::uuid, ${A.card1}::uuid, 'automation')`,
  );
  await rejects(
    '23514',
    () =>
      sql`update public.hi_appointment_coverages set status = 'ready' where appointment_id = ${apNoCard}::uuid`,
  );
  const [deniedAuth] = await sql`insert into public.hi_authorizations
      (clinic_id, insurer_id, membership_id, guide_type, origin, status, denial_reason, recorded_by, created_by)
    values (${A.clinicId}::uuid, ${A.insurerId}::uuid, ${A.card1}::uuid, 'consulta', 'manual', 'denied',
      'Carência contratual', ${SYS}::uuid, ${SYS}::uuid) returning id`;
  await rejects(
    '23514',
    () => sql`update public.hi_appointment_coverages
      set authorization_id = ${deniedAuth!.id}::uuid, status = 'authorization_recorded' where appointment_id = ${apAuth}::uuid`,
    /concedida/u,
  );
  const covDenied = await recordCoverage(
    A,
    apAuth,
    A.p1,
    A.card1,
    A.withAuth,
    deniedAuth!.id as string,
  );
  assert.equal(covDenied.status, 'authorization_denied');
  const seenByB = await asTenant(
    B.clinicId,
    (tx) => tx`select id from public.hi_appointment_coverages`,
  );
  assert.equal(seenByB.length, 0);
  pass(
    'cobertura: carteirinha de outro paciente, "pronta" sem carteirinha e autorização negada como "registrada" são recusadas pelo banco; negada vira situação própria; RLS por clínica',
  );

  // ── 4. Coparticipação: seis valores e transições ─────────────────────
  const [cp] =
    await sql`select id, status, expected_cents::int as exp from public.hi_copayments where appointment_id = ${apDefault}::uuid`;
  assert.deepEqual([cp!.status, cp!.exp], ['estimated', 4500]);
  await rejects(
    '23514',
    () => sql`insert into public.hi_copayments
      (clinic_id, coverage_id, appointment_id, patient_id, kind, expected_cents, status, confirmed_cents, chargeable_cents)
    select clinic_id, id, appointment_id, patient_id, 'fixed', 100, 'confirmed', 100, 100
      from public.hi_appointment_coverages where appointment_id = ${apAuth}::uuid`,
  );
  await rejects('55000', () =>
    asTenant(
      A.clinicId,
      (tx) => tx`update public.hi_copayments set status = 'confirmed' where id = ${cp!.id}::uuid`,
    ),
  );
  pass('coparticipação: nasce estimada (nunca confirmada nem cobrada); sem pular etapa');

  // ── 5. Rede de segurança em lancamentos ──────────────────────────────
  const fullReceivable = (
    appointmentId: string,
    valor: string,
  ) => sql`insert into public.lancamentos
      (clinic_id, tipo, descricao, valor, status, due_date, patient_id, appointment_id, created_via)
    values (${A.clinicId}::uuid, 'receber', 'Atendimento - Consulta', ${valor}, 'pendente', current_date,
      ${A.p1}::uuid, ${appointmentId}::uuid, 'auto') returning id`;
  await rejects('23514', () => fullReceivable(apDefault, '150.00'), /coparticipação confirmada/u);
  await rejects('23514', () =>
    asTenant(
      A.clinicId,
      (tx) => tx`insert into public.lancamentos
      (clinic_id, tipo, descricao, valor, status, due_date, patient_id, appointment_id, created_via)
    values (${A.clinicId}::uuid, 'receber', 'Atendimento', '150.00', 'pendente', current_date, ${A.p1}::uuid, ${apDefault}::uuid, 'manual')`,
    ),
  );
  const apParticular = await A.appointment(A.p2, A.consulta);
  const [okPart] = await fullReceivable(apParticular, '150.00');
  assert.ok(okPart);
  await sql`delete from public.lancamentos where id = ${okPart!.id}::uuid`;
  const [manual] =
    await sql`insert into public.lancamentos (clinic_id, tipo, descricao, valor, status, due_date, created_via)
    values (${A.clinicId}::uuid, 'receber', 'Venda avulsa', '80.00', 'pendente', current_date, 'manual') returning id`;
  assert.ok(manual);
  pass(
    'rede de segurança: recebível cheio de atendimento de convênio recusado pelo banco (handler, Caixa ou script, como dono ou runtime); particular e lançamento avulso seguem iguais',
  );

  // ── 6. PONTA A PONTA: particular x convênio, com o código real ───────
  const apP = await A.appointment(A.p2, A.consulta);
  await complete(A, apP, A.p2);
  await complete(A, apDefault, A.p1);
  await drainOutbox();
  assert.deepEqual(
    (await receivablesOf(apP)).map((r) => [r.valor, r.has_patient]),
    [['150.00', true]],
  );
  pass(
    'ponta a ponta, particular: concluir gera o recebível cheio do paciente, exatamente como antes',
  );

  assert.equal((await receivablesOf(apDefault)).length, 0);
  const [guide] =
    await sql`select g.status, g.number, g.total_value_cents::int as total, g.created_via,
      (select count(*)::int from public.hi_guide_items i where i.guide_id = g.id) as items
    from public.hi_guides g where g.idempotency_key = ${`appointment:${apDefault}:consulta`}`;
  assert.deepEqual(
    [guide!.status, guide!.total, guide!.created_via, guide!.items],
    ['ready_for_review', 15000, 'automation', 1],
  );
  const [copayCalc] =
    await sql`select status, calculated_cents::int as calc, chargeable_cents from public.hi_copayments where appointment_id = ${apDefault}::uuid`;
  assert.deepEqual(
    [copayCalc!.status, copayCalc!.calc, copayCalc!.chargeable_cents],
    ['calculated', 4500, null],
  );
  assert.equal(
    await count(
      sql`select count(*)::int as n from public.patient_charges where appointment_id = ${apDefault}::uuid`,
    ),
    0,
  );
  const events = await sql`select event_type, status from public.outbox
    where payload->>'appointmentId' = ${apDefault} order by event_type`;
  assert.deepEqual(
    events.map((e) => [e.event_type, e.status]),
    [
      ['scheduling.appointment.completed', 'processed'],
      ['scheduling.appointment.insurance_completed', 'processed'],
    ],
  );
  pass(
    `ponta a ponta, convênio: concluir gera a guia nº ${guide!.number} pronta para conferência (R$ 150 do contrato), coparticipação calculada (R$ 45, ainda não cobrável), NENHUM recebível do paciente e NENHUMA cobrança (patient_charges vazio)`,
  );

  // ── 7. Sinal, saldo e régua não alcançam o convênio ──────────────────
  const remainder = await listRemainderCandidates([A.clinicId], { completedWithinHours: 24 });
  assert.ok(remainder.some((r) => r.appointmentId === apP));
  assert.ok(!remainder.some((r) => r.appointmentId === apDefault));
  const apFutureConv = await A.appointment(A.p1, A.consulta);
  await sql`update public.appointments set billing_mode = 'convenio', scheduled_at = now() + interval '3 days' where id = ${apFutureConv}::uuid`;
  const apFuturePart = await A.appointment(A.p2, A.consulta);
  await sql`update public.appointments set scheduled_at = now() + interval '4 days' where id = ${apFuturePart}::uuid`;
  const deposit = await listDepositCandidates([A.clinicId], { createdWithinHours: 24 });
  assert.ok(deposit.some((d) => d.appointmentId === apFuturePart));
  assert.ok(!deposit.some((d) => d.appointmentId === apFutureConv));
  pass(
    'sinal e link do saldo (Asaas): o convênio não entra nos candidatos; o particular continua entrando',
  );

  // ── 8. Reentrega e evento duplicado ──────────────────────────────────
  const guidesBefore = await count(
    sql`select count(*)::int as n from public.hi_guides where clinic_id = ${A.clinicId}::uuid`,
  );
  const counterBefore = await count(
    sql`select coalesce(max(last_value),0)::int as n from public.hi_counters where clinic_id = ${A.clinicId}::uuid and kind = 'guide'`,
  );
  await sql`update public.outbox set status = 'pending', next_attempt_at = now()
    where payload->>'appointmentId' = ${apDefault}`;
  await drainOutbox();
  assert.equal(
    await count(
      sql`select count(*)::int as n from public.hi_guides where clinic_id = ${A.clinicId}::uuid`,
    ),
    guidesBefore,
  );
  assert.equal(
    await count(
      sql`select coalesce(max(last_value),0)::int as n from public.hi_counters where clinic_id = ${A.clinicId}::uuid and kind = 'guide'`,
    ),
    counterBefore,
  );
  assert.equal((await receivablesOf(apDefault)).length, 0);
  assert.equal(
    await count(sql`select count(*)::int as n from public.hi_guide_events e join public.hi_guides g on g.id = e.guide_id
    where g.idempotency_key = ${`appointment:${apDefault}:consulta`}`),
    1,
  );
  pass('reentrega dos dois eventos: nenhuma guia, número, recebível ou histórico a mais');

  // ── 9. Fora de ordem: concluído sem cobertura ────────────────────────
  const apNoCov = await A.appointment(A.p1, A.consulta);
  await sql`update public.appointments set billing_mode = 'convenio' where id = ${apNoCov}::uuid`;
  await complete(A, apNoCov, A.p1);
  await drainOutbox();
  assert.equal(
    await count(
      sql`select count(*)::int as n from public.hi_guides where idempotency_key = ${`appointment:${apNoCov}:consulta`}`,
    ),
    0,
  );
  assert.equal((await receivablesOf(apNoCov)).length, 0);
  await rejects(
    '55000',
    () => recordCoverage(A, apNoCov, A.p1, A.card1, A.consulta),
    /congela|antes do atendimento/u,
  );
  pass(
    'convênio concluído sem cobertura: nada é inventado (sem guia, sem recebível); a cobertura não entra depois por fora (vai para correção)',
  );

  // ── 10. Coparticipação confirmada → recebível SÓ pelo valor confirmado ─
  const copayId = (
    await sql`select id from public.hi_copayments where appointment_id = ${apDefault}::uuid`
  )[0]!.id as string;
  await withTenant(
    A.clinicId,
    (tx) =>
      checkCopay(tx, {
        clinicId: A.clinicId,
        copaymentId: copayId,
        checkedCents: 4500,
        actorUserId: A.doctorId,
      }),
    A.doctorId,
  );
  // Falha durante a criação do recebível: o runtime perde o INSERT; o worker falha e retenta.
  await sql`revoke insert on public.lancamentos from authenticated`;
  await withTenant(
    A.clinicId,
    (tx) =>
      confirmCopay(tx, {
        clinicId: A.clinicId,
        copaymentId: copayId,
        confirmedCents: 4500,
        chargeableCents: 4500,
        actorUserId: A.doctorId,
        procedureName: 'Consulta',
      }),
    A.doctorId,
  );
  await runOutboxOnce({ batchSize: 50, parallelism: 1 });
  const [failedEv] =
    await sql`select status, attempts from public.outbox where event_type = 'health_insurance.copay.confirmed'`;
  assert.ok(
    ['pending', 'failed'].includes(failedEv!.status as string) && Number(failedEv!.attempts) >= 1,
  );
  assert.equal((await receivablesOf(apDefault)).length, 0);
  await sql`grant insert on public.lancamentos to authenticated`;
  await sql`update public.outbox set status = 'pending', next_attempt_at = now() where event_type = 'health_insurance.copay.confirmed'`;
  await drainOutbox();
  assert.deepEqual(
    (await receivablesOf(apDefault)).map((r) => [r.valor, r.descricao]),
    [['45.00', 'Coparticipação - Consulta']],
  );
  await sql`update public.outbox set status = 'pending', next_attempt_at = now() where event_type = 'health_insurance.copay.confirmed'`;
  await drainOutbox();
  assert.equal((await receivablesOf(apDefault)).length, 1);
  await rejects(
    '23514',
    () =>
      sql`update public.lancamentos set valor = '45.01' where appointment_id = ${apDefault}::uuid`,
  );
  // Dispensar uma coparticipação que já virou recebível deixaria o recebível órfão: recusado.
  await rejects(
    '55000',
    () =>
      asTenant(
        A.clinicId,
        (tx) => tx`update public.hi_copayments
      set status = 'waived', waive_reason = 'Paciente isento por decisão da clínica',
          transition_note = 'Paciente isento por decisão da clínica'
    where id = ${copayId}::uuid`,
      ),
    /recebível/u,
  );
  pass(
    'coparticipação conferida e confirmada: recebível do paciente só de R$ 45 (nunca R$ 150); falha no meio retenta sem duplicar; acima do confirmado é recusado; não se dispensa depois de virar recebível',
  );

  // ── 11. Régua não persegue convênio ──────────────────────────────────
  await sql`update public.lancamentos set due_date = current_date - 10 where appointment_id in (${apDefault}::uuid, ${apP}::uuid)`;
  const { listDunningCandidates } = await import('../../src/contexts/financial/dunning-candidates');
  const dunning = await listDunningCandidates(100);
  const dunned = new Set(dunning.map((d) => d.lancamentoId));
  const [lp] = await sql`select id from public.lancamentos where appointment_id = ${apP}::uuid`;
  const [lc] =
    await sql`select id from public.lancamentos where appointment_id = ${apDefault}::uuid`;
  assert.ok(dunned.has(lp!.id as string));
  assert.ok(!dunned.has(lc!.id as string));
  pass('régua de cobrança: o recebível particular vencido entra; o de atendimento de convênio não');

  // ── 12. LGPD (P12.13): exclusão de paciente com guia ─────────────────
  const { hardDeletePatients } = await import('../../src/contexts/patient/internal/hard-delete');
  const { createConsultaGuideForAppointment } =
    await import('../../src/contexts/health-insurance/internal/consulta-guide-service');
  const freshPatient = async (tag: string) =>
    (
      await sql`insert into public.patients (clinic_id, nome, cpf_encrypted, cpf_hash, email)
        values (${A.clinicId}::uuid, ${`Paciente ${tag}`}, 'ciphertext-de-teste', ${`hash-${randomUUID()}`},
          ${`${tag}@example.invalid`}) returning id`
    )[0]!.id as string;
  const pX = await freshPatient('com-guia');
  const [cardX] = await sql`insert into public.hi_memberships
      (clinic_id, patient_id, insurer_id, card_number_encrypted, card_number_hash, card_last4, created_by)
    values (${A.clinicId}::uuid, ${pX}::uuid, ${A.insurerId}::uuid, 'AQAAAAAAAAAAAAAAAAAAAAAAAAAAAA==', ${'e'.repeat(64)}, '1111', ${SYS}::uuid)
    returning id`;
  const apX = await A.appointment(pX, A.consulta, 'atendido');
  const outX = await withTenant(A.clinicId, (tx) =>
    createConsultaGuideForAppointment(tx, {
      clinicId: A.clinicId,
      appointment: {
        id: apX,
        patientId: pX,
        professionalId: A.doctorId,
        procedureId: A.consulta,
        date: '2026-11-12',
        billingMode: 'convenio',
      },
      coverage: { insurerId: A.insurerId, planId: null, membershipId: cardX!.id as string },
      terminologyVersion: null,
      actor: { kind: 'automation' },
    }),
  );
  assert.equal(outX.kind, 'created');
  const pY = await freshPatient('so-cobertura');
  const apY = await A.appointment(pY, A.consulta);
  await recordCoverage(A, apY, pY, null, A.consulta);
  const outcome = await hardDeletePatients(A.clinicId, [pX, pY]);
  assert.deepEqual([outcome.deleted, outcome.anonymized, outcome.failed], [1, 1, 0]);
  const [px] =
    await sql`select nome, anonymized_at is not null as anon from public.patients where id = ${pX}::uuid`;
  assert.deepEqual([px!.nome, px!.anon], ['Paciente anonimizado (LGPD)', true]);
  assert.equal(
    await count(
      sql`select count(*)::int as n from public.hi_guides where patient_id = ${pX}::uuid`,
    ),
    1,
  );
  assert.equal(
    await count(sql`select count(*)::int as n from public.patients where id = ${pY}::uuid`),
    0,
  );
  assert.equal(
    await count(
      sql`select count(*)::int as n from public.hi_appointment_coverages where patient_id = ${pY}::uuid`,
    ),
    0,
  );
  pass(
    'LGPD: paciente com guia é ANONIMIZADO (cadastro sem dado pessoal) e a guia fica, sem bloqueio silencioso; paciente só com cobertura é excluído por inteiro',
  );

  console.log(
    `OK: ${passed} provas da 0148 e do fluxo ponta a ponta (particular x convênio) sobre o schema real`,
  );
} finally {
  await cluster.stop();
}
process.exit(0);
