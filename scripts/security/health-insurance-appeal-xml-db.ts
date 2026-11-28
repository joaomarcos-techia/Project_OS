/**
 * Convênios P9.7 — XML oficial do recurso de glosa gerado do REGISTRO do recurso, em Postgres
 * DESCARTÁVEL com o código real: guia emitida → lote → XSD → enviado com protocolo → glosa do
 * demonstrativo → recurso com justificativa humana → XML (regras TISS, envelope, hash, XSD
 * oficial no motor do app, codificação) → arquivo cifrado + hi_files + auditoria → anexado na
 * apresentação → download auditado.
 *
 *   NODE_OPTIONS=--conditions=react-server npx tsx scripts/security/health-insurance-appeal-xml-db.ts
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { startScratchSchema } from './scratch-schema';

const cluster = await startScratchSchema({ port: 55517, maxConnections: 24 });
const { sql } = cluster;
if (!/@(?:127\.0\.0\.1|localhost):55517\//u.test(cluster.url)) throw new Error('não é o cluster local');
process.env.DATABASE_URL = cluster.url;
delete process.env.DATABASE_URL_RUNTIME;
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://ci.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_ci';
process.env.CRYPTO_SECRET_BACKEND = 'env';
process.env.CRYPTO_MASTER_KEY_V1 = Buffer.alloc(32, 7).toString('base64');
process.env.CRYPTO_LOOKUP_SALT = Buffer.alloc(32, 9).toString('base64');

const acct = await import('../../src/contexts/health-insurance/internal/insurance-account-service');
const appealXml = await import('../../src/contexts/health-insurance/internal/appeal-xml-service');
const fileAccess = await import('../../src/contexts/health-insurance/internal/tiss-file-access');
const { loadXmllintValidator } = await import('../../src/contexts/health-insurance/tiss/xml/xsd-validator');
const { loadHiFixtures, SYNTHETIC_CARD, GUIDE_VALUE_CENTS: VALUE } = await import('./hi-fixtures');

const xsd = loadXmllintValidator();
if (!xsd) throw new Error('validador XSD do app indisponível (TISS_XMLLINT_WASM_DIR fora do CI)');
const objects = new Map<string, Uint8Array>();
const store = {
  async put(ref: string, bytes: Uint8Array) { objects.set(ref, bytes); },
  async get(ref: string) { return objects.get(ref)!; },
  async remove(ref: string) { objects.delete(ref); },
};
const deps = { store, validateXsd: xsd };
const fx = await loadHiFixtures(sql, deps);
const key = (p: string) => `${p}-${randomUUID()}`;
let passed = 0;
const pass = (msg: string): void => {
  passed += 1;
  console.log(`PASS: ${msg}`);
};
const JUSTIFICATION = 'Procedimento realizado conforme a autorização prévia da operadora; segue o comprovante do atendimento na data informada.';

async function rejectsLayer(layer: string, op: () => Promise<unknown>, detail?: RegExp) {
  await assert.rejects(op, (e: unknown) => {
    assert.ok(e instanceof appealXml.AppealXmlError, String(e));
    assert.equal(e.layer, layer, `${e.message} ${e.details.join(' | ')}`);
    if (detail) assert.ok(e.details.some((d) => detail.test(d)), e.details.join(' | '));
    return true;
  });
}

try {
  await sql`GRANT SELECT ON public.clinics, public.profiles TO authenticated`;
  await fx.seedTerminology();
  // Tabela 38 (glosas) na mesma versão de terminologia da emissão.
  const [tv] = await sql`select id from public.tiss_terminology_versions where version = '202609'`;
  await sql`insert into public.tiss_terms (version_id, table_code, code, term, starts_on)
    values (${tv!.id}::uuid, '38', '1705', 'Procedimento não autorizado', '2010-01-01'),
           (${tv!.id}::uuid, '38', '1909', 'Cobrança de procedimento não executado', '2010-01-01')`;
  const A = await fx.setupClinic('A');
  const L = await fx.sentBatch(A, 3, { protocol: '202611120001' });
  const [g1, g2, g3] = L.guides as [string, string, string];
  const item = async (guideId: string) => (await sql`select id from public.hi_guide_items where guide_id = ${guideId}::uuid`)[0]!.id as string;
  const gloss = (guideId: string, itemId: string | null, code: string, cents: number) =>
    fx.asSystem(A, (tx) => acct.recordGlossInTx(tx, { clinicId: A.clinicId, batchId: L.batchId, guideId, itemId, code, amountCents: cents, source: 'statement', returnId: L.analysisReturn, idempotencyKey: key('gl') }));
  const appeal = (guideId: string, glossIds: string[], justification = JUSTIFICATION) =>
    fx.asUser(A, (tx) => acct.createAppealInTx(tx, { clinicId: A.clinicId, guideId, items: glossIds.map((glossId) => ({ glossId })), justification, idempotencyKey: key('rec') }));
  const exportIt = (appealId: string) => appealXml.exportAppealXml(deps, { clinicId: A.clinicId, appealId, actorUserId: A.doctorId });

  // ── 1. Recurso por item: XML do registro, válido no XSD, cifrado, auditado ──
  const gl1 = await gloss(g1, await item(g1), '1705', 5000);
  const ap1 = await appeal(g1, [gl1]);
  const out = await exportIt(ap1);
  assert.equal(out.kind, 'exported');
  const [file] = await sql`select * from public.hi_files where id = ${(out as { fileId: string }).fileId}::uuid`;
  assert.deepEqual([file!.kind, file!.appeal_id, file!.media_type, file!.tiss_version], ['gloss_appeal_xml', ap1, 'application/xml', '4.03.00']);
  const read = await fileAccess.readTissFile(store, { clinicId: A.clinicId, fileId: file!.id as string, userId: A.doctorId, purpose: 'download_arquivo', requestContext: { ip: null, userAgent: null, requestId: 'h' } });
  const xml = read!.bytes.toString('latin1');
  const expectIn = ['<ans:tipoTransacao>RECURSO_GLOSA</ans:tipoTransacao>', '<ans:numeroProtocolo>202611120001</ans:numeroProtocolo>', '<ans:codGlosaItem>1705</ans:codGlosaItem>', '<ans:valorRecursado>50.00</ans:valorRecursado>', `<ans:justificativaItem>${JUSTIFICATION}</ans:justificativaItem>`, '<ans:objetoRecurso>2</ans:objetoRecurso>', '<ans:codigoProcedimento>10101012</ans:codigoProcedimento>'];
  for (const s of expectIn) assert.ok(xml.includes(s), `faltou ${s}`);
  for (const pii of [SYNTHETIC_CARD, 'Paciente Sint']) assert.ok(!xml.includes(pii), `XML do recurso com dado do paciente: ${pii}`);
  const again = await xsd({ fileName: 'r.xml', bytes: read!.bytes });
  assert.equal(again.valid, true);
  const stored = Buffer.from(objects.get(file!.storage_ref as string)!).toString('latin1');
  assert.ok(!stored.includes('<?xml') && !stored.includes(JUSTIFICATION));
  const [audit] = await sql`select after from public.audit_events where action = 'health_insurance.appeal.xml_exported' and resource_id = ${ap1}`;
  assert.ok(audit && (audit.after as Record<string, unknown>).xsd === 'valid' && !JSON.stringify(audit.after).includes(JUSTIFICATION));
  mkdirSync(path.resolve('evidence/tiss-ciclo-infra-0153-2026-11-12'), { recursive: true });
  writeFileSync(path.resolve('evidence/tiss-ciclo-infra-0153-2026-11-12/recurso-glosa-sintetico.xml'), read!.bytes);
  pass('recurso por item: XML RECURSO_GLOSA gerado do registro (protocolo, lote, guia, item, código 1705, valor, justificativa da pessoa), válido no XSD oficial, sem dado do paciente, cifrado no armazenamento, SHA-256 conferido na leitura, auditoria sem o texto');

  // ── 2. Idempotente: gerar de novo não cria outro arquivo nem outro número ──
  const twice = await exportIt(ap1);
  assert.deepEqual([twice.kind, (twice as { fileId: string }).fileId], ['already_exported', file!.id]);
  assert.equal((await sql`select count(*)::int as n from public.hi_files where appeal_id = ${ap1}::uuid`)[0]!.n, 1);
  pass('reprocessamento: pedir o XML de novo devolve o mesmo arquivo (nenhum arquivo nem número novo)');

  // ── 3. Recurso da guia inteira (glosa sem item) ───────────────────────
  const gl2 = await gloss(g2, null, '1909', VALUE);
  const ap2 = await appeal(g2, [gl2]);
  const out2 = await exportIt(ap2);
  const xml2 = (await fileAccess.readTissFile(store, { clinicId: A.clinicId, fileId: (out2 as { fileId: string }).fileId, userId: A.doctorId, purpose: 'download_arquivo', requestContext: { ip: null, userAgent: null, requestId: 'h' } }))!.bytes.toString('latin1');
  assert.ok(xml2.includes('<ans:recursoGuiaCompleta>') && xml2.includes('<ans:codGlosaGuia>1909</ans:codGlosaGuia>'));
  pass('recurso da guia completa (glosa sem item): recursoGuiaCompleta com o código e a justificativa, válido no XSD');

  // ── 4. Inválidos: nada gravado, pendência clara, nada corrigido em silêncio ──
  const longText = `${JUSTIFICATION} `.repeat(5);
  const gl3 = await gloss(g3, await item(g3), '1705', 1000);
  const apLong = await appeal(g3, [gl3], longText);
  const L2 = await fx.sentBatch(A, 1);
  const glP = await fx.asSystem(A, (tx) => acct.recordGlossInTx(tx, { clinicId: A.clinicId, batchId: L2.batchId, guideId: L2.guides[0]!, code: '1705', amountCents: 100, source: 'statement', returnId: L2.analysisReturn, idempotencyKey: key('gl') }));
  const apP = await fx.asUser(A, (tx) => acct.createAppealInTx(tx, { clinicId: A.clinicId, guideId: L2.guides[0]!, items: [{ glossId: glP }], justification: JUSTIFICATION, idempotencyKey: key('rec') }));
  const L3 = await fx.sentBatch(A, 1, { protocol: '202611120002' });
  const glU = await fx.asSystem(A, (tx) => acct.recordGlossInTx(tx, { clinicId: A.clinicId, batchId: L3.batchId, guideId: L3.guides[0]!, code: '9999', amountCents: 100, source: 'statement', returnId: L3.analysisReturn, idempotencyKey: key('gl') }));
  const apU = await fx.asUser(A, (tx) => acct.createAppealInTx(tx, { clinicId: A.clinicId, guideId: L3.guides[0]!, items: [{ glossId: glU }], justification: JUSTIFICATION, idempotencyKey: key('rec') }));
  const before = objects.size;
  await rejectsLayer('internal', () => exportIt(apLong), /^JUSTIFICATION_INVALID/u);
  await rejectsLayer('internal', () => exportIt(apP), /^PROTOCOL_NOT_NUMERIC/u);
  await rejectsLayer('internal', () => exportIt(apU), /^GLOSS_CODE_UNKNOWN/u);
  assert.equal(objects.size, before);
  assert.equal((await sql`select count(*)::int as n from public.hi_files where appeal_id in (${apLong}::uuid, ${apP}::uuid, ${apU}::uuid)`)[0]!.n, 0);
  pass('inválidos recusados com a pendência do padrão e nada gravado: justificativa acima de 500 (nunca truncada), protocolo não numérico, código de glosa fora da tabela 38');

  // ── 5. Apresentação anexa o XML; recurso apresentado não gera outro XML ──
  const [f1] = await sql`select id from public.hi_files where appeal_id = ${ap1}::uuid`;
  await fx.asUser(A, (tx) => acct.fileAppealInTx(tx, { clinicId: A.clinicId, appealId: ap1, version: 1, channel: 'manual', filedOn: '2026-11-12', protocol: 'REC-77', fileId: f1!.id as string }));
  const [ap1row] = await sql`select status, file_id from public.hi_gloss_appeals where id = ${ap1}::uuid`;
  assert.deepEqual([ap1row!.status, ap1row!.file_id], ['filed', f1!.id]);
  const glNew = await fx.asSystem(A, (tx) => acct.recordGlossInTx(tx, { clinicId: A.clinicId, batchId: L3.batchId, guideId: L3.guides[0]!, code: '1705', amountCents: 100, source: 'statement', returnId: L3.analysisReturn, idempotencyKey: key('gl') }));
  const apNew = await fx.asUser(A, (tx) => acct.createAppealInTx(tx, { clinicId: A.clinicId, guideId: L3.guides[0]!, items: [{ glossId: glNew }], justification: JUSTIFICATION, idempotencyKey: key('rec') }));
  await fx.asUser(A, (tx) => acct.fileAppealInTx(tx, { clinicId: A.clinicId, appealId: apNew, version: 1, channel: 'manual', filedOn: '2026-11-12', protocol: 'REC-78' }));
  await rejectsLayer('state', () => exportIt(apNew));
  pass('a apresentação anexa o XML gerado ao recurso; recurso já apresentado não gera XML novo (o enviado é o que vale)');

  // ── 6. D24-a: com a assinatura cancelada, o XML do recurso anterior continua ──
  const L4 = await fx.sentBatch(A, 1, { protocol: '202611120003' });
  const glS = await fx.asSystem(A, (tx) => acct.recordGlossInTx(tx, { clinicId: A.clinicId, batchId: L4.batchId, guideId: L4.guides[0]!, code: '1705', amountCents: 500, source: 'statement', returnId: L4.analysisReturn, idempotencyKey: key('gl') }));
  const apS = await fx.asUser(A, (tx) => acct.createAppealInTx(tx, { clinicId: A.clinicId, guideId: L4.guides[0]!, items: [{ glossId: glS }], justification: JUSTIFICATION, idempotencyKey: key('rec') }));
  await sql`update public.subscriptions set billing_status = 'cancelled' where clinic_id = ${A.clinicId}::uuid`;
  const outS = await exportIt(apS);
  await sql`update public.subscriptions set billing_status = 'active' where clinic_id = ${A.clinicId}::uuid`;
  assert.equal(outS.kind, 'exported');
  pass('D24-a: com a assinatura cancelada, o XML do recurso de glosa anterior é gerado (preservação de obrigação já faturada)');

  console.log(`\n${passed}/6 provas do XML do recurso de glosa (P9.7) passaram.`);
  assert.equal(passed, 6);
} finally {
  await cluster.stop();
}
