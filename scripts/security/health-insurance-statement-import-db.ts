/**
 * Convênios P9.5 — importação de demonstrativos da operadora (análise de conta e pagamento)
 * em Postgres DESCARTÁVEL com o código real: lote enviado com protocolo → demonstrativo XML
 * sintético (válido no XSD oficial) → conferência de estrutura, hash, XSD, operadora, clínica,
 * lote, protocolo, guia e item → glosas e pagamentos pelas funções da conta (0152) → livro
 * financeiro pela ponte (0153).
 *
 * Cenários exigidos (12/11, seção 10): válido, versão incorreta, operadora errada, guia
 * inexistente, lote inexistente, pagamento parcial, glosa, arquivo duplicado, arquivo alterado,
 * falha de processamento, concorrência e reprocessamento. Mais: XML hostil, prestador errado,
 * descontos da operadora e "liberado não é pago".
 *
 *   NODE_OPTIONS=--conditions=react-server npx tsx scripts/security/health-insurance-statement-import-db.ts
 */
import assert from 'node:assert/strict';

import { startScratchSchema } from './scratch-schema';

const cluster = await startScratchSchema({ port: 55518, maxConnections: 24 });
const { sql } = cluster;
if (!/@(?:127\.0\.0\.1|localhost):55518\//u.test(cluster.url)) throw new Error('não é o cluster local');
process.env.DATABASE_URL = cluster.url;
delete process.env.DATABASE_URL_RUNTIME;
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://ci.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_ci';
process.env.CRYPTO_SECRET_BACKEND = 'env';
process.env.CRYPTO_MASTER_KEY_V1 = Buffer.alloc(32, 7).toString('base64');
process.env.CRYPTO_LOOKUP_SALT = Buffer.alloc(32, 9).toString('base64');

const imp = await import('../../src/contexts/health-insurance/internal/statement-import-service');
const fx0 = await import('../../src/contexts/health-insurance/tiss/corpus/statement-fixtures');
const { loadXmllintValidator } = await import('../../src/contexts/health-insurance/tiss/xml/xsd-validator');
const { loadHiFixtures, GUIDE_VALUE_CENTS: VALUE } = await import('./hi-fixtures');

const xsd = loadXmllintValidator();
if (!xsd) throw new Error('validador XSD do app indisponível (TISS_XMLLINT_WASM_DIR fora do CI)');
const objects = new Map<string, Uint8Array>();
let failPut = false;
const store = {
  async put(ref: string, bytes: Uint8Array) {
    if (failPut) throw new Error('falha injetada no armazenamento');
    objects.set(ref, bytes);
  },
  async get(ref: string) { return objects.get(ref)!; },
  async remove(ref: string) { objects.delete(ref); },
};
const deps = { store, validateXsd: xsd };
const fx = await loadHiFixtures(sql, deps);
let passed = 0;
const pass = (msg: string): void => {
  passed += 1;
  console.log(`PASS: ${msg}`);
};
const PRESTADOR = { kind: 'codigoPrestadorNaOperadora' as const, value: 'TESTE001' };

async function rejectsCode(code: string, op: () => Promise<unknown>) {
  await assert.rejects(op, (e: unknown) => {
    assert.ok(e instanceof imp.StatementImportError, String(e));
    assert.equal(e.code, code, e.message);
    return true;
  });
}

try {
  await sql`GRANT SELECT ON public.clinics, public.profiles TO authenticated`;
  await fx.seedTerminology();
  const [tv] = await sql`select id from public.tiss_terminology_versions where version = '202609'`;
  await sql`insert into public.tiss_terms (version_id, table_code, code, term, starts_on)
    values (${tv!.id}::uuid, '38', '1705', 'Procedimento não autorizado', '2010-01-01'), (${tv!.id}::uuid, '38', '1909', 'Não executado', '2010-01-01')`;
  const A = await fx.setupClinic('A');
  const L = await fx.sentBatch(A, 3, { protocol: '202611120001' });
  const [g1, g2, g3] = L.guides as [string, string, string];
  const [batch] = await sql`select number from public.hi_batches where id = ${L.batchId}::uuid`;
  const numbers = new Map<string, string>();
  for (const g of L.guides) numbers.set(g, String((await sql`select number from public.hi_guides where id = ${g}::uuid`)[0]!.number));
  const lote = String(batch!.number);
  const run = (bytes: Buffer, insurerId = A.insurerId) =>
    imp.importOperatorStatement(deps, { clinicId: A.clinicId, insurerId, bytes, actorUserId: A.doctorId, receivedOn: '2026-11-12' });
  const analysis = (over: Partial<Parameters<typeof fx0.analysisStatementXml>[0]> = {}) =>
    fx0.analysisStatementXml({
      registroANS: '123456', prestador: PRESTADOR, numeroDemonstrativo: 'DA-001', dataEmissao: '2026-11-20',
      protocolos: [{ numeroLote: lote, numeroProtocolo: '202611120001', dataProtocolo: '2026-11-11', guias: [
        { numeroGuiaPrestador: numbers.get(g1)!, itens: [{ sequencial: 1, codigoProcedimento: '10101012', valorInformado: VALUE, valorLiberado: VALUE - 5000, glosas: [{ codigo: '1705', valor: 5000 }] }] },
        { numeroGuiaPrestador: numbers.get(g2)!, itens: [{ sequencial: 1, codigoProcedimento: '10101012', valorInformado: VALUE, valorLiberado: 0, glosas: [] }], glosaGuia: { codigo: '1909', valor: VALUE } },
        { numeroGuiaPrestador: numbers.get(g3)!, itens: [{ sequencial: 1, codigoProcedimento: '10101012', valorInformado: VALUE, valorLiberado: VALUE, glosas: [] }] },
      ] }],
      ...over,
    });
  const glossesOf = async (g: string) => (await sql`select gloss_code, amount_cents, guide_item_id is not null as item, source, return_id from public.hi_glosses where guide_id = ${g}::uuid order by created_at`);
  const paymentsCount = async () => (await sql`select count(*)::int as n from public.hi_payments where clinic_id = ${A.clinicId}::uuid`)[0]!.n as number;

  // ── 1. Demonstrativo de análise válido: glosas por item e da guia inteira; liberado ≠ pago ──
  const r1 = await run(analysis());
  assert.deepEqual([r1.kind, r1.batches.length, r1.batches[0]!.glosses, r1.divergences, r1.alreadyImported], ['analysis', 1, 2, [], false]);
  const gl1 = await glossesOf(g1);
  const gl2 = await glossesOf(g2);
  assert.deepEqual([gl1.map((g) => [g.gloss_code, Number(g.amount_cents), g.item, g.source]), gl2.map((g) => [g.gloss_code, Number(g.amount_cents), g.item])], [[['1705', 5000, true, 'statement']], [['1909', VALUE, false]]]);
  assert.equal(gl1[0]!.return_id, r1.batches[0]!.returnId);
  assert.equal(await paymentsCount(), 0);
  const [ret] = await sql`select kind, file_id from public.hi_batch_returns where id = ${r1.batches[0]!.returnId}::uuid`;
  const [file] = await sql`select kind, batch_id from public.hi_files where id = ${ret!.file_id}::uuid`;
  assert.deepEqual([ret!.kind, file!.kind, file!.batch_id], ['analysis_statement', 'batch_return', L.batchId]);
  pass('análise de conta válida: glosa por item (1705, R$ 50) e da guia inteira (1909), ligadas ao retorno com o arquivo cifrado do lote; nenhum pagamento criado (liberado não é pago)');

  // ── 2. Arquivo duplicado e reprocessamento: nada novo ─────────────────
  const r2 = await run(analysis());
  assert.equal(r2.alreadyImported, true);
  assert.deepEqual([(await glossesOf(g1)).length, (await glossesOf(g2)).length], [1, 1]);
  assert.equal((await sql`select count(*)::int as n from public.hi_files where batch_id = ${L.batchId}::uuid and kind = 'batch_return'`)[0]!.n, 1);
  pass('arquivo duplicado / reprocessamento: o mesmo demonstrativo de novo não cria glosa, retorno nem arquivo (idempotente por SHA-256 e pelo número do demonstrativo)');

  // ── 3. Arquivo alterado: sem refazer o hash = recusado; com hash refeito e valor diferente = divergência ──
  const tampered = Buffer.from(analysis().toString('latin1').replace('<ans:valorGlosa>50.00</ans:valorGlosa>', '<ans:valorGlosa>60.00</ans:valorGlosa>'), 'latin1');
  await rejectsCode('HASH', () => run(tampered));
  const altered = analysis({ protocolos: [{ numeroLote: lote, numeroProtocolo: '202611120001', dataProtocolo: '2026-11-11', guias: [
    { numeroGuiaPrestador: numbers.get(g1)!, itens: [{ sequencial: 1, codigoProcedimento: '10101012', valorInformado: VALUE, valorLiberado: VALUE - 6000, glosas: [{ codigo: '1705', valor: 6000 }] }] },
  ] }] });
  const r3 = await run(altered);
  assert.deepEqual([r3.divergences.map((d) => d.code), (await glossesOf(g1)).map((g) => Number(g.amount_cents))], [['GLOSS_REJECTED'], [5000]]);
  pass('arquivo alterado: conteúdo mexido sem o hash da operadora é recusado; arquivo "corrigido" com o mesmo número de demonstrativo e outro valor vira DIVERGÊNCIA, sem duplicar nem trocar a glosa');

  // ── 4. Versão, operadora, prestador e XML hostil recusados antes de qualquer efeito ──
  const before = await sql`select count(*)::int as n from public.hi_glosses`;
  await rejectsCode('ENVELOPE', () => run(Buffer.from(analysis().toString('latin1').replace('<ans:Padrao>4.03.00</ans:Padrao>', '<ans:Padrao>4.01.00</ans:Padrao>'), 'latin1')));
  await rejectsCode('OPERATOR_MISMATCH', () => run(analysis({ registroANS: '654321' })));
  await rejectsCode('PROVIDER_MISMATCH', () => run(analysis({ prestador: { kind: 'codigoPrestadorNaOperadora', value: 'OUTRO999' } })));
  const hostile = Buffer.from(analysis().toString('latin1').replace(/^(<\?xml[^>]*\?>)/u, '$1<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]>'), 'latin1');
  await rejectsCode('ENVELOPE', () => run(hostile));
  assert.deepEqual(await sql`select count(*)::int as n from public.hi_glosses`, before);
  pass('versão 4.01.00, operadora errada, prestador de outra clínica e XML hostil (DOCTYPE/XXE): recusados antes de qualquer efeito; nenhuma glosa criada');

  // ── 5. Lote e guia inexistentes: divergência preservada, o resto aplicado ──
  const L2 = await fx.sentBatch(A, 1, { protocol: '202611120002' });
  const [b2] = await sql`select number from public.hi_batches where id = ${L2.batchId}::uuid`;
  const n2 = String((await sql`select number from public.hi_guides where id = ${L2.guides[0]!}::uuid`)[0]!.number);
  const r5 = await run(fx0.analysisStatementXml({
    registroANS: '123456', prestador: PRESTADOR, numeroDemonstrativo: 'DA-002', dataEmissao: '2026-11-21',
    protocolos: [
      { numeroLote: '99999', numeroProtocolo: '202611129999', dataProtocolo: '2026-11-11', guias: [{ numeroGuiaPrestador: '1', itens: [] }] },
      { numeroLote: String(b2!.number), numeroProtocolo: '202611120002', dataProtocolo: '2026-11-11', guias: [
        { numeroGuiaPrestador: '88888888', itens: [{ sequencial: 1, codigoProcedimento: '10101012', valorInformado: VALUE, valorLiberado: 0, glosas: [{ codigo: '1705', valor: 100 }] }] },
        { numeroGuiaPrestador: n2, itens: [{ sequencial: 1, codigoProcedimento: '10101012', valorInformado: VALUE, valorLiberado: VALUE - 1000, glosas: [{ codigo: '1705', valor: 1000 }] }] },
      ] },
    ],
  }));
  assert.deepEqual(r5.divergences.map((d) => d.code).sort(), ['BATCH_UNKNOWN', 'GUIDE_UNKNOWN']);
  assert.equal((await glossesOf(L2.guides[0]!)).length, 1);
  pass('lote inexistente e guia fora do lote: viram divergências preservadas no resultado e na auditoria; a glosa da guia que confere é aplicada');

  // ── 6. Demonstrativo de pagamento: parcial, por guia, no livro; descontos para conferência ──
  const pay = fx0.paymentStatementXml({
    registroANS: '123456', prestador: PRESTADOR, numeroDemonstrativo: 'DP-001', dataEmissao: '2026-11-12', dataPagamento: '2026-11-11',
    protocolos: [{ numeroLote: lote, numeroProtocolo: '202611120001', dataProtocolo: '2026-11-11', guias: [
      { numeroGuiaPrestador: numbers.get(g1)!, valorLiberado: VALUE - 5000, valorGlosa: 5000 },
      { numeroGuiaPrestador: numbers.get(g3)!, valorLiberado: 7000, valorGlosa: 0 },
    ] }],
    debitos: [300],
  });
  const r6 = await run(pay);
  assert.deepEqual([r6.kind, r6.batches[0]!.payments, r6.divergences.map((d) => d.code)], ['payment', 1, ['OPERATOR_DEDUCTIONS']]);
  const acc = await sql`select guide_id, paid_cents, status from public.hi_guide_accounts where guide_id in (${g1}::uuid, ${g3}::uuid) order by guide_id`;
  const byGuide = new Map(acc.map((a) => [String(a.guide_id), a]));
  assert.deepEqual([Number(byGuide.get(g1)!.paid_cents), Number(byGuide.get(g3)!.paid_cents), byGuide.get(g3)!.status], [VALUE - 5000, 7000, 'partially_paid']);
  const [lanc3] = await sql`select valor_pago, status from public.lancamentos where source_hi_guide_id = ${g3}::uuid`;
  assert.deepEqual([lanc3!.valor_pago, lanc3!.status], ['70.00', 'parcial']);
  const [p] = await sql`select source, statement_ref, return_id is not null as has_return from public.hi_payments where clinic_id = ${A.clinicId}::uuid`;
  assert.deepEqual([p!.source, p!.statement_ref, p!.has_return], ['statement', `DP-001/${lote}`, true]);
  pass('demonstrativo de pagamento: liberado por guia alocado (pagamento PARCIAL da guia 3 não quita), recebível do livro atualizado pela ponte; retenção da operadora não é lançada, vira divergência para conferência');

  // ── 7. Pagamento duplicado e concorrência ─────────────────────────────
  const [again, concurrent] = await Promise.all([run(pay), run(pay)]);
  assert.ok(again.alreadyImported && concurrent.alreadyImported);
  assert.equal(await paymentsCount(), 1);
  assert.equal((await sql`select count(*)::int as n from public.payment_transactions pt join public.lancamentos l on l.id = pt.lancamento_id where l.clinic_id = ${A.clinicId}::uuid`)[0]!.n, 2);
  pass('concorrência e duplicidade: duas importações simultâneas do mesmo pagamento aplicam UMA vez (1 pagamento, 2 movimentos no livro — um por guia); o Caixa não dobra');

  // ── 8. Falha de processamento: armazenamento fora → nada aplicado ─────
  const L3 = await fx.sentBatch(A, 1, { protocol: '202611120003' });
  const [b3] = await sql`select number from public.hi_batches where id = ${L3.batchId}::uuid`;
  const n3 = String((await sql`select number from public.hi_guides where id = ${L3.guides[0]!}::uuid`)[0]!.number);
  const doc = fx0.analysisStatementXml({
    registroANS: '123456', prestador: PRESTADOR, numeroDemonstrativo: 'DA-003', dataEmissao: '2026-11-22',
    protocolos: [{ numeroLote: String(b3!.number), numeroProtocolo: '202611120003', dataProtocolo: '2026-11-11', guias: [
      { numeroGuiaPrestador: n3, itens: [{ sequencial: 1, codigoProcedimento: '10101012', valorInformado: VALUE, valorLiberado: VALUE - 2000, glosas: [{ codigo: '1705', valor: 2000 }] }] },
    ] }],
  });
  const returnsBefore = (await sql`select count(*)::int as n from public.hi_batch_returns where batch_id = ${L3.batchId}::uuid`)[0]!.n;
  failPut = true;
  await assert.rejects(() => run(doc));
  failPut = false;
  assert.equal((await glossesOf(L3.guides[0]!)).length, 0);
  assert.equal((await sql`select count(*)::int as n from public.hi_batch_returns where batch_id = ${L3.batchId}::uuid`)[0]!.n, returnsBefore);
  const r8 = await run(doc);
  assert.equal(r8.batches[0]!.glosses, 1);
  pass('falha de processamento (armazenamento fora): nada aplicado (sem glosa, sem retorno); repetindo depois, aplica uma vez');

  // ── 9. Auditoria sem dado pessoal; divergência nunca some ──────────────
  const audits = await sql`select after from public.audit_events where action = 'health_insurance.statement.imported'`;
  assert.ok(audits.length >= 6);
  assert.ok(audits.every((a) => !JSON.stringify(a.after).includes('Beneficiário') && !JSON.stringify(a.after).includes('00000000000000000')));
  assert.ok(audits.some((a) => (a.after as { divergences: string[] }).divergences.includes('GLOSS_REJECTED')));
  assert.equal((await sql`select count(*)::int as n from public.hi_ledger_drift`)[0]!.n, 0);
  pass('auditoria de cada importação (tipo, SHA-256, lotes, glosas, pagamentos, códigos de divergência) sem carteirinha nem beneficiário; livro e conta conferem');

  console.log(`\n${passed}/9 provas da importação de demonstrativos (P9.5) passaram.`);
  assert.equal(passed, 9);
} finally {
  await cluster.stop();
}
