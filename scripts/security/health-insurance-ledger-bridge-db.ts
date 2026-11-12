/**
 * Convênios 0153 — ponte da conta da guia com o livro financeiro da clínica (R37), em
 * Postgres DESCARTÁVEL com as migrations reais 0000–0153 e o código real:
 *
 *   guia emitida → lote → XML validado (motor XSD do app) → enviado → recebível no livro
 *   → glosa / recurso / pagamento / estorno pelo serviço da conta (funções da 0152)
 *   → a ponte (gatilhos da 0153) projeta cada fato UMA vez em lancamentos e
 *     payment_transactions, na mesma transação.
 *
 * Cenários exigidos (orientação de 12/11, decisão 3): pagamento integral, parcial, dois
 * pagamentos da mesma guia, duplicado, glosa parcial, glosa definitiva, recurso deferido,
 * estorno, pagamento depois de glosa, lote com várias guias, diferença de valores,
 * concorrência, falha transacional, reprocessamento, isolamento entre clínicas, trial,
 * assinatura suspensa e ativa. Mais: guardas (Caixa não registra pagamento de operadora,
 * recebível não é editado por fora), particular inalterado, fora do dunning e da cobrança
 * Asaas, Caixa só com dinheiro, guia substituída, divergência sempre vazia.
 *
 *   NODE_OPTIONS=--conditions=react-server npx tsx scripts/security/health-insurance-ledger-bridge-db.ts
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { startScratchSchema } from './scratch-schema';

const cluster = await startScratchSchema({ port: 55513, maxConnections: 32 });
const { sql } = cluster;
if (!/@(?:127\.0\.0\.1|localhost):55513\//u.test(cluster.url)) throw new Error('não é o cluster local');
process.env.DATABASE_URL = cluster.url;
delete process.env.DATABASE_URL_RUNTIME;
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://ci.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_ci';
process.env.CRYPTO_SECRET_BACKEND = 'env';
process.env.CRYPTO_MASTER_KEY_V1 = Buffer.alloc(32, 7).toString('base64');
process.env.CRYPTO_LOOKUP_SALT = Buffer.alloc(32, 9).toString('base64');

const acct = await import('../../src/contexts/health-insurance/internal/insurance-account-service');
const { loadXmllintValidator } = await import('../../src/contexts/health-insurance/tiss/xml/xsd-validator');
const { loadHiFixtures, GUIDE_VALUE_CENTS: VALUE } = await import('./hi-fixtures');

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
const { asUser, asSystem, sentBatch, sqlTag } = fx;

let passed = 0;
const pass = (msg: string): void => {
  passed += 1;
  console.log(`PASS: ${msg}`);
};
async function rejects(code: string, op: () => Promise<unknown>, hint?: RegExp): Promise<void> {
  await assert.rejects(op, (e: unknown) => {
    const err = e as { kind?: string; code?: string; message?: string; cause?: { code?: string; message?: string } };
    const got = err.kind ?? err.code ?? err.cause?.code;
    assert.equal(got, code, `${String(err.message ?? err)} ${err.cause?.message ?? ''}`);
    if (hint) assert.match(`${err.message} ${err.cause?.message ?? ''}`, hint);
    return true;
  });
}
const key = (p: string) => `${p}-${randomUUID()}`;
const reais = (cents: number) => (cents / 100).toFixed(2);

/** O recebível da guia no livro (ou null). */
async function receivable(guideId: string) {
  const [l] = await sql`select id, tipo, status, valor, valor_pago, valor_glosado, payment_method, patient_id, appointment_id, created_via, paid_at
    from public.lancamentos where source_hi_guide_id = ${guideId}::uuid`;
  return l ?? null;
}
async function cash(lancamentoId: string) {
  return sql`select kind, amount, payment_method, original_payment_id, reason from public.payment_transactions
    where lancamento_id = ${lancamentoId}::uuid order by created_at, kind`;
}
const drift = async (c: Clinic) => asUser(c, (tx) => tx.execute(sqlTag`select * from public.hi_ledger_drift`)) as Promise<unknown[]>;
const pay = (c: Clinic, batchId: string, allocations: Array<{ guideId: string; amountCents: number }>, over: Record<string, unknown> = {}) =>
  asUser(c, (tx) =>
    acct.recordPaymentInTx(tx, {
      clinicId: c.clinicId, insurerId: c.insurerId, paidOn: '2026-11-11',
      amountCents: allocations.reduce((s, a) => s + a.amountCents, 0), source: 'manual', idempotencyKey: key('pg'),
      allocations: allocations.map((a) => ({ ...a, batchId })), ...over,
    } as Parameters<typeof acct.recordPaymentInTx>[1]),
  );
const gloss = (c: Clinic, L: { batchId: string; analysisReturn: string }, guideId: string, cents: number, code = '1705') =>
  asSystem(c, (tx) =>
    acct.recordGlossInTx(tx, {
      clinicId: c.clinicId, batchId: L.batchId, guideId, code, amountCents: cents, source: 'statement',
      returnId: L.analysisReturn, idempotencyKey: `dem:${L.analysisReturn}:${guideId}:${code}:${cents}`,
    }),
  );
const makeDefinitive = async (c: Clinic, glossId: string) => {
  await asUser(c, (tx) => acct.transitionGlossInTx(tx, { clinicId: c.clinicId, glossId, version: 1, to: 'under_analysis' }));
  await asUser(c, (tx) => acct.transitionGlossInTx(tx, { clinicId: c.clinicId, glossId, version: 2, to: 'definitive', reason: 'Conferido: a operadora tem razão no código' }));
};

try {
  await sql`GRANT SELECT ON public.clinics TO authenticated`;
  await fx.seedTerminology();
  const A = await fx.setupClinic('A');
  const B = await fx.setupClinic('B');
  const [{ n: lancOutsideBefore }] = (await sql`select count(*)::int as n from public.lancamentos where source_hi_guide_id is null`) as unknown as [{ n: number }];
  const [{ n: chargesBefore }] = (await sql`select count(*)::int as n from public.patient_charges`) as unknown as [{ n: number }];

  // ── 1. Envio abre o recebível; pagamento integral quita com dinheiro no Caixa ──
  const L1 = await sentBatch(A, 4);
  const [g1, g2, g3, g4] = L1.guides as [string, string, string, string];
  const r0 = await receivable(g1);
  assert.ok(r0);
  assert.deepEqual(
    [r0.tipo, r0.status, r0.valor, r0.valor_pago, r0.valor_glosado, r0.payment_method, r0.patient_id, r0.appointment_id, r0.created_via],
    ['receber', 'pendente', reais(VALUE), '0.00', '0.00', 'convenio', null, null, 'auto'],
  );
  assert.equal((await sql`select count(*)::int as n from public.lancamentos where source_hi_guide_id = any(${L1.guides}::uuid[])`)[0]!.n, 4);
  await pay(A, L1.batchId, [{ guideId: g1, amountCents: VALUE }]);
  const r1 = (await receivable(g1))!;
  const c1 = await cash(r1.id as string);
  assert.deepEqual([r1.status, r1.valor_pago, r1.valor_glosado, r1.paid_at !== null], ['pago', reais(VALUE), '0.00', true]);
  assert.deepEqual(c1.map((x) => [x.kind, x.amount, x.payment_method]), [['payment', reais(VALUE), 'convenio']]);
  pass('envio do lote abre UM recebível por guia (a receber, "convênio", sem paciente e sem atendimento, pendente); pagamento integral vira um pagamento no livro e quita');

  // ── 2. Pagamento parcial e 3. dois pagamentos da mesma guia ──────────
  await pay(A, L1.batchId, [{ guideId: g2, amountCents: 9000 }]);
  const r2a = (await receivable(g2))!;
  assert.deepEqual([r2a.status, r2a.valor_pago, r2a.paid_at], ['parcial', '90.00', null]);
  await pay(A, L1.batchId, [{ guideId: g2, amountCents: VALUE - 9000 }]);
  const r2b = (await receivable(g2))!;
  assert.deepEqual([r2b.status, r2b.valor_pago, (await cash(r2b.id as string)).map((x) => x.amount)], ['pago', reais(VALUE), ['90.00', '60.00']]);
  pass('pagamento parcial fica "parcial" (nunca quita); o segundo pagamento da mesma guia completa e quita, com os dois movimentos no livro');

  // ── 4. Pagamento duplicado (mesma chave e mesmo demonstrativo) ────────
  const dupKey = key('pg');
  const p1 = await pay(A, L1.batchId, [{ guideId: g3, amountCents: 5000 }], { idempotencyKey: dupKey, statementRef: 'DEM-DUP-1' });
  const p2 = await pay(A, L1.batchId, [{ guideId: g3, amountCents: 5000 }], { idempotencyKey: dupKey, statementRef: 'DEM-DUP-1' });
  assert.equal(p1, p2);
  await rejects('duplicate', () => pay(A, L1.batchId, [{ guideId: g3, amountCents: 5000 }], { statementRef: 'DEM-DUP-1' }), /demonstrativo/u);
  const r3 = (await receivable(g3))!;
  assert.deepEqual([r3.valor_pago, (await cash(r3.id as string)).length], ['50.00', 1]);
  pass('pagamento duplicado (mesma chave) devolve o mesmo pagamento e o mesmo demonstrativo é recusado: UM movimento no livro, o saldo do Caixa não dobra');

  // ── 5. Glosa parcial em aberto não baixa nada; 6. definitiva baixa sem caixa ──
  const gl3 = await gloss(A, L1, g3, 4000);
  const r3open = (await receivable(g3))!;
  assert.deepEqual([r3open.status, r3open.valor_pago, r3open.valor_glosado], ['parcial', '50.00', '0.00']);
  await makeDefinitive(A, gl3);
  const r3def = (await receivable(g3))!;
  assert.deepEqual([r3def.status, r3def.valor_pago, r3def.valor_glosado], ['parcial', '50.00', '40.00']);
  assert.equal((await cash(r3def.id as string)).length, 1);
  // ── 9. Pagamento depois da glosa: o resto quita (pago + glosa definitiva = faturado) ──
  await pay(A, L1.batchId, [{ guideId: g3, amountCents: VALUE - 5000 - 4000 }]);
  const r3end = (await receivable(g3))!;
  assert.deepEqual([r3end.status, r3end.valor_pago, r3end.valor_glosado], ['pago', '110.00', '40.00']);
  pass('glosa em aberto não baixa o recebível; glosa DEFINITIVA baixa R$ 40 sem movimento de caixa; o pagamento do resto depois da glosa quita (R$ 110 pagos + R$ 40 glosa = R$ 150)');

  // ── 7. Recurso deferido: glosa contestada não baixa; revertida, o pagamento entra ──
  const gl4 = await gloss(A, L1, g4, VALUE);
  const ap = await asUser(A, (tx) => acct.createAppealInTx(tx, { clinicId: A.clinicId, guideId: g4, items: [{ glossId: gl4 }], justification: 'O procedimento foi autorizado pela operadora e realizado na data; anexo o comprovante da autorização.', idempotencyKey: key('rec') }));
  await asUser(A, (tx) => acct.fileAppealInTx(tx, { clinicId: A.clinicId, appealId: ap, version: 1, channel: 'manual', filedOn: '2026-11-11', protocol: 'REC-2026-90' }));
  const r4appeal = (await receivable(g4))!;
  assert.deepEqual([r4appeal.status, r4appeal.valor_glosado], ['pendente', '0.00']);
  await asUser(A, (tx) => acct.answerAppealInTx(tx, { clinicId: A.clinicId, appealId: ap, version: 2, answeredOn: '2026-11-12', items: [{ glossId: gl4, acceptedCents: VALUE }], note: 'Recurso deferido integralmente' }));
  assert.deepEqual([(await receivable(g4))!.status, (await receivable(g4))!.valor_glosado], ['pendente', '0.00']);
  await pay(A, L1.batchId, [{ guideId: g4, amountCents: VALUE }]);
  assert.deepEqual([(await receivable(g4))!.status, (await receivable(g4))!.valor_pago], ['pago', reais(VALUE)]);
  pass('recurso: glosa contestada e em recurso não baixa nada (perda não presumida); deferido, nada vira glosa e o pagamento posterior quita');

  // ── 8. Estorno: reembolso ligado ao pagamento original; refazer a alocação funciona ──
  const [alloc1] = await sql`select id, payment_id from public.hi_payment_allocations where guide_id = ${g1}::uuid and kind = 'allocation'`;
  await asUser(A, (tx) => acct.reversePaymentAllocationInTx(tx, { clinicId: A.clinicId, allocationId: alloc1!.id as string, reason: 'Alocação desfeita para conferência; refazer em seguida' }));
  const r1rev = (await receivable(g1))!;
  const c1rev = await cash(r1rev.id as string);
  assert.deepEqual([r1rev.status, r1rev.valor_pago, r1rev.paid_at, c1rev.map((x) => x.kind)], ['pendente', '0.00', null, ['payment', 'refund']]);
  assert.equal(c1rev[1]!.original_payment_id !== null && String(c1rev[1]!.reason).startsWith('Estorno de pagamento da operadora'), true);
  // O dinheiro estornado volta a "não conciliado" no MESMO pagamento, que é realocado.
  await asUser(A, (tx) => acct.allocatePaymentInTx(tx, { clinicId: A.clinicId, paymentId: alloc1!.payment_id as string, allocationKey: key('realoc'), allocations: [{ guideId: g1, batchId: L1.batchId, amountCents: VALUE }] }));
  assert.deepEqual([(await receivable(g1))!.status, (await cash(r1rev.id as string)).map((x) => x.kind)], ['pago', ['payment', 'refund', 'payment']]);
  pass('estorno vira reembolso COMPENSATÓRIO ligado ao pagamento original (nada apagado); o recebível volta a pendente e aceita a alocação refeita (capacidade pelo pago líquido)');

  // ── 10. Lote com várias guias (rateio exato) e 11. diferença de valores ──
  const L2 = await sentBatch(A, 3);
  const exact = await asUser(A, (tx) => acct.recordPaymentInTx(tx, { clinicId: A.clinicId, insurerId: A.insurerId, batchId: L2.batchId, paidOn: '2026-11-12', amountCents: 3 * VALUE, source: 'manual', idempotencyKey: key('pg') }));
  const statuses = await Promise.all(L2.guides.map(async (g) => (await receivable(g))!.status));
  assert.deepEqual(statuses, ['pago', 'pago', 'pago']);
  const L3 = await sentBatch(A, 2);
  const inexact = await asUser(A, (tx) => acct.recordPaymentInTx(tx, { clinicId: A.clinicId, insurerId: A.insurerId, batchId: L3.batchId, paidOn: '2026-11-12', amountCents: 2 * VALUE - 700, source: 'manual', idempotencyKey: key('pg') }));
  assert.deepEqual(await Promise.all(L3.guides.map(async (g) => (await receivable(g))!.status)), ['pendente', 'pendente']);
  const [rcv] = await asUser(A, (tx) => tx.execute(sqlTag`select * from public.hi_insurer_receivables where insurer_id = ${A.insurerId}::uuid`)) as unknown as Array<Record<string, unknown>>;
  assert.equal(Number(rcv!.unreconciled_cents), 2 * VALUE - 700);
  assert.ok(exact && inexact);
  pass('lote com 3 guias pago pelo valor exato: rateado, 3 recebíveis quitados; pagamento com DIFERENÇA de valor não é rateado nem lançado — fica "não conciliado" (R$ 293) na visão por operadora até uma pessoa alocar');

  // ── 12. Concorrência: pagamentos simultâneos na mesma guia não estouram ──
  const L4 = await sentBatch(A, 1);
  const gc = L4.guides[0]!;
  const tries = await Promise.allSettled(Array.from({ length: 6 }, () => pay(A, L4.batchId, [{ guideId: gc, amountCents: 6000 }])));
  const okTries = tries.filter((t) => t.status === 'fulfilled').length;
  const rc = (await receivable(gc))!;
  assert.equal(okTries, 2);
  assert.deepEqual([rc.valor_pago, rc.status, (await cash(rc.id as string)).length], ['120.00', 'parcial', 2]);
  pass('concorrência: 6 pagamentos simultâneos de R$ 60 numa guia de R$ 150 — 2 entram, 4 são recusados pelo saldo; livro e conta iguais');

  // ── 13. Falha transacional: se o livro falha, o pagamento da conta também não fica ──
  await sql`create or replace function public.__fail_ledger() returns trigger language plpgsql as $$ begin raise exception 'falha injetada no livro'; end $$`;
  await sql`create trigger __fail_ledger before insert on public.payment_transactions for each row execute function public.__fail_ledger()`;
  const allocBefore = (await sql`select count(*)::int as n from public.hi_payment_allocations where guide_id = ${gc}::uuid`)[0]!.n;
  await assert.rejects(() => pay(A, L4.batchId, [{ guideId: gc, amountCents: 3000 }]));
  assert.equal((await sql`select count(*)::int as n from public.hi_payment_allocations where guide_id = ${gc}::uuid`)[0]!.n, allocBefore);
  await sql`drop trigger __fail_ledger on public.payment_transactions`;
  await sql`drop function public.__fail_ledger()`;
  await pay(A, L4.batchId, [{ guideId: gc, amountCents: 3000 }]);
  assert.deepEqual([(await receivable(gc))!.status, (await receivable(gc))!.valor_pago], ['pago', reais(VALUE)]);
  pass('falha transacional: com o livro falhando, a alocação também volta (mesma transação, nada pela metade); repetindo depois, entra uma vez');

  // ── 14. Reprocessamento (idempotente) e recuperação de projeção ausente ──
  const entriesBefore = (await sql`select count(*)::int as n from public.hi_ledger_entries where clinic_id = ${A.clinicId}::uuid`)[0]!.n;
  const n1 = await asUser(A, (tx) => tx.execute(sqlTag`select public.hi_ledger_sync_clinic(${A.clinicId}::uuid) as n`));
  const n2 = await asUser(A, (tx) => tx.execute(sqlTag`select public.hi_ledger_sync_clinic(${A.clinicId}::uuid) as n`));
  assert.ok(n1 && n2);
  assert.equal((await sql`select count(*)::int as n from public.hi_ledger_entries where clinic_id = ${A.clinicId}::uuid`)[0]!.n, entriesBefore);
  // Projeção ausente (ex.: fatos anteriores à 0153): gatilhos da ponte desligados só aqui.
  const L5 = await sentBatch(A, 1);
  const gp = L5.guides[0]!;
  // Os dois caminhos da ponte (alocação e mudança de estado da guia) precisam estar desligados:
  // com um só desligado, o outro já projeta o pagamento.
  await sql`alter table public.hi_payment_allocations disable trigger hi_payment_allocations_ledger_sync`;
  await sql`alter table public.hi_guides disable trigger hi_guides_ledger_sync`;
  await pay(A, L5.batchId, [{ guideId: gp, amountCents: 7000 }]);
  await sql`alter table public.hi_payment_allocations enable trigger hi_payment_allocations_ledger_sync`;
  await sql`alter table public.hi_guides enable trigger hi_guides_ledger_sync`;
  const before = (await drift(A)) as Array<{ drift: string }>;
  assert.deepEqual(before.map((d) => d.drift), ['paid_mismatch']);
  await asUser(A, (tx) => tx.execute(sqlTag`select public.hi_ledger_sync_clinic(${A.clinicId}::uuid)`));
  assert.deepEqual([(await drift(A)).length, (await receivable(gp))!.valor_pago], [0, '70.00']);
  pass('reprocessamento: rodar a ponte de novo não cria movimento; projeção ausente aparece na conferência ("paid_mismatch") e o reprocessamento a reconstrói; divergência volta a vazia');

  // ── Guia substituída antes de receber: recebível cancelado, a substituta abre o dela ──
  const L6 = await sentBatch(A, 1);
  const gs = L6.guides[0]!;
  const [orig] = await sql`select * from public.hi_guides where id = ${gs}::uuid`;
  await asUser(A, (tx) => tx.execute(sqlTag`insert into public.hi_guides (clinic_id, guide_type, number, insurer_id, patient_id, membership_id,
      executant_professional_id, replaces_guide_id, idempotency_key, created_via, created_by)
    values (${A.clinicId}::uuid, 'consulta', ${`9${String(orig!.number).slice(-6)}`}, ${A.insurerId}::uuid, ${orig!.patient_id}::uuid,
      ${orig!.membership_id}::uuid, ${A.doctorId}::uuid, ${gs}::uuid, ${key('sub')}, 'user', ${A.doctorId}::uuid)`));
  // A substituição é transição do banco (só o dono, com a sessão na clínica), como no fluxo real.
  await rejects('55000', () => asUser(A, (tx) => tx.execute(sqlTag`update public.hi_guides set status = 'replaced' where id = ${gs}::uuid`)));
  await sql.begin(async (t) => {
    await t`select set_config('app.current_clinic', ${A.clinicId}, true)`;
    await t`update public.hi_guides set status = 'replaced' where id = ${gs}::uuid`;
  });
  const rs = (await receivable(gs))!;
  assert.equal(rs.status, 'cancelado');
  assert.deepEqual((await drift(A)).length, 0);
  pass('guia substituída depois do envio e antes de receber: o recebível dela é CANCELADO pela ponte (nenhum faturamento em dobro); conferência vazia');

  // ── Guardas: Caixa não registra pagamento de operadora nem edita o recebível ──
  await rejects('42501', () => asUser(A, (tx) => tx.execute(sqlTag`insert into public.payment_transactions (clinic_id, lancamento_id, kind, amount, payment_method)
    values (${A.clinicId}::uuid, ${r2b.id}::uuid, 'payment', 1, 'pix')`)), /Convênios/u);
  await rejects('42501', () => asUser(A, (tx) => tx.execute(sqlTag`update public.lancamentos set status = 'cancelado' where id = ${r0.id}::uuid`)), /Convênios/u);
  await rejects('42501', () => asUser(A, (tx) => tx.execute(sqlTag`update public.lancamentos set valor_pago = 0, status = 'pendente' where id = ${r0.id}::uuid`)));
  await rejects('42501', () => asUser(A, (tx) => tx.execute(sqlTag`insert into public.lancamentos (clinic_id, tipo, descricao, valor, status, payment_method, created_via, source_hi_guide_id)
    values (${A.clinicId}::uuid, 'receber', 'forjado', 150, 'pendente', 'convenio', 'auto', ${g4}::uuid)`)));
  await rejects('23514', () => asUser(A, (tx) => tx.execute(sqlTag`insert into public.lancamentos (clinic_id, tipo, descricao, valor, valor_glosado, status, created_via)
    values (${A.clinicId}::uuid, 'receber', 'particular com glosa', 100, 10, 'pendente', 'manual')`)));
  pass('guardas: pagamento de operadora nunca entra como pagamento do Caixa (42501); o recebível de convênio não é cancelado nem editado por fora; recebível forjado é recusado; "glosa" em lançamento particular é recusada pelo CHECK');

  // ── Particular inalterado: o limite bruto da 0073 continua valendo fora do convênio ──
  const [part] = await asUser(A, (tx) => tx.execute(sqlTag`insert into public.lancamentos (clinic_id, tipo, descricao, valor, status, created_via)
    values (${A.clinicId}::uuid, 'receber', 'Particular sintético', 100, 'pendente', 'manual') returning id`)) as unknown as Array<{ id: string }>;
  const [pay1] = await asUser(A, (tx) => tx.execute(sqlTag`insert into public.payment_transactions (clinic_id, lancamento_id, kind, amount, payment_method)
    values (${A.clinicId}::uuid, ${part!.id}::uuid, 'payment', 100, 'pix') returning id`)) as unknown as Array<{ id: string }>;
  await asUser(A, (tx) => tx.execute(sqlTag`insert into public.payment_transactions (clinic_id, lancamento_id, kind, amount, payment_method, original_payment_id, reason)
    values (${A.clinicId}::uuid, ${part!.id}::uuid, 'refund', 100, 'pix', ${pay1!.id}::uuid, 'devolução sintética')`));
  await assert.rejects(() => asUser(A, (tx) => tx.execute(sqlTag`insert into public.payment_transactions (clinic_id, lancamento_id, kind, amount, payment_method)
    values (${A.clinicId}::uuid, ${part!.id}::uuid, 'payment', 100, 'pix')`)), (e: unknown) =>
    /payment exceeds lancamento value/u.test(String((e as { cause?: { message?: string } }).cause?.message)));
  pass('particular inalterado: pagamento, reembolso e o limite BRUTO da 0073 (novo pagamento após reembolso integral continua recusado) — o ramo líquido vale só para convênio');

  // ── Fora do dunning, dos casos de cobrança e da cobrança Asaas; sem eventos do financeiro ──
  const dunning = await sql`select l.id from public.lancamentos l
     where l.tipo = 'receber' and l.status in ('pendente','parcial') and l.patient_id is not null and l.valor > l.valor_pago
       and l.source_hi_guide_id is not null`;
  const [{ n: chargesAfter }] = (await sql`select count(*)::int as n from public.patient_charges`) as unknown as [{ n: number }];
  const [{ n: finEvents }] = (await sql`select count(*)::int as n from public.outbox where event_type like 'financial.%'`) as unknown as [{ n: number }];
  assert.deepEqual([dunning.length, chargesAfter - chargesBefore, finEvents], [0, 0, 0]);
  pass('recebível de operadora fora do dunning (sem paciente), sem cobrança Asaas criada e sem evento do financeiro publicado (nada avisa o paciente)');

  // ── Caixa só com dinheiro: rollup diário = pagamentos − estornos; glosa nunca entra ──
  const [roll] = await sql`select
      coalesce(sum(case when l.tipo='receber' and pt.kind='payment' then pt.amount else 0 end),0) as recebido,
      coalesce(sum(case when l.tipo='receber' and pt.kind='refund' then pt.amount else 0 end),0) as devolvido
    from public.payment_transactions pt join public.lancamentos l on l.id = pt.lancamento_id
    where pt.clinic_id = ${A.clinicId}::uuid and l.source_hi_guide_id is not null`;
  const [{ net }] = (await sql`select coalesce(sum(case kind when 'allocation' then amount_cents else -amount_cents end),0)::bigint as net
    from public.hi_payment_allocations where clinic_id = ${A.clinicId}::uuid`) as unknown as [{ net: string }];
  assert.equal(Math.round((Number(roll!.recebido) - Number(roll!.devolvido)) * 100), Number(net));
  const [{ glossed }] = (await sql`select coalesce(sum(valor_glosado),0) as glossed from public.lancamentos where clinic_id = ${A.clinicId}::uuid`) as unknown as [{ glossed: string }];
  assert.equal(glossed, '40.00');
  pass(`Caixa só com dinheiro: entradas − estornos no livro = alocações líquidas da conta (R$ ${(Number(net) / 100).toFixed(2)}); a glosa definitiva (R$ 40) fica só em valor_glosado`);

  // ── Isolamento entre clínicas ─────────────────────────────────────────
  await rejects('42501', () => asUser(B, (tx) => tx.execute(sqlTag`select public.hi_ledger_sync_clinic(${A.clinicId}::uuid)`)));
  await rejects('42501', () => asUser(B, (tx) => tx.execute(sqlTag`select public.hi_ledger_sync_guide(${A.clinicId}::uuid, ${g1}::uuid)`)));
  const seenByB = await asUser(B, (tx) => tx.execute(sqlTag`select count(*)::int as n from public.hi_ledger_entries`)) as unknown as Array<{ n: number }>;
  const lancByB = await asUser(B, (tx) => tx.execute(sqlTag`select count(*)::int as n from public.lancamentos where source_hi_guide_id is not null`)) as unknown as Array<{ n: number }>;
  assert.deepEqual([seenByB[0]!.n, lancByB[0]!.n], [0, 0]);
  pass('isolamento: outra clínica não reprocessa nem projeta guia alheia (fora da clínica da sessão) e não vê diário nem recebíveis de A');

  // ── Assinatura: suspensa preserva; trial não fatura convênio ──────────
  const L7 = await sentBatch(A, 1);
  const pendingGuide = await A.approvedGuide();
  await sql`update public.subscriptions set billing_status = 'cancelled' where clinic_id = ${A.clinicId}::uuid`;
  await assert.rejects(() => fx.createBatch(A, [pendingGuide]), (e: unknown) => {
    const err = e as { constraint_name?: string; cause?: { constraint_name?: string }; kind?: string; reason?: string };
    return (err.cause?.constraint_name ?? err.constraint_name) === 'qoro_premium_health_insurance' || /premium|subscription_cancelled/u.test(String(err.kind ?? err.reason ?? e));
  });
  await pay(A, L7.batchId, [{ guideId: L7.guides[0]!, amountCents: VALUE }]);
  assert.equal((await receivable(L7.guides[0]!))!.status, 'pago');
  await sql`update public.subscriptions set billing_status = 'active' where clinic_id = ${A.clinicId}::uuid`;
  // Trial: o módulo nem liga (gatilho comercial da 0151 na habilitação).
  const trialClinic = randomUUID();
  await sql`insert into public.clinics (id, slug, nome, status) values (${trialClinic}::uuid, ${`tr-${trialClinic.slice(0, 12)}`}, 'Clínica Trial', 'active')`;
  await sql`insert into public.subscriptions (clinic_id, plan_id, price_id, billing_status, trial_ends_at)
    select ${trialClinic}::uuid, pl.id, pr.id, 'trial', now() + interval '10 days'
      from public.plans pl join public.prices pr on pr.plan_id = pl.id where pl.code = 'clinica_2026_2' order by pr.id limit 1`;
  await assert.rejects(
    () => sql`insert into public.hi_clinic_settings (clinic_id, enabled, enabled_at, enabled_by, provider_kind, cnes_status)
      values (${trialClinic}::uuid, true, now(), ${A.doctorId}::uuid, 'PJ', 'none_declared')`,
    (e: unknown) => (e as { constraint_name?: string }).constraint_name === 'qoro_premium_health_insurance',
  );
  assert.equal((await sql`select count(*)::int as n from public.lancamentos where clinic_id = ${trialClinic}::uuid and source_hi_guide_id is not null`)[0]!.n, 0);
  pass('assinatura suspensa (cancelada): lote novo negado, mas o pagamento de lote JÁ enviado entra no livro (D24-a); trial: nenhuma operação de faturamento de convênio, nenhum recebível de operadora; ativa: fluxo normal (cenários acima)');

  // ── Fecho: divergência vazia e nada fora do convênio mudou ────────────
  assert.deepEqual((await drift(A)).length, 0);
  const [{ n: lancOutsideAfter }] = (await sql`select count(*)::int as n from public.lancamentos where source_hi_guide_id is null and descricao <> 'Particular sintético'`) as unknown as [{ n: number }];
  assert.equal(lancOutsideAfter, lancOutsideBefore);
  const [{ n: entries }] = (await sql`select count(*)::int as n from public.hi_ledger_entries`) as unknown as [{ n: number }];
  pass(`conferência final: divergência vazia; ${entries} movimentos no diário da ponte, cada um com origem única; nenhum lançamento particular criado ou alterado pela ponte`);

  console.log(`\n${passed}/18 cenários da ponte financeira (0153) passaram.`);
  assert.equal(passed, 18);
} finally {
  await cluster.stop();
}
