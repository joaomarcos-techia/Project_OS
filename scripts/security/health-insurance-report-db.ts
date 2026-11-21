/**
 * Convênios P9.10 — relatório por operadora e período: as SOMAS CONFEREM COM O LIVRO, em Postgres
 * DESCARTÁVEL (cadeia do DEV), dados sintéticos. Nunca no DEV compartilhado.
 *
 *   1. três guias enviadas (pagamento parcial, glosa definitiva, glosa em aberto): o relatório soma
 *      exatamente a conta da guia e o recebível por operadora (`hi_insurer_receivables`), e a ponte
 *      com o livro da clínica não tem divergência (`hi_ledger_drift` vazio depois da sincronização);
 *      faturado = recebido + glosa definitiva + pendente;
 *   2. período: lote enviado fora do intervalo não entra; operadora filtrada só traz a dela;
 *   3. isolamento: a sessão da clínica B não lê nada da A, nem passando o id da clínica ou da
 *      operadora da A (RLS); o CSV da A não leva paciente nem carteirinha;
 *   4. a exportação grava trilha na clínica (filtro e quantidade de linhas, sem valores).
 *
 *   SECURITY_PG_BIN=... PORT=55560 NODE_OPTIONS=--conditions=react-server \
 *     npx tsx scripts/security/health-insurance-report-db.ts
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { readDevOrderChain } from './dev-order-chain';
import { startScratchSchema } from './scratch-schema';

const PORT = Number(process.env.PORT ?? 55560);
const chain = await readDevOrderChain();
const cluster = await startScratchSchema({ port: PORT, maxConnections: 8, migrations: chain });
const { sql } = cluster;
if (!new RegExp(`@(?:127\\.0\\.0\\.1|localhost):${PORT}/`, 'u').test(cluster.url)) throw new Error('não é o cluster local');
process.env.DATABASE_URL = cluster.url;
delete process.env.DATABASE_URL_RUNTIME;
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://ci.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_ci';
process.env.CRYPTO_SECRET_BACKEND = 'env';
process.env.CRYPTO_MASTER_KEY_V1 = Buffer.alloc(32, 7).toString('base64');
process.env.CRYPTO_LOOKUP_SALT = Buffer.alloc(32, 9).toString('base64');

const report = await import('../../src/contexts/health-insurance/internal/insurer-report');
const acct = await import('../../src/contexts/health-insurance/internal/insurance-account-service');
const { logAudit } = await import('../../src/lib/audit/log');
const { loadXmllintValidator } = await import('../../src/contexts/health-insurance/tiss/xml/xsd-validator');
const { loadHiFixtures } = await import('./hi-fixtures');

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
  console.log(`PASS ${passed}: ${msg}`);
};
const key = (p: string) => `${p}-${randomUUID()}`;
const sentOnOf = async (batchId: string) => String((await sql`select sent_on::text as d from public.hi_batches where id = ${batchId}::uuid`)[0]!.d);
const build = (c: Clinic, input: { from: string; to: string; insurerId?: string | null }, asClinic: Clinic = c) =>
  fx.asUser(asClinic, (tx) => report.buildInsurerReportTx(tx, c.clinicId, input));

try {
  await sql`GRANT SELECT ON public.clinics, public.profiles TO authenticated`;
  await fx.seedTerminology();
  const A = await fx.setupClinic('Relatório A');
  const B = await fx.setupClinic('Relatório B');
  const L1 = await fx.sentBatch(A, 3);
  const [g1, g2, g3] = L1.guides as [string, string, string];
  const sent = await sentOnOf(L1.batchId);
  const [acc1] = [await fx.asUser(A, (tx) => acct.readGuideAccountInTx(tx, A.clinicId, g1))];
  const value = acc1!.billedCents;
  const item = async (g: string) => String((await sql`select id from public.hi_guide_items where guide_id = ${g}::uuid order by sequence limit 1`)[0]!.id);

  // g1: pagamento parcial (60% do valor); g2: glosa definitiva de R$ 20; g3: glosa em aberto de R$ 30.
  await fx.asUser(A, (tx) => acct.recordPaymentInTx(tx, {
    clinicId: A.clinicId, insurerId: A.insurerId, batchId: L1.batchId, statementRef: 'DEM-REL-1', paidOn: sent, amountCents: Math.round(value * 0.6),
    source: 'manual', idempotencyKey: key('pg'), allocations: [{ guideId: g1, batchId: L1.batchId, amountCents: Math.round(value * 0.6) }],
  }));
  const gl2 = await fx.asUser(A, async (tx) => acct.recordGlossInTx(tx, {
    clinicId: A.clinicId, batchId: L1.batchId, guideId: g2, itemId: await item(g2), code: '1705', amountCents: 2000, source: 'manual', idempotencyKey: key('gl'),
  }));
  const v2 = Number((await sql`select version from public.hi_glosses where id = ${gl2}::uuid`)[0]!.version);
  await fx.asUser(A, (tx) => acct.transitionGlossInTx(tx, { clinicId: A.clinicId, glossId: gl2, version: v2, to: 'under_analysis' }));
  await fx.asUser(A, (tx) => acct.transitionGlossInTx(tx, { clinicId: A.clinicId, glossId: gl2, version: v2 + 1, to: 'definitive', reason: 'Conferido: código não coberto (sintético)' }));
  await fx.asUser(A, async (tx) => acct.recordGlossInTx(tx, {
    clinicId: A.clinicId, batchId: L1.batchId, guideId: g3, itemId: await item(g3), code: '1801', amountCents: 3000, source: 'manual', idempotencyKey: key('gl'),
  }));
  await fx.sentBatch(B, 2);
  await fx.asUser(A, (tx) => acct.syncLedgerForClinicInTx(tx, A.clinicId));

  // 1. Somas = conta da guia = recebível por operadora; livro sem divergência.
  const r = await build(A, { from: sent, to: sent });
  const t = r.insurers[0]!;
  const [rec] = await fx.asUser(A, (tx) => acct.listInsurerReceivablesInTx(tx, A.clinicId));
  assert.equal(r.insurers.length, 1);
  assert.deepEqual(
    [t.guides, t.billedCents, t.paidCents, t.glossOpenCents, t.glossDefinitiveCents, t.pendingCents],
    [rec!.guides, rec!.billedCents, rec!.paidCents, rec!.glossOpenCents, rec!.glossDefinitiveCents, rec!.pendingCents],
  );
  assert.deepEqual([t.guides, t.paidCents, t.glossDefinitiveCents, t.glossOpenCents], [3, Math.round(value * 0.6), 2000, 3000]);
  assert.equal(t.billedCents, t.paidCents + t.glossDefinitiveCents + t.pendingCents, 'faturado = recebido + glosa definitiva + pendente');
  assert.deepEqual(await fx.asUser(A, (tx) => acct.listLedgerDriftInTx(tx, A.clinicId)), [], 'livro sem divergência');
  assert.equal(t.averageDaysToPay, 0, 'pago no dia do envio');
  assert.equal(t.glossRateBps, Math.round((2000 * 10_000) / t.billedCents));
  pass(`somas do relatório = conta da guia = recebível da operadora (faturado ${t.billedCents}, recebido ${t.paidCents}, glosa definitiva 2000, pendente ${t.pendingCents}); livro da clínica sem divergência`);

  // 2. Período e operadora.
  const before = await build(A, { from: '2020-01-01', to: '2020-12-31' });
  assert.deepEqual([before.lines.length, before.total.billedCents], [0, 0]);
  const other = await build(A, { from: sent, to: sent, insurerId: randomUUID() });
  assert.equal(other.lines.length, 0);
  const own = await build(A, { from: sent, to: sent, insurerId: A.insurerId });
  assert.equal(own.lines.length, 3);
  await assert.rejects(() => build(A, { from: '2025-01-01', to: '2026-11-18' }), /366 dias/u);
  pass('período pela data de envio (fora do intervalo não entra); operadora filtrada só traz a dela; período acima de 366 dias recusado');

  // 3. Isolamento por RLS e CSV sem dado pessoal.
  const crossClinic = await build(A, { from: sent, to: sent }, B);
  assert.equal(crossClinic.lines.length, 0, 'a sessão da B não lê a A nem pelo id');
  const crossInsurer = await build(B, { from: sent, to: sent, insurerId: A.insurerId });
  assert.equal(crossInsurer.lines.length, 0);
  const csv = report.reportCsv(r);
  const patients = await sql`select nome from public.patients where clinic_id = ${A.clinicId}::uuid`;
  for (const p of patients) assert.ok(!csv.includes(String(p.nome)), 'CSV sem nome de paciente');
  assert.ok(!/\d{16}/u.test(csv), 'CSV sem número de carteirinha');
  assert.equal(csv.slice(1).split('\r\n').filter(Boolean).length, 4, 'cabeçalho + 3 guias');
  pass('isolamento: a sessão da clínica B não lê a A (nem com o id da clínica ou da operadora da A); o CSV não leva paciente nem carteirinha');

  // 4. A exportação deixa trilha (mesma escrita do serviço público `exportInsurerReportCsv`).
  await fx.asUser(A, async (tx) => {
    const rr = await report.buildInsurerReportTx(tx, A.clinicId, { from: sent, to: sent });
    await logAudit(tx, {
      clinicId: A.clinicId, userId: A.doctorId, action: 'health_insurance.report.exported', resourceType: 'hi_insurer_report', resourceId: null,
      before: null, after: { ...rr.filter, rows: rr.lines.length, format: 'csv' }, requestContext: { requestId: 'harness', ip: null, userAgent: null } as never,
    });
  });
  const [audit] = await sql`select after from public.audit_events where clinic_id = ${A.clinicId}::uuid and action = 'health_insurance.report.exported'`;
  assert.deepEqual(audit!.after, { from: sent, to: sent, insurerId: null, rows: 3, format: 'csv' });
  pass('a exportação fica na trilha da clínica com o filtro e a quantidade de linhas, sem valores');

  console.log(`\n${passed}/4 provas do relatório por operadora (P9.10).`);
  assert.equal(passed, 4);
} finally {
  await cluster.stop();
}
