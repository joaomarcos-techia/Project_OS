/**
 * Convênios × #53 — prova da CADEIA UNIDA na ordem real do DEV, com o SQL real
 * das duas branches (não só o teste de ordem do journal):
 *
 *   main 0000–0135 → #53 0136–0142 (lidas do commit do #53 por `git show`)
 *   → #55 0143–0152
 *
 * D24 (decisão definitiva do fundador, 11/11/2026): o trial de 14 dias é para
 * conhecer o Qoro; Convênios, cobrança de pacientes pelo Asaas e Agentes de IA só
 * com assinatura paga e ativa. Aqui, com a política de trial REAL do #53
 * (`trial_access_policies`, liberada só por fatura paga verificada):
 *  1. a cadeia aplica inteira, contígua, sem colisão de prefixo;
 *  2. os gatilhos das duas branches convivem nas tabelas compartilhadas;
 *  3. clínica em trial: Convênios não liga, atendimento não vira convênio; a decisão
 *     central nega os 3 recursos; os gatilhos do #53 barram conectar Asaas e WhatsApp
 *     (o canal do Agente de IA);
 *  4. particular no trial igual ao #53 (recebível + consumo da cota);
 *  5. R33 resolvido pela regra: no limite de recebíveis do trial não existe
 *     coparticipação, porque não existe convênio no trial (sem exceção ao limite);
 *  6. assinatura marcada ativa SEM pagamento verificado continua negada;
 *  7. pagamento verificado (liberação do #53): Convênios liga, guia automática,
 *     coparticipação de R$ 45 vira recebível, sem cota de trial;
 *  8. a rede da 0148 segue recusando recebível cheio de convênio na clínica paga;
 *  9. a decisão do banco e a do código REAL do #53 (src/lib/entitlements) concordam
 *     numa matriz de estados (carência, cancelamento no fim do período, suspensa…).
 *
 * Não toca o worktree do #53 (só lê objetos git) nem DEV/produção. Uso:
 *   NODE_OPTIONS=--conditions=react-server npx tsx scripts/security/health-insurance-union-chain-db.ts [ref-do-53]
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { sql as dsql } from 'drizzle-orm';

import { readMigrations, startScratchSchema } from './scratch-schema';

const REF = process.argv[2] ?? process.env.PR53_REF ?? '9ddc432a';
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
  assert.ok((await has('trial_resource_usage')) && (await has('hi_billing_gaps')) && (await has('hi_batches')));
  pass(`cadeia unida aplica inteira no Postgres 17: ${chain.length} migrations (0000–${String(chain.length - 1).padStart(4, '0')}), 0136–0142 do #53 em ${REF}, prefixos contíguos; ${applied} marcas de versão`);

  // ── 2. Gatilhos das duas branches nas tabelas compartilhadas ─────────
  const triggers = await sql`select c.relname as tbl, t.tgname as name
      from pg_trigger t join pg_class c on c.oid = t.tgrelid
     where not t.tgisinternal and c.relname in ('appointments', 'lancamentos') order by 1, 2`;
  const names = triggers.map((t) => `${t.tbl}.${t.name}`);
  for (const expected of [
    'appointments.trial_appointments',
    'appointments.appointments_billing_mode_guard',
    'appointments.a0_hi_premium_appointment',
    'lancamentos.trial_financial_entries',
    'lancamentos.lancamentos_convenio_patient_guard',
  ]) {
    assert.ok(names.includes(expected), `falta ${expected}: ${names.join(', ')}`);
  }
  pass('gatilhos convivem: trial do #53 (AFTER INSERT), convênio e bloqueio comercial (BEFORE) em appointments e lancamentos');

  // ── Fixture: clínica em TRIAL (plano 2026), inscrita na política do #53 ──
  const clinicId = randomUUID();
  const ownerId = randomUUID();
  await sql`insert into auth.users (id, email) values (${ownerId}::uuid, ${`${ownerId}@example.invalid`})`;
  await sql`insert into public.clinics (id, slug, nome, status)
    values (${clinicId}::uuid, ${`union-${clinicId.slice(0, 8)}`}, 'Clínica sintética em trial', 'active')`;
  await sql`insert into public.profiles (id, clinic_id, nome, role, ativo, invite_accepted_at)
    values (${ownerId}::uuid, ${clinicId}::uuid, 'Dona e médica sintética', 'owner', true, now())`;
  const [catalog] = await sql`select p.id as plan_id, pr.id as price_id from public.plans p
      join public.prices pr on pr.plan_id = p.id
     where p.code = 'clinica_2026_2' and pr.billing_cycle = 'monthly' and pr.active_until is null
       and pr.campaign_code is null limit 1`;
  assert.ok(catalog, 'catálogo 2026 ausente na cadeia');
  const [sub] = await sql`insert into public.subscriptions (clinic_id, plan_id, price_id, billing_status, trial_ends_at, enforce_trial_deadline, billing_provider)
    values (${clinicId}::uuid, ${catalog.plan_id}::uuid, ${catalog.price_id}::uuid, 'trial', now() + interval '14 days', true, 'abacatepay')
    returning id`;
  const [policy] = await sql`select released_at from public.trial_access_policies where clinic_id = ${clinicId}::uuid`;
  assert.ok(policy && policy.released_at === null, 'a assinatura nova deveria entrar no trial com limites');
  const denial = (feature: string) =>
    withTenant(clinicId, async (tx) =>
      ((await tx.execute(dsql`select public.qoro_premium_denial(${clinicId}::uuid, ${feature}) as d`)) as unknown as Array<{ d: string | null }>)[0]!.d);
  const [proc] = await sql`insert into public.procedures (clinic_id, codigo, descricao, valor_padrao, duracao_padrao_min, ativo)
    values (${clinicId}::uuid, 'CONS', 'Consulta sintética', 150, 30, true) returning id`;
  const enableInsurance = async () => {
    await sql`insert into public.hi_clinic_settings (clinic_id, enabled, enabled_at, enabled_by, provider_kind, cnes_status)
      values (${clinicId}::uuid, true, now(), ${SYS}, 'PJ', 'none_declared')
      on conflict (clinic_id) do update set enabled = true, enabled_at = now(), enabled_by = ${SYS}`;
  };
  const premiumBlocked = (reason: string) => (e: unknown) => {
    const err = e as { code?: string; constraint_name?: string; detail?: string };
    assert.deepEqual([err.code, err.constraint_name, err.detail], ['23514', 'qoro_premium_health_insurance', reason]);
    return true;
  };
  const trialBlocked = (feature: string) => (e: unknown) => {
    const err = e as { code?: string; constraint_name?: string };
    assert.deepEqual([err.code, err.constraint_name], ['23514', `qoro_trial_limit_${feature}`]);
    return true;
  };
  let slot = 0;
  const newPatient = async () => {
    slot += 1;
    const [p] = await sql`insert into public.patients (clinic_id, nome, cpf_encrypted, cpf_hash)
      values (${clinicId}::uuid, ${`Paciente ${slot}`}, 'ciphertext-de-teste', ${`hash-${randomUUID()}`}) returning id`;
    return p!.id as string;
  };
  const newAppointment = async (patientId: string) => {
    slot += 1;
    const [a] = await sql`insert into public.appointments (
        clinic_id, doctor_id, patient_id, procedure_id, scheduled_at, duration_min, status, valor,
        snapshot_procedure_name, snapshot_procedure_valor, snapshot_procedure_duracao_min, snapshot_doctor_nome, created_via)
      values (${clinicId}::uuid, ${ownerId}::uuid, ${patientId}::uuid, ${proc!.id}::uuid,
        '2026-11-12T12:00:00Z'::timestamptz + ${slot} * interval '1 hour', 30, 'agendado', 150,
        'Consulta', 150, 30, 'Profissional sintético', 'attendant') returning id`;
    return a!.id as string;
  };
  const complete = async (appointmentId: string, patientId: string) => {
    await sql`update public.appointments set status = 'em_atendimento' where id = ${appointmentId}::uuid`;
    await sql`insert into public.prontuarios (clinic_id, patient_id, doctor_id, appointment_id, status, signed_at, signed_by, content_encrypted)
      values (${clinicId}::uuid, ${patientId}::uuid, ${ownerId}::uuid, ${appointmentId}::uuid, 'assinado', now(), ${ownerId}::uuid, 'ciphertext-sintetico')`;
    await withTenant(clinicId, (tx) => applyTransition(tx, {
      clinicId, appointmentId, target: 'atendido', transitionedBy: ownerId, actorType: 'user',
      clientKey: `concluir-${appointmentId}`, correlationId: null,
    }), ownerId);
    for (let i = 0; i < 6; i++) await runOutboxOnce({ batchSize: 50, parallelism: 1 });
  };
  const receivablesUsed = async () =>
    ((await sql`select coalesce((select consumed from public.trial_resource_usage
        where clinic_id = ${clinicId}::uuid and metric = 'receivables'), 0)::int as n`)[0] as { n: number }).n;
  const lanc = async (id: string) =>
    sql`select valor::text as valor from public.lancamentos where appointment_id = ${id}::uuid and tipo = 'receber'`;
  const tissRows = async () =>
    ((await sql`select ((select count(*) from public.hi_clinic_settings where clinic_id = ${clinicId}::uuid)
        + (select count(*) from public.hi_appointment_coverages where clinic_id = ${clinicId}::uuid)
        + (select count(*) from public.hi_copayments where clinic_id = ${clinicId}::uuid)
        + (select count(*) from public.hi_guides where clinic_id = ${clinicId}::uuid))::int as n`)[0] as { n: number }).n;

  // ── 3. Trial: Convênios, Asaas e WhatsApp (canal do Agente de IA) barrados ──
  for (const feature of ['health_insurance', 'patient_charges', 'ai_agents']) {
    assert.equal(await denial(feature), 'trial');
  }
  await assert.rejects(enableInsurance, premiumBlocked('trial'));
  const pTrial = await newPatient();
  const aTrial = await newAppointment(pTrial);
  await assert.rejects(
    () => sql`update public.appointments set billing_mode = 'convenio' where id = ${aTrial}::uuid`,
    premiumBlocked('trial'),
  );
  await assert.rejects(
    () => sql`insert into public.clinic_payment_accounts (clinic_id, api_key_encrypted, api_key_hash, active, connected_at)
      values (${clinicId}::uuid, 'ciphertext-sintetico', ${'c'.repeat(64)}, true, now())`,
    trialBlocked('asaas'),
  );
  await assert.rejects(
    () => sql`insert into public.clinic_whatsapp_numbers (clinic_id, phone_number, meta_phone_id, token_encrypted, active)
      values (${clinicId}::uuid, '+5500000000000', 'phone-sintetico', 'ciphertext-sintetico', true)`,
    trialBlocked('whatsapp'),
  );
  assert.equal(await tissRows(), 0);
  pass('clínica em trial (política do #53): a decisão central nega Convênios, cobrança e IA; o módulo não liga e o atendimento não vira convênio; os gatilhos do #53 barram conectar Asaas e WhatsApp (canal do Agente de IA)');

  // ── 4. Particular no trial igual ao #53 ──────────────────────────────
  const r0 = await receivablesUsed();
  await complete(aTrial, pTrial);
  assert.deepEqual([(await lanc(aTrial)).map((l) => l.valor), await receivablesUsed()], [['150.00'], r0 + 1]);
  pass('particular no trial: recebível de R$ 150 e 1 da cota consumida, exatamente como no #53');

  // ── 5. R33: no limite do trial não existe coparticipação ─────────────
  await sql`update public.trial_resource_usage set consumed = 15 where clinic_id = ${clinicId}::uuid and metric = 'receivables'`;
  await assert.rejects(enableInsurance, premiumBlocked('trial'));
  const pLimit = await newPatient();
  const aLimit = await newAppointment(pLimit);
  await assert.rejects(
    () => sql`update public.appointments set billing_mode = 'convenio' where id = ${aLimit}::uuid`,
    premiumBlocked('trial'),
  );
  const [{ consumed }] = (await sql`select consumed from public.trial_resource_usage
    where clinic_id = ${clinicId}::uuid and metric = 'receivables'`) as unknown as [{ consumed: number }];
  assert.deepEqual([consumed, await tissRows()], [15, 0]);
  pass('R33 resolvido pela regra comercial: no limite de 15 recebíveis do trial não há convênio, logo não há coparticipação presa; o limite não muda (sem exceção) e nenhuma linha de Convênios existe');

  // ── 6. "Ativa" sem pagamento verificado continua negada ──────────────
  await sql`update public.subscriptions set billing_status = 'active' where clinic_id = ${clinicId}::uuid`;
  assert.equal(await denial('health_insurance'), 'payment_pending');
  await assert.rejects(enableInsurance, premiumBlocked('payment_pending'));
  pass('assinatura marcada ativa SEM a liberação do #53 (fatura paga verificada): Convênios continua negado ("pagamento pendente")');

  // ── 7. Pagamento verificado: liberação do #53 e Convênios funcionando ─
  const [invoice] = await sql`insert into public.invoices (clinic_id, subscription_id, total_amount, status, due_date, paid_at)
    values (${clinicId}::uuid, ${sub!.id}::uuid, '199.00', 'paid', current_date, now()) returning id`;
  // Mesmo UPDATE de `releaseTrialAfterVerifiedPaymentTx` (#53, src/lib/trial-access): só fatura paga > 0 libera.
  await sql`UPDATE public.trial_access_policies AS policy
       SET released_at = now(), released_by_invoice_id = invoice.id, updated_at = now()
      FROM public.invoices AS invoice
     WHERE policy.clinic_id = ${clinicId}::uuid AND policy.released_at IS NULL
       AND invoice.id = ${invoice!.id}::uuid AND invoice.clinic_id = policy.clinic_id
       AND invoice.subscription_id = policy.subscription_id
       AND invoice.status = 'paid' AND invoice.paid_at IS NOT NULL AND invoice.total_amount > 0`;
  for (const feature of ['health_insurance', 'patient_charges', 'ai_agents']) {
    assert.equal(await denial(feature), null);
  }
  await enableInsurance();
  const [ins] = await sql`insert into public.hi_insurers
      (clinic_id, name, registro_ans, provider_id_kind, provider_id_value, status, created_by)
    values (${clinicId}::uuid, 'Operadora Um', '123456', 'codigoPrestadorNaOperadora', 'TESTE001', 'active', ${SYS}::uuid) returning id`;
  await sql`insert into public.hi_professional_profiles (clinic_id, professional_id, council, council_number, council_uf, cbo)
    values (${clinicId}::uuid, ${ownerId}::uuid, '06', '12345', '35', '225125')`;
  await sql`insert into public.hi_procedure_contracts
      (clinic_id, insurer_id, guide_type, table_code, procedure_code, description, procedure_id,
       unit_value_cents, valid_from, copay_kind, copay_percentage, created_by)
    values (${clinicId}::uuid, ${ins!.id}::uuid, 'consulta', '22', '10101012', 'Consulta em consultório',
      ${proc!.id}::uuid, 15000, '2026-01-01', 'percentage', 30, ${SYS}::uuid)`;
  await sql`insert into public.tiss_terminology_versions (version, archive_url, archive_sha256, manifest_sha256)
    values ('202609', 'https://example.invalid/tuss.zip', ${'a'.repeat(64)}, ${'b'.repeat(64)}) on conflict (version) do nothing`;
  const pConv = await newPatient();
  const [card] = await sql`insert into public.hi_memberships
      (clinic_id, patient_id, insurer_id, card_number_encrypted, card_number_hash, card_last4, created_by)
    values (${clinicId}::uuid, ${pConv}::uuid, ${ins!.id}::uuid, 'AQAAAAAAAAAAAAAAAAAAAAAAAAAAAA==', ${randomUUID().replace(/-/g, '').padEnd(64, '0')}, '9876', ${SYS}::uuid) returning id`;
  const aConv = await newAppointment(pConv);
  await sql`update public.appointments set billing_mode = 'convenio' where id = ${aConv}::uuid`;
  await withTenant(clinicId, (tx) => recordAppointmentCoverage(tx, {
    clinicId, appointmentId: aConv, patientId: pConv, procedureId: proc!.id as string,
    appointmentDate: '2026-11-12', guideType: 'consulta', insurerId: ins!.id as string, planId: null,
    membershipId: card!.id as string, authorizationId: null, actor: { kind: 'user', userId: ownerId },
  }), ownerId);
  await complete(aConv, pConv);
  const [guide] = await sql`select status from public.hi_guides where idempotency_key = ${`appointment:${aConv}:consulta`}`;
  assert.deepEqual([guide?.status, (await lanc(aConv)).length], ['ready_for_review', 0]);
  const [cp] = await sql`select id from public.hi_copayments where appointment_id = ${aConv}::uuid`;
  await withTenant(clinicId, (tx) => checkCopay(tx, { clinicId, copaymentId: cp!.id as string, checkedCents: 4500, actorUserId: ownerId }), ownerId);
  await withTenant(clinicId, (tx) => confirmCopay(tx, { clinicId, copaymentId: cp!.id as string, confirmedCents: 4500, chargeableCents: 4500, actorUserId: ownerId, procedureName: 'Consulta' }), ownerId);
  for (let i = 0; i < 4; i++) await runOutboxOnce({ batchSize: 50, parallelism: 1 });
  assert.deepEqual((await lanc(aConv)).map((l) => l.valor), ['45.00']);
  pass('pagamento verificado (fatura paga libera a política do #53): os 3 recursos liberados; Convênios liga, guia automática, coparticipação confirmada vira recebível de R$ 45 (nunca R$ 150), sem cota de trial');

  // ── 8. A rede da 0148 segue valendo na clínica paga ──────────────────
  await assert.rejects(
    () => sql`insert into public.lancamentos (clinic_id, tipo, descricao, valor, status, due_date, patient_id, appointment_id, created_via)
      values (${clinicId}::uuid, 'receber', 'Consulta', '150.00', 'pendente', current_date, ${pConv}::uuid, ${aConv}::uuid, 'manual')`,
    (e: unknown) => {
      const err = e as { code?: string; message?: string };
      assert.equal(err.code, '23514');
      assert.match(String(err.message), /coparticipa/iu);
      return true;
    },
  );
  pass('clínica paga: recebível cheio de convênio continua recusado pela rede da 0148');

  // ── 9. A decisão do banco (0151/0152) e a do #53 (entitlements) concordam ─
  // O código REAL do #53 em REF: a regra pura (`evaluateModuleAccess`) e a consulta que a
  // alimenta (`getOperationalModuleAccessTx`), lidas por `git show`, sem tocar o worktree dele.
  const hasEntitlements = git('ls-tree', '--name-only', REF, 'src/lib/entitlements/').includes('policy.ts');
  if (hasEntitlements) {
    const dir = mkdtempSync(path.join(tmpdir(), 'pr53-entitlements-'));
    const policyFile = path.join(dir, 'policy.mts');
    writeFileSync(policyFile, git('show', `${REF}:src/lib/entitlements/policy.ts`));
    const pr53 = (await import(pathToFileURL(policyFile).href)) as {
      evaluateModuleAccess: (s: unknown, m: string, now: Date) => { allowed: boolean; reason?: string };
    };
    const indexSrc = git('show', `${REF}:src/lib/entitlements/index.ts`);
    const query = /tx\.execute\(sql`([\s\S]*?)`\)/u.exec(indexSrc)![1]!.replace('${clinicId}', '$1');
    const compare = async (label: string) => {
      const [row] = await sql.unsafe(query, [clinicId]);
      for (const [module, feature] of [['patient_payments', 'patient_charges'], ['ai_agents', 'ai_agents']] as const) {
        const theirs = pr53.evaluateModuleAccess(row ?? null, module, new Date());
        const ours = await denial(feature);
        assert.equal(ours === null, theirs.allowed, `${label} / ${module}: #53 ${JSON.stringify(theirs)} × banco ${ours}`);
      }
      // Convênios: o #53 mantém o módulo indisponível até a liberação controlada; o banco
      // decide só o direito comercial, e a habilitação operacional (hi_clinic_settings) segue à parte.
      assert.equal(pr53.evaluateModuleAccess(row ?? null, 'health_insurance', new Date()).allowed, false);
    };
    const setState = (s: { billing: string; start: string; end: string | null; grace: string | null; cancelAtEnd?: boolean; clinic?: string }) =>
      sql.begin(async (t) => {
        await t`update public.subscriptions set billing_status = ${s.billing},
                 current_period_start = now() + ${s.start}::interval,
                 current_period_end = ${s.end === null ? null : t`now() + ${s.end}::interval`},
                 grace_period_until = ${s.grace === null ? null : t`now() + ${s.grace}::interval`},
                 cancel_at_period_end = ${s.cancelAtEnd ?? false}
               where clinic_id = ${clinicId}::uuid`;
        await t`update public.clinics set status = ${s.clinic ?? 'active'}::clinic_status where id = ${clinicId}::uuid`;
      });
    const matrix: Array<[string, Parameters<typeof setState>[0]]> = [
      ['ativa, liberada, período em curso', { billing: 'active', start: '-10 days', end: '20 days', grace: '23 days' }],
      ['past_due dentro da carência', { billing: 'past_due', start: '-32 days', end: '-2 days', grace: '1 day' }],
      ['past_due depois da carência', { billing: 'past_due', start: '-34 days', end: '-4 days', grace: '-1 hour' }],
      ['cancelada no fim do período, já vencido', { billing: 'active', start: '-30 days', end: '-1 hour', grace: '2 days', cancelAtEnd: true }],
      ['cancelada', { billing: 'cancelled', start: '-10 days', end: '20 days', grace: '23 days' }],
      ['clínica suspensa pelo dunning', { billing: 'past_due', start: '-40 days', end: '-10 days', grace: '-3 days', clinic: 'suspended_readonly' }],
      ['pagamento pendente', { billing: 'active', start: '-10 days', end: '20 days', grace: '23 days', clinic: 'pending_payment' }],
      ['de volta ao trial', { billing: 'trial', start: '-1 day', end: '13 days', grace: null }],
    ];
    for (const [label, state] of matrix) {
      await setState(state);
      await compare(label);
    }
    await setState(matrix[0]![1]);
    pass(`mesma decisão que o código REAL do #53 em ${REF} (evaluateModuleAccess + a consulta dele) para cobrança de pacientes e Agentes de IA em ${matrix.length} estados: ativa, past_due dentro e fora da carência, cancelada no fim do período, cancelada, suspensa, pagamento pendente e trial; Convênios segue indisponível no #53 até a liberação controlada`);
  } else {
    console.log(`(sem src/lib/entitlements em ${REF}: comparação com o #53 não se aplica)`);
  }

  const expected = hasEntitlements ? 9 : 8;
  console.log(`\nOK — ${passed}/${expected} provas da cadeia unida (main + #53 ${REF} + #55) em Postgres descartável.`);
  assert.equal(passed, expected);
} finally {
  await cluster.stop();
}
