/**
 * R38 — regressão financeira DIFERENCIAL da 0155 em Postgres DESCARTÁVEL (cadeia na ordem do
 * DEV: main → #53 0136–0142 → #55 0143–0154). Nunca no DEV compartilhado; só dados sintéticos.
 *
 * O mesmo roteiro roda duas vezes, em clínicas novas: com a função atual (V0) e depois de
 * aplicar a 0155 pelo arquivo real (V1). A transcrição de cada operação (aceita ou o motivo
 * da recusa) e o estado final (lançamentos, livro de caixa, diário da ponte) precisam ser
 * IDÊNTICOS. Cobre: pagamento particular (runtime com RLS e service_role), parcial, excesso,
 * estorno, estorno acima do pago, repagamento depois de estorno, recebível cancelado,
 * operação duplicada, rollback, clínica errada, disputa concorrente no mesmo lançamento,
 * clínicas paga, em trial (política do #53) e suspensa, coparticipação (fluxo real até o
 * recebível de R$ 45), convênio pela ponte da 0153 (pagamento exato, parcial, glosa
 * definitiva, estorno da alocação, Caixa barrado) e 300 operações aleatórias com semente fixa.
 *
 * Depois, documenta a ÚNICA diferença possível: uma linha do livro com clínica diferente da do
 * seu lançamento (só existe se gravada com o gatilho desligado). O pré-voo da aplicação conta
 * essas linhas — a mesma consulta roda aqui.
 *
 *   NODE_OPTIONS=--conditions=react-server npx tsx scripts/security/hi-r38-ledger-equivalence-db.ts
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { readDevOrderChain } from './dev-order-chain';
import { startScratchSchema } from './scratch-schema';

const chain = await readDevOrderChain();
const i0155 = chain.findIndex((m) => m.file.startsWith('0155_'));
assert.ok(i0155 > 0, '0155 ausente da cadeia');
const m0155 = readFileSync('drizzle/migrations/0155_ledger_payment_sum_by_clinic.sql', 'utf8');

const cluster = await startScratchSchema({ port: 55521, maxConnections: 24, migrations: chain.slice(0, i0155) });
const { sql } = cluster;
if (!/@(?:127\.0\.0\.1|localhost):55521\//u.test(cluster.url)) throw new Error('não é o cluster local');
process.env.DATABASE_URL = cluster.url;
delete process.env.DATABASE_URL_RUNTIME;
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://ci.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_ci';
process.env.OUTBOX_CRON_ALLOW_NON_VERCEL = 'true';
process.env.CRYPTO_SECRET_BACKEND = 'env';
process.env.CRYPTO_MASTER_KEY_V1 = Buffer.alloc(32, 7).toString('base64');
process.env.CRYPTO_LOOKUP_SALT = Buffer.alloc(32, 9).toString('base64');

const { withTenant } = await import('../../src/lib/db/tenant');
await import('../../src/app/api/cron/outbox/handlers');
const { runOutboxOnce } = await import('../../src/lib/outbox/worker');
const { applyTransition } = await import('../../src/contexts/scheduling/internal/appointment-core');
const { recordAppointmentCoverage } = await import('../../src/contexts/health-insurance/internal/coverage-service');
const { checkCopay, confirmCopay } = await import('../../src/contexts/health-insurance/internal/copay-service');
const acct = await import('../../src/contexts/health-insurance/internal/insurance-account-service');
const { loadXmllintValidator } = await import('../../src/contexts/health-insurance/tiss/xml/xsd-validator');
const { loadHiFixtures, GUIDE_VALUE_CENTS: VALUE, SYS_ACTOR } = await import('./hi-fixtures');

const xsd = loadXmllintValidator();
if (!xsd) throw new Error('validador XSD do app indisponível (TISS_XMLLINT_WASM_DIR fora do CI)');
const objects = new Map<string, Uint8Array>();
const store = {
  async put(ref: string, bytes: Uint8Array) { objects.set(ref, bytes); },
  async get(ref: string) { return objects.get(ref)!; },
  async remove(ref: string) { objects.delete(ref); },
};
const fx = await loadHiFixtures(sql, { store, validateXsd: xsd });

let passed = 0;
const pass = (msg: string) => {
  passed += 1;
  console.log(`PASS: ${msg}`);
};
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/giu;
const reason = (e: unknown) => {
  const err = e as { message?: string; cause?: { message?: string }; code?: string };
  return `${err.code ?? err.cause?.message ?? ''} ${err.message ?? String(e)}`.replace(UUID, '<id>').trim().slice(0, 140);
};

/** Roteiro completo; devolve a transcrição e o estado normalizado. */
async function runScenario(tag: string) {
  const transcript: string[] = [];
  const step = async (label: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
      transcript.push(`${label}: ok`);
    } catch (e) {
      transcript.push(`${label}: ${reason(e)}`);
    }
  };
  const clinics: Record<string, string> = {};

  async function clinic(label: string, state: 'paid' | 'trial' | 'suspended') {
    const id = randomUUID();
    await sql`insert into public.clinics (id, slug, nome, status) values (${id}::uuid, ${`r38-${tag}-${label}`}, ${`Clínica ${label}`}, 'active')`;
    const owner = randomUUID();
    await sql`insert into auth.users (id, email) values (${owner}::uuid, ${`${owner}@example.invalid`})`;
    await sql`insert into public.profiles (id, clinic_id, nome, role, ativo, invite_accepted_at)
      values (${owner}::uuid, ${id}::uuid, 'Dona sintética', 'owner', true, now())`;
    const [cat] = await sql`select p.id as plan_id, pr.id as price_id from public.plans p join public.prices pr on pr.plan_id = p.id
       where p.code = 'clinica_2026_2' and pr.billing_cycle = 'monthly' and pr.active_until is null and pr.campaign_code is null limit 1`;
    if (state === 'trial') {
      await sql`insert into public.subscriptions (clinic_id, plan_id, price_id, billing_status, trial_ends_at, enforce_trial_deadline, billing_provider)
        values (${id}::uuid, ${cat!.plan_id}::uuid, ${cat!.price_id}::uuid, 'trial', now() + interval '14 days', true, 'abacatepay')`;
      const [p] = await sql`select released_at from public.trial_access_policies where clinic_id = ${id}::uuid`;
      assert.ok(p && p.released_at === null, 'trial do #53 com limites');
    } else if (state === 'paid') {
      await sql`insert into public.subscriptions (clinic_id, plan_id, price_id, billing_status, current_period_start, current_period_end)
        values (${id}::uuid, ${cat!.plan_id}::uuid, ${cat!.price_id}::uuid, 'active', now() - interval '1 day', now() + interval '30 days')`;
    } else {
      // Suspensa pelo dunning (mesmo estado da cadeia unida): past_due fora da carência, clínica só leitura.
      await sql`insert into public.subscriptions (clinic_id, plan_id, price_id, billing_status, current_period_start, current_period_end, grace_period_until)
        values (${id}::uuid, ${cat!.plan_id}::uuid, ${cat!.price_id}::uuid, 'past_due', now() - interval '40 days', now() - interval '10 days', now() - interval '3 days')`;
      await sql`update public.clinics set status = 'suspended_readonly'::clinic_status where id = ${id}::uuid`;
    }
    clinics[label] = id;
    return id;
  }
  const lanc = async (clinicId: string, name: string, valor: number, status = 'pendente') => {
    const [l] = await sql`insert into public.lancamentos (clinic_id, tipo, descricao, valor, status, created_via)
      values (${clinicId}::uuid, 'receber', ${name}, ${valor}, ${status}, 'manual') returning id`;
    return l!.id as string;
  };
  /** Runtime (como confirmPayment): RLS, lock, livro (o gatilho decide), saldo pelo livro. */
  const rtPay = (clinicId: string, lancId: string, amount: number) =>
    sql.begin(async (tx) => {
      await tx`select set_config('app.current_clinic', ${clinicId}, true)`;
      await tx`set local role authenticated`;
      await tx`select 1 from public.lancamentos where id = ${lancId}::uuid for update`;
      await tx`insert into public.payment_transactions (clinic_id, lancamento_id, kind, amount, payment_method)
        values (${clinicId}::uuid, ${lancId}::uuid, 'payment', ${amount}, 'pix')`;
    });
  const svcPay = (clinicId: string, lancId: string, amount: number) =>
    sql`insert into public.payment_transactions (clinic_id, lancamento_id, kind, amount, payment_method)
      values (${clinicId}::uuid, ${lancId}::uuid, 'payment', ${amount}, 'pix') returning id`.then((r) => r[0]!.id as string);
  const refund = (clinicId: string, lancId: string, paymentId: string, amount: number) =>
    sql`insert into public.payment_transactions (clinic_id, lancamento_id, kind, amount, payment_method, original_payment_id, reason)
      values (${clinicId}::uuid, ${lancId}::uuid, 'refund', ${amount}, 'pix', ${paymentId}::uuid, 'Estorno sintético')`;
  const lastPayment = async (lancId: string) =>
    (await sql`select id from public.payment_transactions where lancamento_id = ${lancId}::uuid and kind = 'payment' order by created_at desc limit 1`)[0]!.id as string;

  // ── Particular em clínica paga, em trial (#53) e suspensa ─────────────
  for (const [label, state] of [['paga', 'paid'], ['trial', 'trial'], ['suspensa', 'suspended']] as const) {
    const c = await clinic(label, state);
    const L1 = await lanc(c, `${label} L1 integral`, 150);
    await step(`${label} pagamento integral 150 (runtime)`, () => rtPay(c, L1, 150));
    await step(`${label} pagamento acima do saldo +1`, () => rtPay(c, L1, 1));
    const L2 = await lanc(c, `${label} L2 parcial`, 150);
    for (const [i, amount] of [50, 50, 50].entries()) {
      await step(`${label} parcial ${i + 1} de 50 (${i % 2 ? 'service' : 'runtime'})`, () => (i % 2 ? svcPay(c, L2, amount) : rtPay(c, L2, amount)));
    }
    await step(`${label} parcial 0,01 depois de quitado`, () => svcPay(c, L2, 0.01));
    const L3 = await lanc(c, `${label} L3 excesso`, 150);
    await step(`${label} pagamento único de 151`, () => rtPay(c, L3, 151));
    const L4 = await lanc(c, `${label} L4 estorno`, 150);
    await step(`${label} paga 150 para estornar`, () => svcPay(c, L4, 150));
    const p4 = await lastPayment(L4).catch(() => null);
    if (p4) {
      await step(`${label} estorno 50`, () => refund(c, L4, p4, 50));
      await step(`${label} estorno 101 (acima do disponível)`, () => refund(c, L4, p4, 101));
      await step(`${label} estorno 100 (restante)`, () => refund(c, L4, p4, 100));
      await step(`${label} repagamento 150 depois do estorno integral`, () => rtPay(c, L4, 150));
    }
    const L5 = await lanc(c, `${label} L5 cancelado`, 150, 'cancelado');
    await step(`${label} pagamento em recebível cancelado`, () => svcPay(c, L5, 10));
    const L6 = await lanc(c, `${label} L6 duplicado`, 150);
    await step(`${label} operação 1`, () => rtPay(c, L6, 150));
    await step(`${label} mesma operação repetida`, () => rtPay(c, L6, 150));
    const L7 = await lanc(c, `${label} L7 rollback`, 150);
    await step(`${label} pagamento desfeito por rollback`, () =>
      sql.begin(async (tx) => {
        await tx`insert into public.payment_transactions (clinic_id, lancamento_id, kind, amount, payment_method) values (${c}::uuid, ${L7}::uuid, 'payment', 150, 'pix')`;
        throw new Error('rollback proposital');
      }));
    await step(`${label} pagamento integral depois do rollback`, () => rtPay(c, L7, 150));
    const L9 = await lanc(c, `${label} L9 disputa`, 100);
    const race = await Promise.allSettled(Array.from({ length: 16 }, () => svcPay(c, L9, 10)));
    transcript.push(`${label} disputa 16×10 em título de 100: ${race.filter((r) => r.status === 'fulfilled').length} aceitos, ${[...new Set(race.filter((r) => r.status === 'rejected').map((r) => reason((r as PromiseRejectedResult).reason)))].join(' / ')}`);
  }
  const L8 = await lanc(clinics.paga!, 'paga L8 outra clínica', 150);
  await step('pagamento com clínica diferente da do lançamento (service)', () => svcPay(clinics.trial!, L8, 10));
  await step('pagamento com clínica diferente da do lançamento (runtime da outra clínica)', () => rtPay(clinics.trial!, L8, 10));

  // ── Coparticipação: fluxo real até o recebível de R$ 45 ───────────────
  const copay = await fx.setupClinic(`copart-${tag}`);
  clinics.copart = copay.clinicId;
  const [proc] = await sql`insert into public.procedures (clinic_id, codigo, descricao, valor_padrao, duracao_padrao_min, ativo)
    values (${copay.clinicId}::uuid, 'CONSCP', 'Consulta coparticipação', 150, 30, true) returning id`;
  await sql`insert into public.hi_procedure_contracts (clinic_id, insurer_id, guide_type, table_code, procedure_code, description, procedure_id,
      unit_value_cents, valid_from, copay_kind, copay_percentage, created_by)
    values (${copay.clinicId}::uuid, ${copay.insurerId}::uuid, 'consulta', '22', '10101039', 'Consulta em pronto socorro',
      ${proc!.id}::uuid, 15000, '2026-01-01', 'percentage', 30, ${SYS_ACTOR}::uuid)`;
  const [pat] = await sql`insert into public.patients (clinic_id, nome, cpf_encrypted, cpf_hash)
    values (${copay.clinicId}::uuid, 'Paciente coparticipação', 'ciphertext-de-teste', ${`hash-${randomUUID()}`}) returning id`;
  const [card] = await sql`insert into public.hi_memberships (clinic_id, patient_id, insurer_id, card_number_encrypted, card_number_hash, card_last4, created_by)
    values (${copay.clinicId}::uuid, ${pat!.id}::uuid, ${copay.insurerId}::uuid, 'AQAAAAAAAAAAAAAAAAAAAAAAAAAAAA==', ${randomUUID().replace(/-/g, '').padEnd(64, '0')}, '9876', ${SYS_ACTOR}::uuid) returning id`;
  const [appt] = await sql`insert into public.appointments (clinic_id, doctor_id, patient_id, procedure_id, scheduled_at, duration_min, status, valor,
      snapshot_procedure_name, snapshot_procedure_valor, snapshot_procedure_duracao_min, snapshot_doctor_nome, created_via, billing_mode)
    values (${copay.clinicId}::uuid, ${copay.doctorId}::uuid, ${pat!.id}::uuid, ${proc!.id}::uuid, '2026-11-12T12:00:00Z', 30, 'agendado', 150,
      'Consulta', 150, 30, 'Profissional sintético', 'attendant', 'convenio') returning id`;
  await withTenant(copay.clinicId, (tx) => recordAppointmentCoverage(tx, {
    clinicId: copay.clinicId, appointmentId: appt!.id as string, patientId: pat!.id as string, procedureId: proc!.id as string,
    appointmentDate: '2026-11-12', guideType: 'consulta', insurerId: copay.insurerId, planId: null,
    membershipId: card!.id as string, authorizationId: null, actor: { kind: 'user', userId: copay.doctorId },
  }), copay.doctorId);
  await sql`update public.appointments set status = 'em_atendimento' where id = ${appt!.id}::uuid`;
  await sql`insert into public.prontuarios (clinic_id, patient_id, doctor_id, appointment_id, status, signed_at, signed_by, content_encrypted)
    values (${copay.clinicId}::uuid, ${pat!.id}::uuid, ${copay.doctorId}::uuid, ${appt!.id}::uuid, 'assinado', now(), ${copay.doctorId}::uuid, 'ciphertext-sintetico')`;
  await withTenant(copay.clinicId, (tx) => applyTransition(tx, {
    clinicId: copay.clinicId, appointmentId: appt!.id as string, target: 'atendido', transitionedBy: copay.doctorId, actorType: 'user',
    clientKey: `concluir-${appt!.id}`, correlationId: null,
  }), copay.doctorId);
  for (let i = 0; i < 6; i++) await runOutboxOnce({ batchSize: 50, parallelism: 1 });
  const [cp] = await sql`select id from public.hi_copayments where appointment_id = ${appt!.id}::uuid`;
  await withTenant(copay.clinicId, (tx) => checkCopay(tx, { clinicId: copay.clinicId, copaymentId: cp!.id as string, checkedCents: 4500, actorUserId: copay.doctorId }), copay.doctorId);
  await withTenant(copay.clinicId, (tx) => confirmCopay(tx, { clinicId: copay.clinicId, copaymentId: cp!.id as string, confirmedCents: 4500, chargeableCents: 4500, actorUserId: copay.doctorId, procedureName: 'Consulta' }), copay.doctorId);
  for (let i = 0; i < 4; i++) await runOutboxOnce({ batchSize: 50, parallelism: 1 });
  const [cl] = await sql`select id, valor from public.lancamentos where appointment_id = ${appt!.id}::uuid`;
  transcript.push(`coparticipação: recebível de ${cl?.valor}`);
  if (cl) {
    await step('coparticipação paga 45 (runtime)', () => rtPay(copay.clinicId, cl.id as string, 45));
    await step('coparticipação +1 acima do confirmado', () => rtPay(copay.clinicId, cl.id as string, 1));
    const pc = await lastPayment(cl.id as string).catch(() => null);
    if (pc) await step('coparticipação estorno 45', () => refund(copay.clinicId, cl.id as string, pc, 45));
  }

  // ── Convênio pela ponte da 0153 ───────────────────────────────────────
  const conv = await fx.setupClinic(`conv-${tag}`);
  clinics.conv = conv.clinicId;
  const L1 = await fx.sentBatch(conv, 2);
  await step('convênio: pagamento exato do lote de 2 guias', () =>
    fx.asUser(conv, (tx) => acct.recordPaymentInTx(tx, { clinicId: conv.clinicId, insurerId: conv.insurerId, batchId: L1.batchId, paidOn: '2026-11-11', amountCents: 2 * VALUE, source: 'manual', idempotencyKey: `r38-${tag}-exato` })));
  const L2 = await fx.sentBatch(conv, 1);
  const g2 = L2.guides[0]!;
  await step('convênio: pagamento parcial de 100,00 na guia', () =>
    fx.asUser(conv, (tx) => acct.recordPaymentInTx(tx, { clinicId: conv.clinicId, insurerId: conv.insurerId, paidOn: '2026-11-11', amountCents: 10000, source: 'manual', idempotencyKey: `r38-${tag}-parcial`, allocations: [{ guideId: g2, batchId: L2.batchId, amountCents: 10000 }] } as Parameters<typeof acct.recordPaymentInTx>[1])));
  const glossId = await fx.asSystem(conv, (tx) => acct.recordGlossInTx(tx, { clinicId: conv.clinicId, batchId: L2.batchId, guideId: g2, code: '1705', amountCents: 5000, source: 'statement', returnId: L2.analysisReturn, idempotencyKey: `dem:${L2.analysisReturn}:${g2}:1705:5000` }));
  await step('convênio: glosa de 50,00 em análise', () => fx.asUser(conv, (tx) => acct.transitionGlossInTx(tx, { clinicId: conv.clinicId, glossId, version: 1, to: 'under_analysis' })));
  await step('convênio: glosa definitiva', () => fx.asUser(conv, (tx) => acct.transitionGlossInTx(tx, { clinicId: conv.clinicId, glossId, version: 2, to: 'definitive', reason: 'Conferido: a operadora tem razão no código' })));
  const [alloc] = await sql`select a.id from public.hi_payment_allocations a where a.clinic_id = ${conv.clinicId}::uuid and a.guide_id = ${L1.guides[0]!}::uuid`;
  await step('convênio: estorno de uma alocação', () => fx.asUser(conv, (tx) => acct.reversePaymentAllocationInTx(tx, { clinicId: conv.clinicId, allocationId: alloc!.id as string, reason: 'Alocação desfeita para conferência sintética' })));
  const [recv] = await sql`select id from public.lancamentos where clinic_id = ${conv.clinicId}::uuid and source_hi_guide_id = ${g2}::uuid`;
  await step('convênio: Caixa (runtime) tenta registrar pagamento no recebível da operadora', () => rtPay(conv.clinicId, recv!.id as string, 1));

  // ── 300 operações aleatórias (semente fixa) ───────────────────────────
  let seed = 38;
  const rnd = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const r1 = await clinic('aleatoria-1', 'paid');
  const r2 = await clinic('aleatoria-2', 'paid');
  const pool: Array<{ c: string; id: string; payments: string[] }> = [];
  // 24 títulos de 300 a 3.000: a maior parte dos pagamentos cabe e o resto bate no limite.
  for (let i = 0; i < 24; i++) {
    const c = i % 2 ? r2 : r1;
    pool.push({ c, id: await lanc(c, `aleatória L${i}`, [300, 1000, 3000][i % 3]!), payments: [] });
  }
  const amounts = [10, 25, 50, 75, 100, 150];
  for (let k = 0; k < 300; k++) {
    const target = pool[Math.floor(rnd() * pool.length)]!;
    const amount = amounts[Math.floor(rnd() * amounts.length)]!;
    const op = rnd();
    if (op < 0.6 || target.payments.length === 0) {
      const runtime = rnd() < 0.5;
      try {
        if (runtime) {
          await rtPay(target.c, target.id, amount);
          target.payments.push(await lastPayment(target.id));
        } else {
          target.payments.push(await svcPay(target.c, target.id, amount));
        }
        transcript.push(`aleatória #${k} pagamento ${amount}: ok`);
      } catch (e) {
        transcript.push(`aleatória #${k} pagamento ${amount}: ${reason(e)}`);
      }
    } else {
      const p = target.payments[Math.floor(rnd() * target.payments.length)]!;
      await step(`aleatória #${k} estorno ${amount}`, () => refund(target.c, target.id, p, amount));
    }
  }

  if (process.env.R38_TRANSCRIPT) console.log(transcript.filter((l) => !l.startsWith('aleatória')).join('\n'));
  // ── Estado normalizado ────────────────────────────────────────────────
  const label = Object.fromEntries(Object.entries(clinics).map(([k, v]) => [v, k]));
  const lancs = await sql`select clinic_id, descricao, valor::text, valor_pago::text, valor_glosado::text, status::text, created_via::text,
      payment_method, source_hi_guide_id is not null as insurer
    from public.lancamentos where clinic_id = any(${Object.values(clinics)}::uuid[])`;
  const ledger = await sql`select pt.clinic_id, l.descricao, pt.kind::text, pt.amount::text, pt.payment_method, pt.original_payment_id is not null as has_original
    from public.payment_transactions pt join public.lancamentos l on l.id = pt.lancamento_id where pt.clinic_id = any(${Object.values(clinics)}::uuid[])`;
  const diary = await sql`select clinic_id, kind, count(*)::int as n from public.hi_ledger_entries where clinic_id = any(${Object.values(clinics)}::uuid[]) group by 1, 2`;
  const norm = (rows: Record<string, unknown>[]) =>
    rows.map((r) => JSON.stringify({ ...r, clinic_id: label[r.clinic_id as string], descricao: String(r.descricao ?? '').replace(UUID, '<id>') })).sort();
  return { transcript, state: { lancamentos: norm(lancs), ledger: norm(ledger), diary: norm(diary) } };
}

try {
  await sql`GRANT SELECT ON public.clinics, public.profiles TO authenticated`;
  await fx.seedTerminology();
  // Segundo código TUSS sintético para o contrato com coparticipação (o da fixture fica sem).
  await sql`insert into public.tiss_terms (version_id, table_code, code, term, starts_on)
    select id, '22', '10101039', 'Consulta em pronto socorro', '2010-01-01' from public.tiss_terminology_versions where version = '202609'`;

  const before = await runScenario('v0');
  const [fn0] = await sql`select md5(prosrc) as h from pg_proc where proname = 'validate_payment_transaction_insert'`;
  await sql.unsafe(m0155);
  const [fn1] = await sql`select md5(prosrc) as h, prosrc from pg_proc where proname = 'validate_payment_transaction_insert'`;
  assert.notEqual(fn0!.h, fn1!.h, 'a 0155 trocou o corpo da função');
  assert.match(String(fn1!.prosrc), /WHERE clinic_id = NEW\.clinic_id\s+AND lancamento_id = NEW\.lancamento_id\s+AND kind = 'payment'/u);
  const after = await runScenario('v1');

  assert.equal(after.transcript.length, before.transcript.length);
  for (const [i, line] of before.transcript.entries()) assert.equal(after.transcript[i], line, `operação ${i} divergiu`);
  assert.deepEqual(after.state, before.state);
  const accepted = before.transcript.filter((l) => l.endsWith(': ok')).length;
  const refused = before.transcript.length - accepted;
  pass(`transcrição idêntica antes e depois da 0155: ${before.transcript.length} operações (${accepted} aceitas, ${refused} recusadas pelo mesmo motivo)`);
  pass(`estado final idêntico: ${before.state.lancamentos.length} lançamentos, ${before.state.ledger.length} movimentos no livro, diário da ponte por tipo (${before.state.diary.length} grupos)`);

  const must = (frag: string, expect: RegExp) => {
    const line = before.transcript.find((l) => l.includes(frag));
    assert.ok(line && expect.test(line), `${frag}: ${line}`);
  };
  must('paga pagamento acima do saldo +1', /payment exceeds lancamento value/u);
  must('trial parcial 0,01 depois de quitado', /payment exceeds lancamento value/u);
  must('suspensa pagamento único de 151', /payment exceeds lancamento value/u);
  must('paga estorno 101 (acima do disponível)', /refund exceeds original payment available amount/u);
  must('paga repagamento 150 depois do estorno integral', /payment exceeds lancamento value/u);
  must('paga mesma operação repetida', /payment exceeds lancamento value/u);
  must('paga pagamento integral depois do rollback', /: ok$/u);
  must('pagamento com clínica diferente da do lançamento (service)', /must reference a lancamento from the same clinic/u);
  must('paga disputa 16×10', /10 aceitos/u);
  must('coparticipação: recebível de 45.00', /45\.00/u);
  must('coparticipação +1 acima do confirmado', /payment exceeds lancamento value/u);
  must('convênio: Caixa (runtime) tenta registrar', /Pagamento de operadora é registrado na conta da guia/u);
  pass('as recusas são as esperadas: excesso, estorno acima do pago, repagamento após estorno, duplicada, clínica errada, disputa (10 de 16), coparticipação acima do confirmado, Caixa no recebível da operadora');

  // ── A única diferença possível: linha do livro com a clínica errada ───
  const preflight = async () =>
    Number((await sql`select count(*)::int as n from public.payment_transactions pt join public.lancamentos l on l.id = pt.lancamento_id where pt.clinic_id <> l.clinic_id`)[0]!.n);
  assert.equal(await preflight(), 0);
  const A = randomUUID();
  const B = randomUUID();
  for (const [id, s] of [[A, 'inv-a'], [B, 'inv-b']] as const) {
    await sql`insert into public.clinics (id, slug, nome, status) values (${id}::uuid, ${`r38-${s}`}, ${s}, 'active')`;
  }
  const [la] = await sql`insert into public.lancamentos (clinic_id, tipo, descricao, valor, status, created_via) values (${A}::uuid, 'receber', 'invariante', 100, 'pendente', 'manual') returning id`;
  await sql.begin(async (tx) => {
    await tx`set local session_replication_role = replica`;
    await tx`insert into public.payment_transactions (clinic_id, lancamento_id, kind, amount, payment_method) values (${B}::uuid, ${la!.id}::uuid, 'payment', 100, 'pix')`;
  });
  assert.equal(await preflight(), 1);
  // V1 ignora a linha de outra clínica; V0 a contaria.
  await sql`insert into public.payment_transactions (clinic_id, lancamento_id, kind, amount, payment_method) values (${A}::uuid, ${la!.id}::uuid, 'payment', 100, 'pix')`;
  pass('única diferença possível documentada: linha do livro gravada com o gatilho desligado e clínica diferente da do lançamento; o pré-voo a detecta (contagem 1 aqui; o DEV precisa dar 0 antes da aplicação)');

  console.log(`\nOK — ${passed} provas: a 0155 não muda nenhuma decisão nem estado do livro (particular, coparticipação, convênio, trial, paga, suspensa, estorno, duplicada, concorrência, rollback).`);
} finally {
  await cluster.stop();
}
