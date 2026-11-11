/**
 * Convênios × #53 — prova da CADEIA UNIDA na ordem real do DEV, com o SQL real
 * das duas branches (não só o teste de ordem do journal):
 *
 *   main 0000–0135 → #53 0136–0142 (lidas do commit do #53 por `git show`)
 *   → #55 0143–0149
 *
 * A 0136 do #53 (já aplicada no DEV) cria gatilhos AFTER INSERT de limite do trial
 * em `appointments` e `lancamentos`; a 0148 do convênio cria gatilhos BEFORE nas
 * mesmas tabelas. Nenhuma prova anterior do convênio rodou com a 0136. Aqui:
 *  1. a cadeia aplica inteira, contígua, sem colisão de prefixo;
 *  2. os gatilhos das duas branches convivem nas tabelas compartilhadas;
 *  3. clínica em trial: particular igual (recebível + consumo do trial); convênio
 *     sem recebível e SEM consumir o limite de recebíveis do trial;
 *  4. a rede de segurança do convênio recusa ANTES do gatilho do trial (nada é
 *     consumido por um INSERT recusado);
 *  5. a coparticipação confirmada vira recebível e conta no trial (política do #53);
 *  6. no limite do trial, o recebível da coparticipação é barrado pelo #53 e o
 *     evento fica para retentativa, sem estado parcial.
 *
 * Não toca o worktree do #53 (só lê objetos git) nem DEV/produção. Uso:
 *   NODE_OPTIONS=--conditions=react-server npx tsx scripts/security/health-insurance-union-chain-db.ts [ref-do-53]
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import { readMigrations, startScratchSchema } from './scratch-schema';

const REF = process.argv[2] ?? process.env.PR53_REF ?? 'b6965447';
const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 << 20 });
const pr53Files = git('ls-tree', '--name-only', REF, 'drizzle/migrations/')
  .split('\n')
  .map((l) => l.trim().replace(/^drizzle\/migrations\//u, ''))
  .filter((f) => /^01(?:3[6-9]|4[0-2])_.*\.sql$/u.test(f));
assert.equal(pr53Files.length, 7, `esperava 0136–0142 no #53 (${REF}), achei ${pr53Files.join(',')}`);
const local = await readMigrations();
assert.ok(!local.some((m) => /^01(?:3[6-9]|4[0-2])_/u.test(m.file)), 'a branch do convênio não deve ter 0136–0142');
const chain = [
  ...local,
  ...pr53Files.map((file) => ({ file, body: git('show', `${REF}:drizzle/migrations/${file}`) })),
].sort((a, b) => a.file.localeCompare(b.file));
const prefixes = chain.map((m) => Number(m.file.slice(0, 4)));
prefixes.forEach((p, i) => assert.equal(p, i, `prefixo ${p} na posição ${i}`));

const cluster = await startScratchSchema({ port: 55507, maxConnections: 16, migrations: chain });
const { sql } = cluster;
process.env.DATABASE_URL = cluster.url;
delete process.env.DATABASE_URL_RUNTIME;
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://ci.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_ci';
process.env.OUTBOX_CRON_ALLOW_NON_VERCEL = 'true';
process.env.CRYPTO_SECRET_BACKEND = 'env';
process.env.CRYPTO_MASTER_KEY_V1 = Buffer.alloc(32, 7).toString('base64');
process.env.CRYPTO_LOOKUP_SALT = Buffer.alloc(32, 9).toString('base64');
if (!/@(?:127\.0\.0\.1|localhost):55507\//u.test(cluster.url)) throw new Error('não é o cluster local');

const { withTenant } = await import('../../src/lib/db/tenant');
await import('../../src/app/api/cron/outbox/handlers');
const { runOutboxOnce } = await import('../../src/lib/outbox/worker');
const { applyTransition } = await import('../../src/contexts/scheduling/internal/appointment-core');
const { recordAppointmentCoverage } =
  await import('../../src/contexts/health-insurance/internal/coverage-service');
const { checkCopay, confirmCopay } =
  await import('../../src/contexts/health-insurance/internal/copay-service');

const SYS = '00000000-0000-0000-0000-0000000000aa';
let passed = 0;
const pass = (msg: string): void => {
  passed += 1;
  console.log(`PASS: ${msg}`);
};

try {
  await sql`GRANT SELECT ON public.clinics TO authenticated`;
  // ── 1. Cadeia ────────────────────────────────────────────────────────
  const [{ n: applied }] = (await sql`select count(*)::int as n from public._schema_version`) as unknown as [{ n: number }];
  const has = async (table: string) =>
    ((await sql`select to_regclass(${`public.${table}`}) is not null as ok`)[0] as { ok: boolean }).ok;
  assert.ok((await has('trial_resource_usage')) && (await has('hi_billing_gaps')));
  pass(`cadeia unida aplica inteira no Postgres 17: ${chain.length} migrations (0000–${String(chain.length - 1).padStart(4, '0')}), 0136–0142 do #53 em ${REF}, prefixos contíguos; ${applied} marcas de versão`);

  // ── 2. Gatilhos das duas branches nas tabelas compartilhadas ─────────
  const triggers = await sql`select c.relname as tbl, t.tgname as name
      from pg_trigger t join pg_class c on c.oid = t.tgrelid
     where not t.tgisinternal and c.relname in ('appointments', 'lancamentos') order by 1, 2`;
  const names = triggers.map((t) => `${t.tbl}.${t.name}`);
  for (const expected of [
    'appointments.trial_appointments',
    'appointments.appointments_billing_mode_guard',
    'lancamentos.trial_financial_entries',
    'lancamentos.lancamentos_convenio_patient_guard',
  ]) {
    assert.ok(names.includes(expected), `falta ${expected}: ${names.join(', ')}`);
  }
  pass('gatilhos convivem: trial do #53 (AFTER INSERT) e convênio (BEFORE) em appointments e lancamentos');

  // ── Fixture: clínica em TRIAL (plano 2026) com o módulo de convênio ligado ──
  const clinicId = randomUUID();
  const ownerId = randomUUID();
  for (const id of [ownerId]) await sql`insert into auth.users (id, email) values (${id}::uuid, ${`${id}@example.invalid`})`;
  await sql`insert into public.clinics (id, slug, nome, status)
    values (${clinicId}::uuid, ${`union-${clinicId.slice(0, 8)}`}, 'Clínica sintética em trial', 'active')`;
  await sql`insert into public.profiles (id, clinic_id, nome, role, ativo, invite_accepted_at)
    values (${ownerId}::uuid, ${clinicId}::uuid, 'Dona e médica sintética', 'owner', true, now())`;
  const [catalog] = await sql`select p.id as plan_id, pr.id as price_id from public.plans p
      join public.prices pr on pr.plan_id = p.id
     where p.code = 'clinica_2026_2' and pr.billing_cycle = 'monthly' and pr.active_until is null
       and pr.campaign_code is null limit 1`;
  assert.ok(catalog, 'catálogo 2026 ausente na cadeia');
  await sql`insert into public.subscriptions (clinic_id, plan_id, price_id, billing_status, trial_ends_at, enforce_trial_deadline, billing_provider)
    values (${clinicId}::uuid, ${catalog.plan_id}::uuid, ${catalog.price_id}::uuid, 'trial', now() + interval '14 days', true, 'abacatepay')`;
  const [policy] = await sql`select released_at from public.trial_access_policies where clinic_id = ${clinicId}::uuid`;
  assert.ok(policy && policy.released_at === null, 'a assinatura nova deveria entrar no trial com limites');
  await sql`insert into public.hi_clinic_settings (clinic_id, enabled, enabled_at, enabled_by, provider_kind, cnes_status)
    values (${clinicId}::uuid, true, now(), ${SYS}, 'PJ', 'none_declared')`;
  const [ins] = await sql`insert into public.hi_insurers
      (clinic_id, name, registro_ans, provider_id_kind, provider_id_value, status, created_by)
    values (${clinicId}::uuid, 'Operadora Um', '123456', 'codigoPrestadorNaOperadora', 'TESTE001', 'active', ${SYS}::uuid) returning id`;
  await sql`insert into public.hi_professional_profiles (clinic_id, professional_id, council, council_number, council_uf, cbo)
    values (${clinicId}::uuid, ${ownerId}::uuid, '06', '12345', '35', '225125')`;
  const [proc] = await sql`insert into public.procedures (clinic_id, codigo, descricao, valor_padrao, duracao_padrao_min, ativo)
    values (${clinicId}::uuid, 'CONS', 'Consulta sintética', 150, 30, true) returning id`;
  await sql`insert into public.hi_procedure_contracts
      (clinic_id, insurer_id, guide_type, table_code, procedure_code, description, procedure_id,
       unit_value_cents, valid_from, copay_kind, copay_percentage, created_by)
    values (${clinicId}::uuid, ${ins!.id}::uuid, 'consulta', '22', '10101012', 'Consulta em consultório',
      ${proc!.id}::uuid, 15000, '2026-01-01', 'percentage', 30, ${SYS}::uuid)`;
  await sql`insert into public.tiss_terminology_versions (version, archive_url, archive_sha256, manifest_sha256)
    values ('202609', 'https://example.invalid/tuss.zip', ${'a'.repeat(64)}, ${'b'.repeat(64)}) on conflict (version) do nothing`;
  let slot = 0;
  const visit = async (mode: 'particular' | 'convenio') => {
    slot += 1;
    const [p] = await sql`insert into public.patients (clinic_id, nome, cpf_encrypted, cpf_hash)
      values (${clinicId}::uuid, ${`Paciente ${slot}`}, 'ciphertext-de-teste', ${`hash-${randomUUID()}`}) returning id`;
    const [card] = await sql`insert into public.hi_memberships
        (clinic_id, patient_id, insurer_id, card_number_encrypted, card_number_hash, card_last4, created_by)
      values (${clinicId}::uuid, ${p!.id}::uuid, ${ins!.id}::uuid, 'AQAAAAAAAAAAAAAAAAAAAAAAAAAAAA==', ${randomUUID().replace(/-/g, '').padEnd(64, '0')}, '9876', ${SYS}::uuid) returning id`;
    const [a] = await sql`insert into public.appointments (
        clinic_id, doctor_id, patient_id, procedure_id, scheduled_at, duration_min, status, valor,
        snapshot_procedure_name, snapshot_procedure_valor, snapshot_procedure_duracao_min, snapshot_doctor_nome, created_via)
      values (${clinicId}::uuid, ${ownerId}::uuid, ${p!.id}::uuid, ${proc!.id}::uuid,
        '2026-11-12T12:00:00Z'::timestamptz + ${slot} * interval '1 hour', 30, 'agendado', 150,
        'Consulta', 150, 30, 'Profissional sintético', 'attendant') returning id`;
    const v = { appointmentId: a!.id as string, patientId: p!.id as string, cardId: card!.id as string };
    if (mode === 'convenio') {
      await sql`update public.appointments set billing_mode = 'convenio' where id = ${v.appointmentId}::uuid`;
      await withTenant(clinicId, (tx) => recordAppointmentCoverage(tx, {
        clinicId, appointmentId: v.appointmentId, patientId: v.patientId, procedureId: proc!.id as string,
        appointmentDate: '2026-11-12', guideType: 'consulta', insurerId: ins!.id as string, planId: null,
        membershipId: v.cardId, authorizationId: null, actor: { kind: 'user', userId: ownerId },
      }), ownerId);
    }
    return v;
  };
  const complete = async (v: { appointmentId: string; patientId: string }) => {
    await sql`update public.appointments set status = 'em_atendimento' where id = ${v.appointmentId}::uuid`;
    await sql`insert into public.prontuarios (clinic_id, patient_id, doctor_id, appointment_id, status, signed_at, signed_by, content_encrypted)
      values (${clinicId}::uuid, ${v.patientId}::uuid, ${ownerId}::uuid, ${v.appointmentId}::uuid, 'assinado', now(), ${ownerId}::uuid, 'ciphertext-sintetico')`;
    await withTenant(clinicId, (tx) => applyTransition(tx, {
      clinicId, appointmentId: v.appointmentId, target: 'atendido', transitionedBy: ownerId, actorType: 'user',
      clientKey: `concluir-${v.appointmentId}`, correlationId: null,
    }), ownerId);
    for (let i = 0; i < 6; i++) await runOutboxOnce({ batchSize: 50, parallelism: 1 });
  };
  const receivablesUsed = async () =>
    ((await sql`select coalesce((select consumed from public.trial_resource_usage
        where clinic_id = ${clinicId}::uuid and metric = 'receivables'), 0)::int as n`)[0] as { n: number }).n;
  const lanc = async (id: string) =>
    sql`select valor::text as valor from public.lancamentos where appointment_id = ${id}::uuid and tipo = 'receber'`;

  // ── 3. Trial: particular igual; convênio não consome recebível ───────
  const vPart = await visit('particular');
  const r0 = await receivablesUsed();
  await complete(vPart);
  assert.deepEqual([(await lanc(vPart.appointmentId)).map((l) => l.valor), await receivablesUsed()], [['150.00'], r0 + 1]);
  const vConv = await visit('convenio');
  const r1 = await receivablesUsed();
  await complete(vConv);
  const [guide] = await sql`select status from public.hi_guides where idempotency_key = ${`appointment:${vConv.appointmentId}:consulta`}`;
  assert.deepEqual([guide!.status, (await lanc(vConv.appointmentId)).length, await receivablesUsed()], ['ready_for_review', 0, r1]);
  pass('clínica em trial: particular gera o recebível de R$ 150 e consome 1 do limite, como no #53; convênio gera a guia, nenhum recebível e não consome o limite de recebíveis');

  // ── 4. A rede do convênio recusa ANTES do gatilho do trial ───────────
  const r2 = await receivablesUsed();
  await assert.rejects(
    () => sql`insert into public.lancamentos (clinic_id, tipo, descricao, valor, status, due_date, patient_id, appointment_id, created_via)
      values (${clinicId}::uuid, 'receber', 'Consulta', '150.00', 'pendente', current_date, ${vConv.patientId}::uuid, ${vConv.appointmentId}::uuid, 'manual')`,
    (e: unknown) => {
      const err = e as { code?: string; message?: string };
      assert.equal(err.code, '23514');
      assert.match(String(err.message), /coparticipa/iu);
      return true;
    },
  );
  assert.equal(await receivablesUsed(), r2);
  pass('recebível cheio de convênio recusado pela rede da 0148 antes do gatilho do trial: nada consumido');

  // ── 5 e 6. Coparticipação confirmada no trial ────────────────────────
  const confirm = async (appointmentId: string) => {
    const [cp] = await sql`select id from public.hi_copayments where appointment_id = ${appointmentId}::uuid`;
    await withTenant(clinicId, (tx) => checkCopay(tx, { clinicId, copaymentId: cp!.id as string, checkedCents: 4500, actorUserId: ownerId }), ownerId);
    await withTenant(clinicId, (tx) => confirmCopay(tx, { clinicId, copaymentId: cp!.id as string, confirmedCents: 4500, chargeableCents: 4500, actorUserId: ownerId, procedureName: 'Consulta' }), ownerId);
    for (let i = 0; i < 4; i++) await runOutboxOnce({ batchSize: 50, parallelism: 1 });
  };
  const r3 = await receivablesUsed();
  await confirm(vConv.appointmentId);
  assert.deepEqual([(await lanc(vConv.appointmentId)).map((l) => l.valor), await receivablesUsed()], [['45.00'], r3 + 1]);
  pass('coparticipação confirmada: recebível de R$ 45 (nunca R$ 150), que conta no limite de recebíveis do trial (política do #53)');

  const vLimit = await visit('convenio');
  await complete(vLimit);
  await sql`update public.trial_resource_usage set consumed = 15 where clinic_id = ${clinicId}::uuid and metric = 'receivables'`;
  await confirm(vLimit.appointmentId);
  const [ev] = await sql`select status, attempts, error_code from public.outbox
    where event_type = 'health_insurance.copay.confirmed' and payload->>'appointmentId' = ${vLimit.appointmentId} `;
  const [cpLimit] = await sql`select status from public.hi_copayments where appointment_id = ${vLimit.appointmentId}::uuid`;
  assert.deepEqual([(await lanc(vLimit.appointmentId)).length, ev!.status !== 'processed', ev!.attempts > 0, cpLimit!.status], [0, true, true, 'confirmed']);
  pass(`no limite do trial, o recebível da coparticipação é barrado pelo #53: nenhum lançamento parcial, a coparticipação fica confirmada e o evento fica para retentativa (estado ${ev!.status}, ${ev!.attempts} tentativa(s)) — risco registrado para a política de trial`);

  console.log(`\nOK — ${passed}/6 provas da cadeia unida (main + #53 ${REF} + #55) em Postgres descartável.`);
} finally {
  await cluster.stop();
}
