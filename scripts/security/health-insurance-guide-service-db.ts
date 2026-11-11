/**
 * Convênios (P7.4 + P1.8): prova do SERVIÇO `createConsultaGuideForAppointment`
 * sobre o schema real (todas as migrations), rodando o código de produção dentro
 * do `withTenant` REAL da aplicação (`src/lib/db/tenant.ts`: SET LOCAL ROLE
 * authenticated verificado + `app.current_clinic`), com o pool do app apontado
 * para o Postgres descartável. Nenhuma origem de conexão nova (F-01).
 *
 * Confere: particular não gera guia; módulo desligado não gera; consulta por
 * convênio gera guia com o TUSS e o valor do contrato; reentrega e corrida não
 * duplicam nem consomem número; dado faltando vira pendência com responsável;
 * retorno não faturável não vira guia; autorização só a concedida pela
 * operadora; nada de outra clínica; rollback do chamador devolve o número.
 *
 * Não toca DEV nem produção. Uso:
 *   NODE_OPTIONS=--conditions=react-server npx tsx scripts/security/health-insurance-guide-service-db.ts
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import {
  createConsultaGuideForAppointment,
  type AppointmentCoverage,
  type CompletedAppointment,
  type ConsultaGuideOutcome,
} from '../../src/contexts/health-insurance/internal/consulta-guide-service';

import { startScratchSchema } from './scratch-schema';

const cluster = await startScratchSchema({ port: 55503, maxConnections: 24 });
const { sql } = cluster;
// O pool do app lê o ambiente ao ser importado: aponta para o cluster local ANTES do import.
// As variáveis públicas são os mesmos valores falsos do CI; nada aponta para DEV ou produção.
process.env.DATABASE_URL = cluster.url;
delete process.env.DATABASE_URL_RUNTIME;
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://ci.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_ci';
if (!/@(?:127\.0\.0\.1|localhost):55503\//u.test(cluster.url))
  throw new Error('não é o cluster local');
const { withTenant } = await import('../../src/lib/db/tenant');
const SYS = '00000000-0000-0000-0000-0000000000aa';
let passed = 0;
const pass = (msg: string): void => {
  passed += 1;
  console.log(`PASS: ${msg}`);
};

/** O serviço roda como o handler fará: dentro de withTenant (role authenticated + GUCs). */
async function run(
  clinicId: string,
  appointment: CompletedAppointment,
  coverage: AppointmentCoverage | null,
  after?: () => never,
): Promise<ConsultaGuideOutcome> {
  return withTenant(clinicId, async (tx) => {
    const out = await createConsultaGuideForAppointment(tx, {
      clinicId,
      appointment,
      coverage,
      terminologyVersion: '202609',
      actor: { kind: 'automation' },
    });
    if (after) after();
    return out;
  });
}

let slot = 0;
async function setupClinic(label: string, enabled: boolean) {
  const clinicId = randomUUID();
  const doctorId = randomUUID();
  const doctor2Id = randomUUID();
  for (const id of [doctorId, doctor2Id]) {
    await sql`insert into auth.users (id, email) values (${id}::uuid, ${`${id}@example.invalid`})`;
  }
  await sql`insert into public.clinics (id, slug, nome, status)
    values (${clinicId}::uuid, ${`gs-${clinicId.slice(0, 8)}`}, ${`Clínica ${label}`}, 'active')`;
  for (const id of [doctorId, doctor2Id]) {
    await sql`insert into public.profiles (id, clinic_id, nome, role, ativo)
      values (${id}::uuid, ${clinicId}::uuid, 'Profissional sintético', 'doctor', true)`;
  }
  await sql`insert into public.hi_clinic_settings (clinic_id, enabled, enabled_at, enabled_by, provider_kind, cnes_status)
    values (${clinicId}::uuid, ${enabled}, case when ${enabled}::boolean then now() end, ${enabled ? SYS : null}, 'PJ', 'none_declared')`;
  const [ins] = await sql`insert into public.hi_insurers
      (clinic_id, name, registro_ans, provider_id_kind, provider_id_value, status, created_by)
    values (${clinicId}::uuid, 'Operadora Um', '123456', 'codigoPrestadorNaOperadora', 'TESTE001', 'active', ${SYS}::uuid)
    returning id`;
  await sql`insert into public.hi_professional_profiles (clinic_id, professional_id, council, council_number, council_uf, cbo)
    values (${clinicId}::uuid, ${doctorId}::uuid, '06', '12345', '35', '225125')`;
  const proc = async (codigo: string) =>
    (
      await sql`insert into public.procedures (clinic_id, codigo, descricao, valor_padrao, duracao_padrao_min, ativo)
        values (${clinicId}::uuid, ${codigo}, 'Procedimento sintético', 150, 30, true) returning id`
    )[0]!.id as string;
  const consulta = await proc('CONS');
  const unmapped = await proc('SEMTUSS');
  const authProc = await proc('AUTORIZ');
  const contract = (
    procedureId: string,
    code: string,
    cents: number,
    extra: { auth?: boolean; returnDays?: number | null } = {},
  ) =>
    sql`insert into public.hi_procedure_contracts
        (clinic_id, insurer_id, guide_type, table_code, procedure_code, description, procedure_id,
         unit_value_cents, valid_from, requires_authorization, return_days, return_billable, created_by)
      values (${clinicId}::uuid, ${ins!.id}::uuid, 'consulta', '22', ${code}, 'Consulta em consultório', ${procedureId}::uuid,
        ${cents}, '2026-01-01', ${extra.auth ?? false}, ${extra.returnDays ?? null}, false, ${SYS}::uuid) returning id`;
  await contract(consulta, '10101012', 15000, { returnDays: 15 });
  await contract(authProc, '10101039', 22000, { auth: true });
  const [patient] = await sql`insert into public.patients (clinic_id, nome, cpf_encrypted, cpf_hash)
    values (${clinicId}::uuid, 'Paciente Sintético Silva', 'ciphertext-de-teste', ${`hash-${randomUUID()}`}) returning id`;
  const [card] = await sql`insert into public.hi_memberships
      (clinic_id, patient_id, insurer_id, card_number_encrypted, card_number_hash, card_last4, created_by)
    values (${clinicId}::uuid, ${patient!.id}::uuid, ${ins!.id}::uuid, 'AQAAAAAAAAAAAAAAAAAAAAAAAAAAAA==', ${'e'.repeat(64)}, '5678', ${SYS}::uuid)
    returning id`;
  const appointment = async (
    procedureId: string,
    date: string,
    professionalId = doctorId,
  ): Promise<CompletedAppointment> => {
    slot += 1;
    const [a] = await sql`insert into public.appointments (
        clinic_id, doctor_id, patient_id, procedure_id, scheduled_at, duration_min, status, valor,
        snapshot_procedure_name, snapshot_procedure_valor, snapshot_procedure_duracao_min, snapshot_doctor_nome, created_via)
      values (${clinicId}::uuid, ${professionalId}::uuid, ${patient!.id}::uuid, ${procedureId}::uuid,
        ${`${date}T00:00:00Z`}::timestamptz + ${slot} * interval '1 minute' * 31,
        30, 'atendido', 150, 'Consulta', 150, 30, 'Profissional sintético', 'attendant') returning id`;
    return {
      id: a!.id as string,
      patientId: patient!.id as string,
      professionalId,
      procedureId,
      date,
      billingMode: 'convenio',
    };
  };
  return {
    clinicId,
    doctorId,
    doctor2Id,
    insurerId: ins!.id as string,
    patientId: patient!.id as string,
    cardId: card!.id as string,
    consulta,
    unmapped,
    authProc,
    appointment,
    coverage: { insurerId: ins!.id as string, planId: null, membershipId: card!.id as string },
  };
}

const counter = async (clinicId: string): Promise<number> => {
  const [r] = await sql`select coalesce(max(last_value), 0)::int as v from public.hi_counters
    where clinic_id = ${clinicId}::uuid and kind = 'guide'`;
  return r!.v as number;
};
const guideOf = async (id: string) => {
  const [g] =
    await sql`select g.status, g.number, g.total_value_cents::int as total, g.expected_value_cents::int as expected,
      g.issues, g.authorization_id, g.created_via, g.membership_id, g.live,
      (select count(*)::int from public.hi_guide_items i where i.guide_id = g.id) as items,
      (select json_agg(json_build_object('code', i.procedure_code, 'unit', i.unit_value_cents, 'on', i.executed_on))
         from public.hi_guide_items i where i.guide_id = g.id) as item_rows
    from public.hi_guides g where g.id = ${id}::uuid`;
  return g!;
};

try {
  await sql`insert into public.tiss_terminology_versions (version, archive_url, archive_sha256, manifest_sha256)
    values ('202609', 'https://example.invalid/tuss.zip', ${'a'.repeat(64)}, ${'b'.repeat(64)}) on conflict do nothing`;
  const A = await setupClinic('A', true);
  const B = await setupClinic('B', false);

  // ── Particular e módulo desligado ────────────────────────────────────
  const apPart = await A.appointment(A.consulta, '2026-11-02');
  assert.deepEqual(await run(A.clinicId, { ...apPart, billingMode: 'particular' }, A.coverage), {
    kind: 'not_insurance',
  });
  assert.deepEqual(await run(A.clinicId, { ...apPart, billingMode: null }, A.coverage), {
    kind: 'not_insurance',
  });
  const apB = await B.appointment(B.consulta, '2026-11-02');
  assert.deepEqual(await run(B.clinicId, apB, B.coverage), { kind: 'module_disabled' });
  assert.equal(await counter(A.clinicId), 0);
  pass('particular ou sem modalidade não gera guia; clínica com o módulo desligado também não');

  // ── Consulta completa ────────────────────────────────────────────────
  const ap1 = await A.appointment(A.consulta, '2026-11-03');
  const out1 = await run(A.clinicId, ap1, A.coverage);
  assert.equal(out1.kind, 'created');
  const created1 = out1 as Extract<ConsultaGuideOutcome, { kind: 'created' }>;
  assert.deepEqual(
    [created1.status, created1.number, created1.issues],
    ['ready_for_review', '1', []],
  );
  const g1 = await guideOf(created1.guideId);
  assert.deepEqual(
    [g1.status, g1.total, g1.expected, g1.items, g1.created_via, g1.membership_id],
    ['ready_for_review', 15000, 15000, 1, 'automation', A.cardId],
  );
  assert.deepEqual(g1.item_rows, [{ code: '10101012', unit: 15000, on: '2026-11-03' }]);
  pass(
    'consulta por convênio gera a guia pronta para conferência, com TUSS e valor do contrato e data do atendimento',
  );

  // ── Idempotência e corrida ───────────────────────────────────────────
  const again = await run(A.clinicId, ap1, A.coverage);
  assert.deepEqual(again, { kind: 'existing', guideId: created1.guideId, number: '1' });
  assert.equal(await counter(A.clinicId), 1);
  pass('reentrega do evento devolve a guia existente, sem consumir número');

  const apRace = await A.appointment(A.consulta, '2026-11-20');
  const before = await counter(A.clinicId);
  const race = await Promise.allSettled(
    Array.from({ length: 10 }, () => run(A.clinicId, apRace, A.coverage)),
  );
  const kinds = race.map((r) =>
    r.status === 'fulfilled' ? r.value.kind : `erro:${(r.reason as { code?: string }).code}`,
  );
  const guidesForRace = (
    await sql`select count(*)::int as n from public.hi_guides where idempotency_key = ${`appointment:${apRace.id}:consulta`}`
  )[0]!.n as number;
  assert.equal(guidesForRace, 1);
  assert.equal(await counter(A.clinicId), before + 1);
  assert.ok(
    kinds.every((k) => k === 'created' || k === 'existing'),
    kinds.join(','),
  );
  assert.equal(kinds.filter((k) => k === 'created').length, 1);
  pass(
    `10 entregas simultâneas do mesmo atendimento: 1 guia, contador +1 (${kinds.filter((k) => k === 'existing').length} viram "existente")`,
  );

  // ── Pendências com responsável ───────────────────────────────────────
  const apNoCard = await A.appointment(A.consulta, '2026-11-25');
  const outNoCard = (await run(A.clinicId, apNoCard, {
    ...A.coverage,
    membershipId: null,
  })) as Extract<ConsultaGuideOutcome, { kind: 'created' }>;
  assert.equal(outNoCard.status, 'pending_data');
  assert.deepEqual(
    outNoCard.issues.map((i) => [i.code, i.owner]),
    [['MEMBERSHIP_MISSING', 'recepcao']],
  );
  assert.equal((await guideOf(outNoCard.guideId)).items, 1);

  const apUnmapped = await A.appointment(A.unmapped, '2026-11-26');
  const outUnmapped = (await run(A.clinicId, apUnmapped, A.coverage)) as Extract<
    ConsultaGuideOutcome,
    { kind: 'created' }
  >;
  assert.deepEqual(
    outUnmapped.issues.map((i) => i.code),
    ['PROCEDURE_NOT_CONTRACTED'],
  );
  const gUnmapped = await guideOf(outUnmapped.guideId);
  assert.deepEqual([gUnmapped.status, gUnmapped.items, gUnmapped.total], ['pending_data', 0, 0]);

  const apNoProfile = await A.appointment(A.consulta, '2026-11-27', A.doctor2Id);
  const outNoProfile = (await run(A.clinicId, apNoProfile, A.coverage)) as Extract<
    ConsultaGuideOutcome,
    { kind: 'created' }
  >;
  assert.deepEqual(
    outNoProfile.issues.map((i) => [i.code, i.owner]),
    [['PROFESSIONAL_PROFILE_MISSING', 'gestor']],
  );
  const issuesText = JSON.stringify([outNoCard.issues, outUnmapped.issues, outNoProfile.issues]);
  assert.ok(
    !issuesText.includes('Sintético') && !issuesText.includes('5678') && !/CID/u.test(issuesText),
  );
  pass(
    'dado faltando vira pendência com responsável (recepção ou gestor), sem dado pessoal e sem exigir CID; TUSS só do contrato',
  );

  // ── Retorno não faturável ────────────────────────────────────────────
  const apReturn = await A.appointment(A.consulta, '2026-11-10');
  const beforeReturn = await counter(A.clinicId);
  const outReturn = await run(A.clinicId, apReturn, A.coverage);
  assert.equal(outReturn.kind, 'skipped_return');
  assert.equal(await counter(A.clinicId), beforeReturn);
  pass(
    'retorno dentro da janela, com contrato que não paga retorno: sem guia e sem consumir número',
  );

  // ── Autorização: só a concedida pela operadora ───────────────────────
  const authBefore = (
    await sql`select count(*)::int as n from public.hi_authorizations where clinic_id = ${A.clinicId}::uuid`
  )[0]!.n as number;
  const apAuth = await A.appointment(A.authProc, '2026-11-28');
  const outAuth = (await run(A.clinicId, apAuth, A.coverage)) as Extract<
    ConsultaGuideOutcome,
    { kind: 'created' }
  >;
  assert.deepEqual(
    outAuth.issues.map((i) => i.code),
    ['AUTHORIZATION_MISSING'],
  );
  const authAfter = (
    await sql`select count(*)::int as n from public.hi_authorizations where clinic_id = ${A.clinicId}::uuid`
  )[0]!.n as number;
  assert.equal(authAfter, authBefore);
  await sql`insert into public.hi_authorizations
      (clinic_id, insurer_id, membership_id, guide_type, origin, status, authorized_on, recorded_by, operator_guide_number, created_by)
    values (${A.clinicId}::uuid, ${A.insurerId}::uuid, ${A.cardId}::uuid, 'consulta', 'manual', 'authorized', '2026-11-25',
      ${SYS}::uuid, 'OP-77', ${SYS}::uuid)`;
  const apAuth2 = await A.appointment(A.authProc, '2026-11-29');
  const outAuth2 = (await run(A.clinicId, apAuth2, A.coverage)) as Extract<
    ConsultaGuideOutcome,
    { kind: 'created' }
  >;
  assert.deepEqual([outAuth2.status, outAuth2.issues], ['ready_for_review', []]);
  assert.ok((await guideOf(outAuth2.guideId)).authorization_id);
  pass(
    'contrato que exige autorização: sem autorização concedida vira pendência (nenhuma é criada); com uma válida, ela é ligada',
  );

  // ── Isolamento ───────────────────────────────────────────────────────
  const apCross = await A.appointment(A.consulta, '2026-11-30');
  assert.deepEqual(
    await run(A.clinicId, apCross, {
      insurerId: B.insurerId,
      planId: null,
      membershipId: B.cardId,
    }),
    {
      kind: 'needs_coverage',
    },
  );
  pass('operadora de outra clínica não é vista (RLS): sem guia, a cobertura volta como pendente');

  // ── Rollback do chamador ─────────────────────────────────────────────
  const apRollback = await A.appointment(A.consulta, '2027-01-15');
  const beforeRollback = await counter(A.clinicId);
  await assert.rejects(() =>
    run(A.clinicId, apRollback, A.coverage, () => {
      throw new Error('falha do handler depois de criar a guia');
    }),
  );
  assert.equal(await counter(A.clinicId), beforeRollback);
  const rolled = (
    await sql`select count(*)::int as n from public.hi_guides where idempotency_key = ${`appointment:${apRollback.id}:consulta`}`
  )[0]!.n as number;
  assert.equal(rolled, 0);
  const retried = await run(A.clinicId, apRollback, A.coverage);
  assert.equal(retried.kind, 'created');
  pass('falha do chamador desfaz a guia e devolve o número; a nova entrega cria normalmente');

  console.log(`OK: ${passed} provas do serviço de geração da Guia de Consulta sobre o schema real`);
} finally {
  await cluster.stop();
}
// O pool do app (idle_timeout 20 s) manteria o processo vivo depois do sucesso.
process.exit(0);
