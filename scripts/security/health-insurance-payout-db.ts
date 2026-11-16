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
 * Seção 15 (0163, contrato aprovado em 16/11): revisão humana quando a guia sai do atendimento —
 * bloqueio de pagamento e autorização, decisões manter/reduzir/ciência, segregação, concorrência,
 * idempotência, classe C (módulo desligado) e isolamento.
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
const review = await import('../../src/contexts/health-insurance/internal/payout-review-service');
const { issueConsultaGuide } = await import('../../src/contexts/health-insurance/internal/guide-issuance');
const { withTenant } = await import('../../src/lib/db/tenant');
await import('../../src/app/api/cron/outbox/handlers');
const { runOutboxOnce } = await import('../../src/lib/outbox/worker');
const { applyTransition } = await import('../../src/contexts/scheduling/internal/appointment-core');
const { recordAppointmentCoverage } = await import('../../src/contexts/health-insurance/internal/coverage-service');
const { loadXmllintValidator } = await import('../../src/contexts/health-insurance/tiss/xml/xsd-validator');
const { loadHiFixtures, GUIDE_VALUE_CENTS: VALUE, SYS_ACTOR, SYNTHETIC_CARD } = await import('./hi-fixtures');

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

  // ── 13. Cancelar a guia com repasse (15/11 noite; decisão do fundador: (a) compensação negativa
  //        NÃO é automática; (b) repasse autorizado ou pago é obrigação preservada) ─────────────
  // Mede o comportamento ATUAL, sem mudar contrato: o cancelamento é o mesmo UPDATE da action
  // (`cancelGuideAction`), na guia aprovada (antes do envio), com a política "na aprovação".
  await sql`update public.hi_clinic_settings set payout_eligibility = 'on_approval' where clinic_id = ${C.clinicId}::uuid`;
  const cancelGuide = async (guideId: string) => {
    const [g] = await sql`select version from public.hi_guides where id = ${guideId}::uuid`;
    await fx.asUser(C, (tx) =>
      tx.execute(fx.sqlTag`update public.hi_guides set status = 'cancelled', cancel_reason = 'Guia emitida para o convênio errado',
        cancelled_by = ${C.doctorId}::uuid where clinic_id = ${C.clinicId}::uuid and id = ${guideId}::uuid and version = ${Number(g!.version)}`),
    );
  };
  const money = async (guideId: string) => {
    const [r] = await sql`select
        (select count(*)::int from public.lancamentos where source_hi_guide_id = ${guideId}::uuid) as receivables,
        (select count(*)::int from public.hi_ledger_entries where guide_id = ${guideId}::uuid) as ledger,
        (select count(*)::int from public.payment_transactions t join public.lancamentos l on l.id = t.lancamento_id
          where l.source_hi_guide_id = ${guideId}::uuid) as cash`;
    return [Number(r!.receivables), Number(r!.ledger), Number(r!.cash)];
  };
  const movements = async (payoutId: string) =>
    (await sql`select kind, amount_cents from public.hi_payout_movements where payout_id = ${payoutId}::uuid order by created_at`).map(
      (m) => `${String(m.kind)}:${Number(m.amount_cents)}`,
    );
  const cancelledEvent = async (guideId: string) =>
    (await sql`select actor_id from public.hi_guide_events where guide_id = ${guideId}::uuid and to_status = 'cancelled'`).map((e) => String(e.actor_id));
  // A — sem repasse autorizado nem pago.
  const gA = await C.approvedGuide();
  const pA = await payoutFor(C, gA);
  await cancelGuide(gA);
  const sA = await position(C, pA);
  assert.deepEqual([sA.decision, sA.eligibleCents, sA.authorizedCents, sA.settledCents, sA.dueCents, sA.pendingAuthorizationCents],
    ['NO_LIVE_GUIDE', 0, 0, 0, 0, 0]);
  assert.deepEqual(await movements(pA), []);
  // B — repasse AUTORIZADO (R$ 60), ainda não pago.
  const gB = await C.approvedGuide();
  const pB = await payoutFor(C, gB);
  await authorize(C, pB, 6000);
  await cancelGuide(gB);
  const sB = await position(C, pB);
  assert.deepEqual([sB.decision, sB.eligibleCents, sB.authorizedCents, sB.settledCents], ['NO_LIVE_GUIDE', 0, 6000, 0]);
  // A obrigação autorizada continua devida (b); o excesso sobre o novo elegível fica VISÍVEL
  // (pendente de autorização negativo) para a revisão humana (a). Nada é compensado sozinho.
  assert.deepEqual([sB.dueCents, sB.pendingAuthorizationCents], [6000, -6000]);
  assert.deepEqual(await movements(pB), ['authorization:6000']);
  // 0163 (decisão de 16/11): com a revisão aberta, a recusa vem da revisão, antes do teto do elegível.
  await rejects(() => authorize(C, pB, 1), /em revisão/u);
  // C — repasse AUTORIZADO e PAGO (R$ 60).
  const gCx = await C.approvedGuide();
  const pCx = await payoutFor(C, gCx);
  await authorize(C, pCx, 6000);
  await settle(C, pCx, 6000);
  await cancelGuide(gCx);
  const sCx = await position(C, pCx);
  assert.deepEqual([sCx.decision, sCx.eligibleCents, sCx.authorizedCents, sCx.settledCents, sCx.dueCents, sCx.pendingAuthorizationCents],
    ['NO_LIVE_GUIDE', 0, 6000, 6000, 0, -6000]);
  assert.deepEqual(await movements(pCx), ['authorization:6000', 'settlement:6000'], 'o pagamento registrado fica; nada é estornado');
  // Nenhum dos três cancelamentos mexe no livro financeiro (a guia não foi enviada: não há recebível).
  for (const g of [gA, gB, gCx]) {
    assert.deepEqual(await money(g), [0, 0, 0]);
    assert.deepEqual(await cancelledEvent(g), [C.doctorId], 'histórico com o autor');
  }
  pass('13. cancelar guia aprovada (política "na aprovação"): sem repasse → elegível R$ 0,00 e nada a revisar; repasse autorizado → a obrigação de R$ 60,00 continua devida e o excesso (−R$ 60,00) fica visível, sem compensação automática e sem nova autorização; repasse pago → o pagamento fica registrado (nada estornado) e o excesso (−R$ 60,00) visível; nenhum recebível, livro ou caixa tocado; histórico com o autor');

  // ── 14. Não regressão do contrato do cancelamento (16/11). Base da correção proposta em
  //        docs/convenios/cancelamento-repasse-contrato.md: os invariantes (i)–(iv) precisam
  //        continuar valendo depois dela; (v) é a LACUNA medida que ela fecha, e só muda por
  //        decisão, junto com a correção aprovada. ─────────────────────────────────────────
  const gN = await C.approvedGuide();
  const pN = await payoutFor(C, gN);
  await authorize(C, pN, 6000);
  const kOld = key('rep');
  await settle(C, pN, 2000, kOld); // pagamento parcial ANTES do cancelamento
  await cancelGuide(gN);
  // (i) reaproveitar a ação antiga (mesma chave) não duplica o pagamento
  await rejects(() => settle(C, pN, 2000, kOld), /mesma chave/u);
  assert.deepEqual(await movements(pN), ['authorization:6000', 'settlement:2000']);
  // (ii) pagamento acima do autorizado continua recusado. Com a 0163, a revisão aberta recusa ANTES do
  //      teto (por decisão); o teto do autorizado volta a ser provado depois de "manter" (seção 15.3).
  await rejects(() => settle(C, pN, 4001), /em revisão/u);
  // (iii) repasse com pagamento não se cancela: o histórico fica e a correção é por ajuste
  await assert.rejects(
    () => fx.asUser(C, (tx) => pay.cancelInsurancePayoutTx(tx, { clinicId: C.clinicId, payoutId: pN, reason: 'Guia cancelada antes do envio', actorUserId: C.doctorId })),
    (e: { code?: string }) => e.code === 'has_settlement',
  );
  // (iv) ajuste é humano, com motivo, e não deixa o autorizado negativo
  await rejects(() => adjust(C, pN, -6001, 'Revisão humana depois do cancelamento da guia'), /negativo/u);
  assert.deepEqual(await movements(pN), ['authorization:6000', 'settlement:2000'], 'as recusas não gravaram movimento');
  // (v) A LACUNA medida em 16/11 (chave NOVA pagava o saldo de guia cancelada) está FECHADA pela 0163,
  //     por decisão do fundador: com a revisão aberta, o pagamento é recusado e nada é gravado.
  const sBefore = await position(C, pN);
  assert.deepEqual([sBefore.decision, sBefore.authorizedCents, sBefore.settledCents, sBefore.dueCents], ['NO_LIVE_GUIDE', 6000, 2000, 4000]);
  assert.ok(sBefore.openReviewId, 'revisão aberta');
  await rejects(() => settle(C, pN, 1000), /em revisão/u);
  const sN = await position(C, pN);
  assert.deepEqual([sN.decision, sN.authorizedCents, sN.settledCents, sN.dueCents], ['NO_LIVE_GUIDE', 6000, 2000, 4000]);
  assert.deepEqual(await money(gN), [0, 0, 0]);
  pass('14. não regressão do cancelamento (guia cancelada com repasse autorizado e pago em parte): a mesma chave não duplica o pagamento; pagamento acima do autorizado, cancelamento do repasse com pagamento e ajuste que deixaria o autorizado negativo continuam recusados, sem gravar movimento; a LACUNA de 16/11 está fechada pela 0163: com chave nova, o pagamento do saldo de R$ 40,00 é recusado (revisão aberta) e nada é gravado; nenhum recebível, livro ou caixa tocado');

  // ── 15. Revisão humana do repasse (0163; contrato aprovado pelo fundador em 16/11) ─────────────
  //   Abre no COMMIT da transação que tira a guia do atendimento; bloqueia pagamento e autorização;
  //   manter/reduzir/ciência; segregação; concorrência; idempotência; classe C; isolamento.
  const outra = randomUUID(); // outra pessoa da clínica (o banco só usa a pessoa da sessão)
  type Decision = 'maintain' | 'reduce' | 'acknowledge';
  const decideAs = (actor: string, reviewId: string, decision: Decision, reason: string, reduceCents: number | null = null, c: Clinic = C) =>
    withTenant(c.clinicId, (tx) => review.decidePayoutReviewTx(tx, { clinicId: c.clinicId, reviewId, decision, reason, reduceCents }), actor);
  const reviewsOf = async (payoutId: string) =>
    (await sql`select id::text, kind, status, guide_status, opened_by::text, decided_by::text, decision,
                      open_authorized_cents::int a, open_adjustments_cents::int j, open_settled_cents::int s, reduce_cents::int r
                 from public.hi_payout_reviews where payout_id = ${payoutId}::uuid order by opened_at`) as unknown as Array<{
      id: string; kind: string; status: string; guide_status: string; opened_by: string | null; decided_by: string | null;
      decision: string | null; a: number; j: number; s: number; r: number | null;
    }>;
  const REASON = 'Atendimento realizado; obrigação conferida pela gestão';

  // 15.1 Abertura: autorizado e não pago → bloqueante; pago → ciência; pago em parte → bloqueante; sem saldo → nada.
  const [rB] = await reviewsOf(pB);
  assert.deepEqual([rB!.kind, rB!.status, rB!.guide_status, rB!.opened_by, rB!.a, rB!.j, rB!.s], ['blocking', 'open', 'cancelled', C.doctorId, 6000, 0, 0]);
  assert.equal((await position(C, pB)).openReviewId, rB!.id);
  await rejects(() => settle(C, pB, 100), /em revisão/u); // chave NOVA
  await rejects(() => authorize(C, pB, 1), /em revisão/u);
  assert.deepEqual(await movements(pB), ['authorization:6000'], 'as recusas não gravaram movimento');
  assert.deepEqual(await reviewsOf(pA), [], 'sem saldo autorizado nem pago: nada a revisar');
  const [rCx] = await reviewsOf(pCx);
  assert.deepEqual([rCx!.kind, rCx!.status, rCx!.a, rCx!.s], ['acknowledgement', 'open', 6000, 6000]);
  const [rN] = await reviewsOf(pN);
  assert.deepEqual([rN!.kind, rN!.a, rN!.s], ['blocking', 6000, 2000]);
  pass('15.1 abertura no commit da transação da guia: autorizado e não pago → revisão bloqueante (pagamento com chave nova e autorização recusados, nada gravado); pago → revisão de ciência; pago em parte → bloqueante com o saldo de R$ 40,00; sem saldo → nenhuma revisão; quem abriu = a pessoa da sessão');

  // 15.2 Idempotência: reabrir (backfill ou gatilho de novo) não duplica a revisão aberta.
  const [{ n: again }] = (await sql`select public.hi_payout_reviews_open_for_guide(${C.clinicId}::uuid, ${gB}::uuid, 'cancelled', 'backfill') as n`) as unknown as [{ n: number }];
  assert.equal(Number(again), 0);
  assert.equal((await reviewsOf(pB)).length, 1);
  pass('15.2 idempotência: a abertura de novo para a mesma guia (backfill ou gatilho repetido) não cria uma segunda revisão aberta');

  // 15.3 Decisões.
  await rejects(() => decideAs(outra, rB!.id, 'acknowledge', REASON), /manter ou reduzir/u);
  await rejects(() => decideAs(outra, rB!.id, 'maintain', 'curto'), /motivo/u);
  const kept = await decideAs(outra, rB!.id, 'maintain', REASON);
  assert.deepEqual([kept.decision, kept.dueCents], ['maintain', 6000]);
  assert.equal((await position(C, pB)).openReviewId, null);
  await settle(C, pB, 6000);
  await rejects(() => settle(C, pB, 1), /acima do autorizado/u);
  const [rB2] = await reviewsOf(pB);
  assert.deepEqual([rB2!.status, rB2!.decision, rB2!.decided_by], ['decided', 'maintain', outra]);
  await rejects(() => decideAs(outra, rB!.id, 'reduce', REASON, 100), /já foi decidida/u);
  await rejects(() => sql`update public.hi_payout_reviews set decision_reason = ${'Tentativa de reescrever a decisão'} where id = ${rB!.id}::uuid`, /já decidida/u);
  // reduzir: grava o ajuste no mesmo ato e limita o pagamento ao novo autorizado
  await rejects(() => decideAs(outra, rN!.id, 'reduce', REASON, 4001), /Redução/u);
  const cut = await decideAs(outra, rN!.id, 'reduce', 'Sessão parcialmente refeita; reduzir R$ 15,00', 1500);
  assert.deepEqual([cut.decision, cut.reduceCents, cut.dueCents], ['reduce', 1500, 2500]);
  assert.deepEqual(await movements(pN), ['authorization:6000', 'settlement:2000', 'adjustment:-1500']);
  const [{ k: cutKey }] = (await sql`select idempotency_key k from public.hi_payout_movements where payout_id = ${pN}::uuid and kind = 'adjustment'`) as unknown as [{ k: string }];
  assert.equal(cutKey, `payout-review:${rN!.id}`);
  await settle(C, pN, 2500);
  await rejects(() => settle(C, pN, 1), /acima do autorizado/u);
  // ciência: só sem saldo; nada é compensado nem estornado
  await rejects(() => decideAs(outra, rCx!.id, 'maintain', REASON), /Não há saldo/u);
  await decideAs(outra, rCx!.id, 'acknowledge', 'Repasse já pago antes do cancelamento; ciência');
  assert.deepEqual(await movements(pCx), ['authorization:6000', 'settlement:6000'], 'ciência não compensa nem estorna');
  pass('15.3 decisões: ciência recusada com saldo não pago e motivo curto recusado; manter libera o pagamento até o autorizado (R$ 60,00) e não além; reduzir (acima do saldo recusado) grava o ajuste de −R$ 15,00 no mesmo ato, com chave da revisão, e limita o pagamento a R$ 25,00; ciência do repasse pago não compensa nem estorna; revisão decidida é imutável (nova decisão e UPDATE direto recusados)');

  // 15.4 Segregação: política da clínica e limite de risco.
  const cancelledWithAuth = async (cents: number) => {
    const g = await C.approvedGuide();
    const p = await payoutFor(C, g);
    await authorize(C, p, cents);
    await cancelGuide(g);
    const [r] = await reviewsOf(p);
    return { g, p, r: r! };
  };
  await sql`update public.hi_clinic_settings set payout_review_segregation = true where clinic_id = ${C.clinicId}::uuid`;
  const S1 = await cancelledWithAuth(6000);
  await rejects(() => decideAs(C.doctorId, S1.r.id, 'maintain', REASON), /exige outra pessoa/u);
  await decideAs(outra, S1.r.id, 'maintain', REASON);
  await sql`update public.hi_clinic_settings set payout_review_segregation = false, payout_review_independent_above_cents = 5000 where clinic_id = ${C.clinicId}::uuid`;
  const S2 = await cancelledWithAuth(6000);
  await rejects(() => decideAs(C.doctorId, S2.r.id, 'maintain', REASON), /exige outra pessoa/u);
  await rejects(() => decideAs(C.doctorId, S2.r.id, 'reduce', REASON, 1000), /exige outra pessoa/u);
  await decideAs(outra, S2.r.id, 'reduce', REASON, 1000);
  const S3 = await cancelledWithAuth(3000);
  await decideAs(C.doctorId, S3.r.id, 'maintain', REASON); // abaixo do limite, sem segregação: a mesma pessoa decide
  await sql`update public.hi_clinic_settings set payout_review_independent_above_cents = null where clinic_id = ${C.clinicId}::uuid`;
  pass('15.4 segregação: com a política da clínica ligada, quem cancelou a guia não decide (outra pessoa sim); com o limite de R$ 50,00, saldo de R$ 60,00 exige outra pessoa para manter ou reduzir; abaixo do limite e sem a política, a mesma pessoa decide (quatro olhos não é padrão)');

  // 15.5 Concorrência.
  // (a) o pagamento confirma DURANTE a transação que cancela: a revisão nasce com ele nos valores.
  const gR = await C.approvedGuide();
  const pR = await payoutFor(C, gR);
  await authorize(C, pR, 6000);
  const [{ v: vR }] = (await sql`select version v from public.hi_guides where id = ${gR}::uuid`) as unknown as [{ v: number }];
  let updated!: () => void;
  let release!: () => void;
  const updatedP = new Promise<void>((r) => (updated = r));
  const gate = new Promise<void>((r) => (release = r));
  const t1 = sql.begin(async (t) => {
    await t`select set_config('app.current_clinic', ${C.clinicId}, true), set_config('app.current_user', ${C.doctorId}, true)`;
    await t`update public.hi_guides set status = 'cancelled', cancel_reason = 'Guia emitida para o convênio errado',
             cancelled_by = ${C.doctorId}::uuid where id = ${gR}::uuid and version = ${Number(vR)}`;
    updated();
    await gate;
  });
  await updatedP;
  await settle(C, pR, 1000);
  release();
  await t1;
  const [rR] = await reviewsOf(pR);
  assert.deepEqual([rR!.kind, rR!.a, rR!.s], ['blocking', 6000, 1000]);
  await rejects(() => settle(C, pR, 1000), /em revisão/u);
  // (b) duas decisões ao mesmo tempo: a segunda espera a trava e lê "já decidida".
  let decided1!: () => void;
  let release2!: () => void;
  const decided1P = new Promise<void>((r) => (decided1 = r));
  const gate2 = new Promise<void>((r) => (release2 = r));
  const d1 = sql.begin(async (t) => {
    await t`select set_config('app.current_clinic', ${C.clinicId}, true), set_config('app.current_user', ${outra}, true)`;
    await t`select * from public.hi_payout_review_decide(${C.clinicId}::uuid, ${rR!.id}::uuid, 'maintain', ${REASON}, null)`;
    decided1();
    await gate2;
  });
  await decided1P;
  // O erro é capturado já (a segunda decisão só falha depois do commit da primeira).
  const d2 = decideAs(C.doctorId, rR!.id, 'reduce', REASON, 100).then(() => null, (e: unknown) => e as { message?: string });
  await new Promise((r) => setTimeout(r, 400));
  release2();
  await d1;
  const e2 = await d2;
  assert.ok(e2 && /já foi decidida/u.test(e2.message ?? ''), `segunda decisão: ${e2?.message}`);
  assert.deepEqual(await movements(pR), ['authorization:6000', 'settlement:1000'], 'a decisão perdedora não gravou ajuste');
  pass('15.5 concorrência: pagamento que confirma durante a transação do cancelamento entra nos valores da revisão (R$ 10,00 pago, R$ 50,00 bloqueado) e o seguinte é recusado; duas decisões ao mesmo tempo → uma vence, a outra lê "já decidida" sem gravar ajuste');

  // 15.6 Substituição APROVADA (guia em análise na operadora): a substituta vira viva no mesmo ato em
  //      que a original vira "substituída"; a checagem no commit vê o estado final e não abre revisão.
  const LW = await fx.sentBatch(C, 1);
  const gW = LW.guides[0]!;
  const pW = await payoutFor(C, gW);
  await authorize(C, pW, 6000);
  const subId = await fx.asUser(C, async (tx) => {
    const [n] = (await tx.execute(fx.sqlTag`select public.hi_next_counter(${C.clinicId}::uuid, 'guide', '') as v`)) as unknown as Array<{ v: string }>;
    const [s] = (await tx.execute(fx.sqlTag`insert into public.hi_guides
        (clinic_id, guide_type, number, insurer_id, plan_id, patient_id, membership_id, authorization_id,
         executant_professional_id, replaces_guide_id, idempotency_key, created_via, created_by)
      select clinic_id, guide_type, ${String(n!.v)}, insurer_id, plan_id, patient_id, membership_id, authorization_id,
             executant_professional_id, id, ${`substituta:${gW}`}, 'user', ${C.doctorId}::uuid
        from public.hi_guides where id = ${gW}::uuid
      returning id`)) as unknown as Array<{ id: string }>;
    await tx.execute(fx.sqlTag`insert into public.hi_guide_items
        (clinic_id, guide_id, sequence, appointment_id, contract_line_id, authorization_item_id, executed_on,
         table_code, procedure_code, description, quantity, factor_hundredths, unit_value_cents, total_value_cents)
      select clinic_id, ${s!.id}::uuid, sequence, appointment_id, contract_line_id, authorization_item_id, executed_on,
             table_code, procedure_code, description, quantity, factor_hundredths, unit_value_cents, total_value_cents
        from public.hi_guide_items where guide_id = ${gW}::uuid`);
    return String(s!.id);
  });
  assert.deepEqual(await reviewsOf(pW), [], 'substituta em rascunho: nada muda');
  const [orig] = (await sql`select total_value_cents::int t, membership_id::text m from public.hi_guides where id = ${gW}::uuid`) as unknown as Array<{ t: number; m: string }>;
  await fx.asUser(C, (tx) => tx.execute(fx.sqlTag`update public.hi_guides set status = 'ready_for_review', total_value_cents = ${orig!.t},
      issues = '[]', terminology_version = '202609' where id = ${subId}::uuid`));
  await fx.asUser(C, (tx) => tx.execute(fx.sqlTag`update public.hi_guides set status = 'reviewed', reviewed_by = ${C.doctorId}::uuid where id = ${subId}::uuid`));
  await fx.asUser(C, (tx) =>
    issueConsultaGuide(tx, {
      clinicId: C.clinicId,
      guideId: subId,
      card: { membershipId: orig!.m, cardNumber: SYNTHETIC_CARD, auditEventId: 'leitura-auditada-simulada' },
      newborn: false,
      professionalName: 'Dra. Sintética',
      actorUserId: C.doctorId,
      today: '2026-12-31',
    }),
  );
  const pair = (await sql`select id::text, status, live from public.hi_guides where id in (${gW}::uuid, ${subId}::uuid)`) as unknown as Array<{ id: string; status: string; live: boolean }>;
  assert.deepEqual(pair.find((r) => r.id === gW), { id: gW, status: 'replaced', live: false });
  assert.deepEqual(pair.find((r) => r.id === subId), { id: subId, status: 'approved', live: true });
  assert.deepEqual(await reviewsOf(pW), [], 'substituta viva no mesmo atendimento: sem revisão');
  assert.equal((await position(C, pW)).guideId, subId, 'o repasse passa a seguir a substituta');
  pass('15.6 substituição aprovada de guia em análise: a original vira "substituída" e a substituta viva no mesmo ato; a checagem no commit vê o estado final, nenhuma revisão é aberta e o repasse passa a seguir a substituta');

  // 15.7 Classe C: com o módulo desligado, a decisão continua (preservação de obrigação).
  const X = await cancelledWithAuth(6000);
  await sql`update public.hi_clinic_settings set enabled = false where clinic_id = ${C.clinicId}::uuid`;
  await decideAs(outra, X.r.id, 'maintain', REASON);
  await sql`update public.hi_clinic_settings set enabled = true where clinic_id = ${C.clinicId}::uuid`;
  pass('15.7 classe C: com o módulo desligado na clínica, a decisão da revisão continua permitida (preservação da obrigação com o profissional)');

  // 15.8 Isolamento: outra clínica não decide (nem com o id certo); a clínica do chamador não vale.
  const Y = await cancelledWithAuth(6000);
  await assert.rejects(() => decideAs(D.doctorId, Y.r.id, 'maintain', REASON, null, D), (e: { code?: string }) => e.code === 'not_found');
  await rejects(
    () => withTenant(D.clinicId, (tx) => review.decidePayoutReviewTx(tx, { clinicId: C.clinicId, reviewId: Y.r.id, decision: 'maintain', reason: REASON }), D.doctorId),
    /fora da clínica da sessão/u,
  );
  assert.equal((await reviewsOf(Y.p))[0]!.status, 'open');
  pass('15.8 isolamento: a sessão de outra clínica não encontra a revisão (mesmo com o id certo) e não pode agir em nome da clínica dona; a revisão continua aberta');

  // 15.9 Nada fora do TISS foi tocado.
  // (a guia enviada da 15.6 tem recebível desde o envio, pela ponte da 0153: fora desta conta)
  for (const g of [gB, gN, gCx, S1.g, S2.g, S3.g, gR, X.g, Y.g]) assert.deepEqual(await money(g), [0, 0, 0]);
  const [{ n: particularEnd }] = (await sql`select count(*)::int as n from public.professional_payouts`) as unknown as [{ n: number }];
  assert.equal(particularEnd, particularBefore);
  pass('15.9 nenhuma revisão nem decisão toca recebível, livro, lancamentos, Caixa ou o repasse particular');

  console.log(`\nOK — ${passed} provas do repasse profissional de convênio (P10.4).`);
} finally {
  await cluster.stop();
}
