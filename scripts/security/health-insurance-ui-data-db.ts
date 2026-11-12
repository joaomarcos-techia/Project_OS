/**
 * Convênios P7.7/P9.9 — as leituras da INTERFACE (src/contexts/health-insurance/queries.ts)
 * contra o schema real (migrations 0000–0154) em Postgres DESCARTÁVEL, com dados montados
 * pelo código real (emissão, lote, XSD, envio, glosa, recurso, pagamento e a ponte 0153).
 *
 * Prova: cada consulta das telas roda (nenhuma coluna inventada), os números batem com a
 * conta da guia e com o livro, os filtros funcionam e outra clínica não vê nada.
 *
 *   NODE_OPTIONS=--conditions=react-server npx tsx scripts/security/health-insurance-ui-data-db.ts
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { startScratchSchema } from './scratch-schema';

const cluster = await startScratchSchema({ port: 55516, maxConnections: 24 });
const { sql } = cluster;
if (!/@(?:127\.0\.0\.1|localhost):55516\//u.test(cluster.url)) throw new Error('não é o cluster local');
process.env.DATABASE_URL = cluster.url;
delete process.env.DATABASE_URL_RUNTIME;
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://ci.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_ci';
process.env.CRYPTO_SECRET_BACKEND = 'env';
process.env.CRYPTO_MASTER_KEY_V1 = Buffer.alloc(32, 7).toString('base64');
process.env.CRYPTO_LOOKUP_SALT = Buffer.alloc(32, 9).toString('base64');

const q = await import('../../src/contexts/health-insurance/queries');
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
const key = (p: string) => `${p}-${randomUUID()}`;
let passed = 0;
const pass = (msg: string): void => {
  passed += 1;
  console.log(`PASS: ${msg}`);
};
const timings: Record<string, number> = {};
async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const t0 = performance.now();
  try {
    return await fn();
  } finally {
    timings[label] = Math.round(performance.now() - t0);
  }
}

try {
  // Privilégios padrão que o Supabase dá a `authenticated` em `public` (conferidos no DEV em 12/11,
  // só leitura de catálogo): o cluster descartável não os tem.
  await sql`GRANT SELECT ON public.clinics, public.profiles TO authenticated`;
  await fx.seedTerminology();
  const A = await fx.setupClinic('A');
  const B = await fx.setupClinic('B');
  const L = await fx.sentBatch(A, 3);
  const [g1, g2, g3] = L.guides as [string, string, string];
  // Desfechos: g1 paga, g2 com glosa definitiva parcial, g3 com glosa em recurso; um pagamento a conciliar.
  await fx.asUser(A, (tx) => acct.recordPaymentInTx(tx, { clinicId: A.clinicId, insurerId: A.insurerId, batchId: L.batchId, paidOn: '2026-11-11', amountCents: VALUE, source: 'manual', idempotencyKey: key('pg'), allocations: [{ guideId: g1, batchId: L.batchId, amountCents: VALUE }] }));
  const gl2 = await fx.asSystem(A, (tx) => acct.recordGlossInTx(tx, { clinicId: A.clinicId, batchId: L.batchId, guideId: g2, code: '1705', amountCents: 5000, source: 'statement', returnId: L.analysisReturn, idempotencyKey: key('gl') }));
  await fx.asUser(A, (tx) => acct.transitionGlossInTx(tx, { clinicId: A.clinicId, glossId: gl2, version: 1, to: 'under_analysis' }));
  await fx.asUser(A, (tx) => acct.transitionGlossInTx(tx, { clinicId: A.clinicId, glossId: gl2, version: 2, to: 'definitive', reason: 'Conferido: a operadora tem razão no código' }));
  const gl3 = await fx.asSystem(A, (tx) => acct.recordGlossInTx(tx, { clinicId: A.clinicId, batchId: L.batchId, guideId: g3, code: '1909', amountCents: VALUE, source: 'statement', returnId: L.analysisReturn, idempotencyKey: key('gl') }));
  await fx.asUser(A, (tx) => acct.createAppealInTx(tx, { clinicId: A.clinicId, guideId: g3, items: [{ glossId: gl3 }], justification: 'Procedimento autorizado previamente pela operadora e realizado na data informada.', idempotencyKey: key('rec') }));
  await fx.asUser(A, (tx) => acct.recordPaymentInTx(tx, { clinicId: A.clinicId, insurerId: A.insurerId, batchId: L.batchId, paidOn: '2026-11-12', amountCents: 7000, source: 'manual', idempotencyKey: key('pg') }));
  const approved = await A.approvedGuide();
  await B.approvedGuide();

  // ── Painel ───────────────────────────────────────────────────────────
  const o = await timed('overview', () => q.getInsuranceOverview(A.clinicId));
  assert.equal(o.enabled, true);
  assert.deepEqual(
    [o.totals.guides, o.totals.billedCents, o.totals.paidCents, o.totals.glossDefinitiveCents, o.totals.glossOpenCents, o.totals.pendingCents, o.totals.unreconciledCents],
    [3, 3 * VALUE, VALUE, 5000, VALUE, 3 * VALUE - VALUE - 5000, 7000],
  );
  assert.equal(o.insurers[0]!.name, 'Operadora Um');
  assert.equal(o.guidesByStatus.approved, 1);
  assert.equal(o.ledgerDrift, 0);
  pass('painel: faturado, recebido, glosa definitiva e em aberto, a receber e não conciliado batem com a conta das guias; guias por etapa; conferência com o livro vazia');

  // ── Guias: lista e filtros ───────────────────────────────────────────
  const all = await timed('listGuides', () => q.listGuides(A.clinicId));
  assert.equal(all.total, 4);
  assert.ok(all.rows.every((r) => r.patientName?.startsWith('Paciente Sintético')));
  assert.equal((await q.listGuides(A.clinicId, { status: 'prontas' })).rows.map((r) => r.id).join(), approved);
  assert.equal((await q.listGuides(A.clinicId, { status: 'desfecho' })).total, 3);
  const n1 = all.rows.find((r) => r.id === g1)!.number;
  assert.deepEqual((await q.listGuides(A.clinicId, { q: n1 })).rows.map((r) => r.id), [g1]);
  assert.equal((await q.listGuides(A.clinicId, { q: 'Paciente Sint' })).total, 4);
  assert.equal((await q.listGuides(A.clinicId, { insurerId: A.insurerId })).total, 4);
  assert.equal((await q.listGuides(A.clinicId, { owner: 'medico' })).total, 0);
  assert.equal((await q.listGuides(A.clinicId, { q: "'; drop table x; --" })).total, 0);
  pass('lista de guias: total, paciente, lote e filtros por etapa, operadora, responsável e busca (número e nome; texto hostil vira busca vazia, nunca SQL)');

  // ── Detalhe da guia ──────────────────────────────────────────────────
  const d2 = await timed('getGuideDetail', () => q.getGuideDetail(A.clinicId, g2));
  assert.ok(d2);
  assert.deepEqual([d2.items.length, d2.account?.glossDefinitiveCents, d2.glosses[0]?.status, d2.glosses[0]?.code, d2.batchId, d2.receivable?.valorGlosadoCents], [1, 5000, 'definitive', '1705', L.batchId, 5000]);
  assert.ok(d2.events.length > 0);
  const d3 = (await q.getGuideDetail(A.clinicId, g3))!;
  assert.deepEqual([d3.appeals.length, d3.appeals[0]!.status, d3.appeals[0]!.glossIds], [1, 'draft', [gl3]]);
  const d1 = (await q.getGuideDetail(A.clinicId, g1))!;
  assert.deepEqual([d1.allocations.length, d1.allocations[0]!.kind, d1.receivable?.status], [1, 'allocation', 'pago']);
  pass('detalhe da guia: itens, histórico, conta, glosas (definitiva baixando o recebível do livro), recursos com as glosas vinculadas e pagamentos alocados');

  // ── Lotes ────────────────────────────────────────────────────────────
  const batches = await timed('listBatches', () => q.listBatches(A.clinicId));
  assert.deepEqual(batches.map((b) => [b.id, b.status, b.guideCount]), [[L.batchId, 'under_review', 3]]);
  const bd = (await timed('getBatchDetail', () => q.getBatchDetail(A.clinicId, L.batchId)))!;
  assert.deepEqual([bd.guides.length, bd.payments.length, bd.returns.map((r) => r.kind), bd.fileId !== null, bd.protocolNumber !== null], [3, 2, ['protocol_receipt', 'analysis_statement'], true, true]);
  assert.equal(bd.payments.find((p) => p.amountCents === 7000)!.unreconciledCents, 7000);
  const cands = await q.listBatchCandidates(A.clinicId);
  assert.deepEqual(cands.flatMap((c) => c.guides.map((g) => g.id)), [approved]);
  pass('lotes: lista, detalhe (guias com a conta de cada uma, pagamentos com o não conciliado, retornos, XML e protocolo) e candidatas = só guias aprovadas');

  // ── Conciliação ──────────────────────────────────────────────────────
  const pays = await q.listInsurerPayments(A.clinicId);
  assert.deepEqual(pays.map((p) => p.unreconciledCents).sort((a, b) => a - b), [0, 7000]);
  assert.ok(pays.every((p) => p.insurerId === A.insurerId));
  const open = await q.listOpenGuidesForAllocation(A.clinicId);
  assert.deepEqual(open.map((g) => g.id).sort(), [g2, g3].sort());
  pass('conciliação: pagamentos com o valor sem guia e as guias com saldo (com o lote de cada uma) para alocar, todos da mesma operadora');

  // ── Isolamento ───────────────────────────────────────────────────────
  assert.equal(await q.getGuideDetail(B.clinicId, g1), null);
  assert.equal(await q.getBatchDetail(B.clinicId, L.batchId), null);
  const oB = await q.getInsuranceOverview(B.clinicId);
  assert.deepEqual([oB.totals.guides, (await q.listGuides(B.clinicId)).total, (await q.listBatches(B.clinicId)).length, (await q.listInsurerPayments(B.clinicId)).length], [0, 1, 0, 0]);
  pass('isolamento: a clínica B não vê guia, lote, pagamento nem valores da A (só a própria guia aprovada)');

  console.log(JSON.stringify({ timingsMs: timings }));
  console.log(`\n${passed}/6 provas das leituras da interface passaram.`);
  assert.equal(passed, 6);
} finally {
  await cluster.stop();
}
