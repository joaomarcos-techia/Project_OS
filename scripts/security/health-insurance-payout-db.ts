/**
 * Repasse profissional de convênio (P10.4, D16, 0157) em Postgres DESCARTÁVEL (cadeia na
 * ordem do DEV). Nunca no DEV compartilhado; só dados sintéticos; nenhum pagamento real.
 *
 * Regras REAIS do Qoro (`professional_payout_rules`), política D16 da clínica e a conta da
 * guia (0152) como única fonte: previsto, elegível, autorizado, devido, repassado e
 * pendente, com glosa parcial/integral/contestada/definitiva, pagamento parcial e
 * posterior, estorno, ajuste, duplicidade, concorrência, regra fixa, políticas e
 * isolamento. O repasse particular (professional_payouts) não muda.
 *
 *   TISS_XMLLINT_WASM_DIR=… NODE_OPTIONS=--conditions=react-server npx tsx scripts/security/health-insurance-payout-db.ts
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { readDevOrderChain } from './dev-order-chain';
import { startScratchSchema } from './scratch-schema';

const chain = await readDevOrderChain();
const cluster = await startScratchSchema({ port: 55523, maxConnections: 12, migrations: chain });
const { sql } = cluster;
if (!/@(?:127\.0\.0\.1|localhost):55523\//u.test(cluster.url)) throw new Error('não é o cluster local');
process.env.DATABASE_URL = cluster.url;
delete process.env.DATABASE_URL_RUNTIME;
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://ci.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_ci';
process.env.OUTBOX_CRON_ALLOW_NON_VERCEL = 'true';
process.env.CRYPTO_SECRET_BACKEND = 'env';
process.env.CRYPTO_MASTER_KEY_V1 = Buffer.alloc(32, 7).toString('base64');
process.env.CRYPTO_LOOKUP_SALT = Buffer.alloc(32, 9).toString('base64');

const acct = await import('../../src/contexts/health-insurance/internal/insurance-account-service');
const pay = await import('../../src/contexts/health-insurance/internal/insurance-payout-service');
const { withTenant } = await import('../../src/lib/db/tenant');
await import('../../src/app/api/cron/outbox/handlers');
const { runOutboxOnce } = await import('../../src/lib/outbox/worker');
const { applyTransition } = await import('../../src/contexts/scheduling/internal/appointment-core');
const { recordAppointmentCoverage } = await import('../../src/contexts/health-insurance/internal/coverage-service');
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
type Clinic = Awaited<ReturnType<typeof fx.setupClinic>>;

let passed = 0;
const pass = (msg: string) => {
  passed += 1;
  console.log(`PASS: ${msg}`);
};
const key = (p: string) => `${p}-${randomUUID()}`;

async function rule(c: Clinic, kind: 'percentage' | 'fixed', value: number, procedureId: string | null = null, professionalId = c.doctorId) {
  await sql`insert into public.professional_payout_rules (clinic_id, professional_id, procedure_id, kind, percentage, fixed_amount, effective_from)
    values (${c.clinicId}::uuid, ${professionalId}::uuid, ${procedureId}::uuid, ${kind},
      ${kind === 'percentage' ? value : null}, ${kind === 'fixed' ? value : null}, '2020-01-01')`;
}
const appointmentOf = async (guideId: string) =>
  String((await sql`select appointment_id from public.hi_guide_items where guide_id = ${guideId}::uuid and live limit 1`)[0]!.appointment_id);
async function payoutFor(c: Clinic, guideId: string) {
  const appointmentId = await appointmentOf(guideId);
  const id = await fx.asSystem(c, (tx) => pay.ensureInsurancePayoutTx(tx, { clinicId: c.clinicId, appointmentId }));
  assert.ok(id, 'repasse criado');
  return id;
}
const position = async (c: Clinic, payoutId: string) =>
  (await fx.asUser(c, (tx) => pay.listInsurancePayoutPositionsTx(tx, c.clinicId, { payoutId })))[0]!;
const payGuide = (c: Clinic, batchId: string, guideId: string, cents: number) =>
  fx.asUser(c, (tx) =>
    acct.recordPaymentInTx(tx, {
      clinicId: c.clinicId, insurerId: c.insurerId, paidOn: '2026-11-11', amountCents: cents, source: 'manual',
      idempotencyKey: key('pg'), allocations: [{ guideId, batchId, amountCents: cents }],
    } as Parameters<typeof acct.recordPaymentInTx>[1]),
  );
async function gloss(c: Clinic, L: { batchId: string; analysisReturn: string }, guideId: string, cents: number, to: 'definitive' | 'contested') {
  const glossId = await fx.asSystem(c, (tx) =>
    acct.recordGlossInTx(tx, {
      clinicId: c.clinicId, batchId: L.batchId, guideId, code: '1705', amountCents: cents, source: 'statement',
      returnId: L.analysisReturn, idempotencyKey: `dem:${L.analysisReturn}:${guideId}:1705:${cents}`,
    }),
  );
  await fx.asUser(c, (tx) => acct.transitionGlossInTx(tx, { clinicId: c.clinicId, glossId, version: 1, to: 'under_analysis' }));
  await fx.asUser(c, (tx) =>
    acct.transitionGlossInTx(tx, to === 'definitive'
      ? { clinicId: c.clinicId, glossId, version: 2, to: 'definitive', reason: 'Conferido: a operadora tem razão no código' }
      : { clinicId: c.clinicId, glossId, version: 2, to: 'contested' }),
  );
  return glossId;
}
const authorize = (c: Clinic, payoutId: string, cents: number, k = key('aut')) =>
  fx.asUser(c, (tx) => pay.authorizeInsurancePayoutTx(tx, { clinicId: c.clinicId, payoutId, amountCents: cents, idempotencyKey: k, actorUserId: c.doctorId }));
const settle = (c: Clinic, payoutId: string, cents: number, k = key('rep')) =>
  fx.asUser(c, (tx) => pay.settleInsurancePayoutTx(tx, { clinicId: c.clinicId, payoutId, amountCents: cents, paidOn: '2026-11-12', reference: 'PIX sintético', idempotencyKey: k, actorUserId: c.doctorId }));
const adjust = (c: Clinic, payoutId: string, cents: number, reason: string) =>
  fx.asUser(c, (tx) => pay.adjustInsurancePayoutTx(tx, { clinicId: c.clinicId, payoutId, amountCents: cents, reason, idempotencyKey: key('aj'), actorUserId: c.doctorId }));
const rejects = (fn: () => Promise<unknown>, re: RegExp) =>
  assert.rejects(fn, (e: { message?: string; cause?: { message?: string } }) => re.test(`${e.message ?? ''} ${e.cause?.message ?? ''}`));

try {
  await sql`GRANT SELECT ON public.clinics, public.profiles TO authenticated`;
  await fx.seedTerminology();
  const [{ n: particularBefore }] = (await sql`select count(*)::int as n from public.professional_payouts`) as unknown as [{ n: number }];

  // ── 1. Regra real (40%), política padrão: previsto ≠ elegível ────────
  const A = await fx.setupClinic('Repasse A');
  await rule(A, 'percentage', 40);
  const L1 = await fx.sentBatch(A, 3);
  const [g1, g2, g3] = L1.guides as [string, string, string];
  const p1 = await payoutFor(A, g1);
  assert.equal(await payoutFor(A, g1), p1, 'idempotente');
  let s1 = await position(A, p1);
  assert.deepEqual([s1.eligibility, s1.forecastCents, s1.eligibleCents, s1.decision], ['on_receipt', 6000, 0, null]);
  pass('1. regra REAL do Qoro (40%) congelada; política padrão "no recebimento": previsto R$ 60,00, elegível R$ 0,00 antes de a operadora pagar (sem antecipação); criação idempotente');

  // ── 2. Pagamento parcial: elegível proporcional, tetos e duplicidade ──
  await payGuide(A, L1.batchId, g1, 10000);
  s1 = await position(A, p1);
  assert.deepEqual([s1.receivedCents, s1.eligibleCents], [10000, 4000]);
  await rejects(() => authorize(A, p1, 4001), /acima do elegível/u);
  await authorize(A, p1, 4000);
  await rejects(() => settle(A, p1, 4001), /acima do autorizado/u);
  const k = key('rep');
  await settle(A, p1, 4000, k);
  await rejects(() => settle(A, p1, 1, k), /já registrado|duplicate|23505/u);
  s1 = await position(A, p1);
  assert.deepEqual([s1.authorizedCents, s1.settledCents, s1.dueCents], [4000, 4000, 0]);
  pass('2. pagamento parcial (R$ 100 de R$ 150): elegível R$ 40,00 (nunca o integral); autorizar acima do elegível e repassar acima do autorizado são recusados; a mesma chave não paga duas vezes');

  // ── 3. Pagamento posterior: o elegível cresce, só a diferença fica pendente ─
  await payGuide(A, L1.batchId, g1, 5000);
  s1 = await position(A, p1);
  assert.deepEqual([s1.eligibleCents, s1.pendingAuthorizationCents], [6000, 2000]);
  await authorize(A, p1, 2000);
  s1 = await position(A, p1);
  assert.deepEqual([s1.dueCents, s1.settledCents], [2000, 4000]);
  pass('3. pagamento posterior (+R$ 50): elegível R$ 60,00, pendente de autorização só R$ 20,00; devido R$ 20,00 sobre R$ 40,00 já repassados');

  // ── 4. Glosa parcial definitiva e glosa integral ────────────────────
  const p2 = await payoutFor(A, g2);
  await gloss(A, L1, g2, 5000, 'definitive');
  await payGuide(A, L1.batchId, g2, 10000);
  const s2 = await position(A, p2);
  assert.deepEqual([s2.glossDefinitiveCents, s2.netDueCents, s2.receivedCents, s2.eligibleCents], [5000, 10000, 10000, 4000]);
  const p3 = await payoutFor(A, g3);
  await gloss(A, L1, g3, VALUE, 'definitive');
  const s3 = await position(A, p3);
  assert.deepEqual([s3.forecastCents, s3.netDueCents, s3.eligibleCents], [6000, 0, 0]);
  pass('4. glosa definitiva parcial (R$ 50): devido R$ 100, recebido R$ 100, elegível R$ 40,00; glosa integral: elegível R$ 0,00 com previsto de R$ 60,00 visível');

  // ── 5. Glosa contestada (recurso) não reduz; recurso aceito + pagamento aumenta ─
  const L2 = await fx.sentBatch(A, 1);
  const g4 = L2.guides[0]!;
  const p4 = await payoutFor(A, g4);
  const gl4 = await gloss(A, L2, g4, 5000, 'contested');
  await payGuide(A, L2.batchId, g4, 10000);
  let s4 = await position(A, p4);
  assert.deepEqual([s4.glossOpenCents, s4.netDueCents, s4.eligibleCents], [5000, 15000, 4000]);
  // recurso aceito pela operadora: a glosa é revertida e o valor chega depois
  await fx.asUser(A, (tx) => acct.transitionGlossInTx(tx, { clinicId: A.clinicId, glossId: gl4, version: 3, to: 'reversed', reason: 'Recurso aceito pela operadora (sintético)' }));
  await payGuide(A, L2.batchId, g4, 5000);
  s4 = await position(A, p4);
  assert.equal(s4.eligibleCents, 6000);
  pass('5. glosa contestada/em recurso não reduz o devido (fica "em aberto"); com o recurso aceito e o pagamento posterior, o elegível sobe para R$ 60,00');

  // ── 6. Estorno depois do repasse: aparece "a compensar"; ajuste humano ─
  const [alloc] = await sql`select id from public.hi_payment_allocations where guide_id = ${g1}::uuid and kind = 'allocation' order by created_at limit 1`;
  await settle(A, p1, 2000);
  await fx.asUser(A, (tx) => acct.reversePaymentAllocationInTx(tx, { clinicId: A.clinicId, allocationId: alloc!.id as string, reason: 'Estorno sintético da operadora para teste' }));
  s1 = await position(A, p1);
  assert.deepEqual([s1.eligibleCents, s1.settledCents, s1.pendingAuthorizationCents], [2000, 6000, -4000]);
  await adjust(A, p1, -4000, 'Estorno da operadora: compensar no próximo repasse');
  s1 = await position(A, p1);
  assert.deepEqual([s1.authorizedCents + s1.adjustmentsCents, s1.dueCents], [2000, -4000]);
  await rejects(() => sql`update public.hi_payout_movements set amount_cents = 1 where payout_id = ${p1}::uuid`, /só de inclusão/u);
  pass('6. estorno de R$ 100 depois de R$ 60 repassados: elegível cai para R$ 20,00 e o excesso fica visível (−R$ 40); o ajuste é humano, com motivo, e deixa o devido em −R$ 40,00 (a compensar); movimentos não mudam');

  // ── 7. Regra fixa: integral paga; glosa parcial vira decisão humana ──
  const B = await fx.setupClinic('Repasse B');
  await rule(B, 'fixed', 50);
  const LB = await fx.sentBatch(B, 2);
  const [b1, b2] = LB.guides as [string, string];
  const pb1 = await payoutFor(B, b1);
  await payGuide(B, LB.batchId, b1, VALUE);
  assert.equal((await position(B, pb1)).eligibleCents, 5000);
  const pb2 = await payoutFor(B, b2);
  await gloss(B, LB, b2, 3000, 'definitive');
  await payGuide(B, LB.batchId, b2, VALUE - 3000);
  const sb2 = await position(B, pb2);
  assert.deepEqual([sb2.eligibleCents, sb2.decision], [null, 'FIXED_RULE_PARTIAL_GLOSS']);
  await rejects(() => authorize(B, pb2, 5000), /decisão pendente/u);
  await adjust(B, pb2, 3000, 'Decisão da gestão: proporcional ao valor pago');
  await rejects(() => adjust(B, pb2, 3000, 'Tentativa acima do previsto da sessão'), /previsto da sessão/u);
  await settle(B, pb2, 3000);
  pass('7. regra fixa (R$ 50): paga integral → elegível R$ 50,00; com glosa parcial → pendência de decisão (sem estimativa); a gestão decide por ajuste com motivo (R$ 30), nunca acima do previsto, e repassa');

  // ── 8. Políticas D16: na aprovação e na conclusão ───────────────────
  const C = await fx.setupClinic('Repasse C');
  await rule(C, 'percentage', 40);
  await sql`update public.hi_clinic_settings set payout_eligibility = 'on_approval' where clinic_id = ${C.clinicId}::uuid`;
  const gC = await C.approvedGuide();
  const pc = await payoutFor(C, gC);
  assert.deepEqual([(await position(C, pc)).eligibility, (await position(C, pc)).eligibleCents], ['on_approval', 6000]);
  await sql`update public.hi_clinic_settings set payout_eligibility = 'on_completion' where clinic_id = ${C.clinicId}::uuid`;
  const gC2 = await C.approvedGuide();
  const pc2 = await payoutFor(C, gC2);
  const sc2 = await position(C, pc2);
  assert.deepEqual([sc2.eligibility, sc2.eligibleCents, sc2.forecastCents], ['on_completion', 6000, 6000]);
  assert.equal((await position(C, pc)).eligibility, 'on_approval', 'a política fica congelada no repasse');
  pass('8. política D16 configurável: "na aprovação" (guia aprovada, sem pagamento) elegível R$ 60,00; "na conclusão" antecipa sobre o contratado; a política de cada repasse fica congelada');

  // ── 9. Regra por procedimento vence a geral; profissionais com regras diferentes ─
  const D = await fx.setupClinic('Repasse D');
  const [proc] = await sql`select id from public.procedures where clinic_id = ${D.clinicId}::uuid limit 1`;
  await rule(D, 'percentage', 30);
  await rule(D, 'percentage', 55, proc!.id as string);
  const gD = await D.approvedGuide();
  const pd = await payoutFor(D, gD);
  assert.equal((await position(D, pd)).forecastCents, Math.round(VALUE * 0.55));
  pass('9. a regra do procedimento (55%) vence a geral (30%) do mesmo profissional; cada profissional usa a SUA regra (A 40%, B fixo R$ 50)');

  // ── 10. Concorrência: dois repasses disputando o devido ─────────────
  const pc3 = pc2;
  await authorize(C, pc3, 6000);
  const race = await Promise.allSettled([settle(C, pc3, 4000), settle(C, pc3, 4000)]);
  assert.equal(race.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal((await position(C, pc3)).settledCents, 4000);
  pass('10. concorrência: dois repasses de R$ 40 sobre R$ 60 autorizados ao mesmo tempo → um passa, o outro é recusado (linha travada); nunca paga em dobro');

  // ── 11. Sem direito, sem regra, dono e cancelamento ─────────────────
  const E = await fx.setupClinic('Repasse E (consultório)');
  await sql`update public.subscriptions set plan_id = (select id from public.plans where code = 'consultorio_2026') where clinic_id = ${E.clinicId}::uuid`;
  await rule(E, 'percentage', 40);
  const gE = await E.approvedGuide();
  const apE = await appointmentOf(gE);
  assert.equal(await fx.asSystem(E, (tx) => pay.ensureInsurancePayoutTx(tx, { clinicId: E.clinicId, appointmentId: apE })), null);
  const F = await fx.setupClinic('Repasse F (sem regra)');
  const gF = await F.approvedGuide();
  const apF = await appointmentOf(gF);
  assert.equal(await fx.asSystem(F, (tx) => pay.ensureInsurancePayoutTx(tx, { clinicId: F.clinicId, appointmentId: apF })), null);
  await rejects(() => fx.asUser(A, (tx) => pay.cancelInsurancePayoutTx(tx, { clinicId: A.clinicId, payoutId: p1, reason: 'Atendimento cancelado depois' , actorUserId: A.doctorId })), /ajuste em vez de cancelar/u);
  await fx.asUser(A, (tx) => pay.cancelInsurancePayoutTx(tx, { clinicId: A.clinicId, payoutId: p3, reason: 'Guia integralmente glosada, sem repasse', actorUserId: A.doctorId }));
  assert.equal((await position(A, p3)).decision, 'CANCELLED');
  pass('11. plano sem políticas avançadas (consultório) e profissional sem regra: nenhum repasse; cancelar com repasse realizado é recusado (ajuste), sem repasse cancela e o histórico fica');

  // ── 12. Isolamento, processo automático e particular inalterado ─────
  const leak = (await fx.asUser(B, (tx) => tx.execute(fx.sqlTag`select count(*)::int as n from public.hi_payout_positions where clinic_id = ${A.clinicId}::uuid`))) as unknown as Array<{ n: number }>;
  assert.equal(leak[0]!.n, 0);
  await rejects(() => fx.asUser(B, (tx) => pay.authorizeInsurancePayoutTx(tx, { clinicId: B.clinicId, payoutId: p2, amountCents: 1, idempotencyKey: key('x'), actorUserId: B.doctorId })), /inexistente|23503|violates/u);
  // Caminho real: atendimento de convênio → cobertura → conclusão pelo Scheduling → outbox → guia → repasse.
  const G = await fx.setupClinic('Repasse G (automático)');
  await rule(G, 'percentage', 40);
  const [procG] = await sql`select id from public.procedures where clinic_id = ${G.clinicId}::uuid limit 1`;
  const [ptG] = await sql`insert into public.patients (clinic_id, nome, cpf_encrypted, cpf_hash)
    values (${G.clinicId}::uuid, 'Paciente repasse automático', 'ciphertext-de-teste', ${`hash-${randomUUID()}`}) returning id`;
  const [cardG] = await sql`insert into public.hi_memberships (clinic_id, patient_id, insurer_id, card_number_encrypted, card_number_hash, card_last4, created_by)
    values (${G.clinicId}::uuid, ${ptG!.id}::uuid, ${G.insurerId}::uuid, 'AQAAAAAAAAAAAAAAAAAAAAAAAAAAAA==', ${randomUUID().replace(/-/g, '').padEnd(64, '0')}, '2345', ${SYS_ACTOR}::uuid) returning id`;
  const [apRow] = await sql`insert into public.appointments (clinic_id, doctor_id, patient_id, procedure_id, scheduled_at, duration_min, status, valor,
      snapshot_procedure_name, snapshot_procedure_valor, snapshot_procedure_duracao_min, snapshot_doctor_nome, created_via, billing_mode)
    values (${G.clinicId}::uuid, ${G.doctorId}::uuid, ${ptG!.id}::uuid, ${procG!.id}::uuid, '2026-11-11T13:00:00Z', 30, 'agendado', 150,
      'Consulta', 150, 30, 'Dra. Sintética', 'attendant', 'convenio') returning id`;
  const apG = apRow!.id as string;
  await withTenant(G.clinicId, (tx) => recordAppointmentCoverage(tx, {
    clinicId: G.clinicId, appointmentId: apG, patientId: ptG!.id as string, procedureId: procG!.id as string, appointmentDate: '2026-11-11',
    guideType: 'consulta', insurerId: G.insurerId, planId: null, membershipId: cardG!.id as string, authorizationId: null,
    actor: { kind: 'user', userId: G.doctorId },
  }), G.doctorId);
  await sql`update public.appointments set status = 'em_atendimento' where id = ${apG}::uuid`;
  await sql`insert into public.prontuarios (clinic_id, patient_id, doctor_id, appointment_id, status, signed_at, signed_by, content_encrypted)
    values (${G.clinicId}::uuid, ${ptG!.id}::uuid, ${G.doctorId}::uuid, ${apG}::uuid, 'assinado', now(), ${G.doctorId}::uuid, 'ciphertext-sintetico')`;
  await withTenant(G.clinicId, (tx) => applyTransition(tx, {
    clinicId: G.clinicId, appointmentId: apG, target: 'atendido', transitionedBy: G.doctorId, actorType: 'user', clientKey: `concluir-${apG}`, correlationId: null,
  }), G.doctorId);
  for (let i = 0; i < 4; i++) await runOutboxOnce({ batchSize: 50, parallelism: 1 });
  const [{ n: auto }] = (await sql`select count(*)::int as n from public.hi_payouts where clinic_id = ${G.clinicId}::uuid`) as unknown as [{ n: number }];
  const [{ n: particularAfter }] = (await sql`select count(*)::int as n from public.professional_payouts`) as unknown as [{ n: number }];
  assert.equal(particularAfter, particularBefore);
  assert.equal(auto, 1, 'o repasse nasce no caminho automático do faturamento');
  const [autoPos] = await sql`select forecast_cents, eligible_cents from public.hi_payout_positions where clinic_id = ${G.clinicId}::uuid`;
  assert.deepEqual([Number(autoPos!.forecast_cents), Number(autoPos!.eligible_cents)], [6000, 0]);
  pass(`12. outra clínica não lê nem movimenta o repasse; atendimento de convênio concluído pelo Scheduling → outbox → guia pronta → repasse criado sozinho (previsto R$ 60,00, elegível R$ 0,00); nenhum repasse particular criado ou alterado`);

  console.log(`\nOK — ${passed} provas do repasse profissional de convênio (P10.4).`);
} finally {
  await cluster.stop();
}
