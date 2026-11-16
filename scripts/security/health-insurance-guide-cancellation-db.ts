/**
 * Convênios P7.5 (0165): cancelamento da guia na operadora e substituição só com recibo, em
 * Postgres DESCARTÁVEL (cadeia do DEV), dados sintéticos e XSD oficial 4.03.00. Nunca no DEV
 * compartilhado. Recibos aqui são SINTÉTICOS: homologação INTERNA, não da operadora.
 *
 *   1. pedido só de guia exportada/enviada/em análise (aprovada não; mensagem do estado);
 *   2. pedido com o XML `cancelaGuia` validado no XSD oficial, SHA-256 guardado; mesma chave devolve
 *      o mesmo pedido; segundo pedido ativo para a guia é recusado; autor = pessoa da sessão;
 *   3. substituta em rascunho; aprovação recusada SEM recibo e com recibo 4 (em processamento);
 *   4. recibos 2 (não cancelado) e 3/5/6 (divergência): aprovação recusada com a mensagem de cada um;
 *      resposta final não aceita outro recibo; recibo e pedido imutáveis;
 *   5. evidência obrigatória; data do recibo entre o pedido e hoje;
 *   6. recibo 1 → aprovação da substituta passa: original "substituída" (não apagada, histórico
 *      preservado), substituta viva; recebível da original cancelado pela ponte (0153), nenhum novo;
 *   7. classe C × A com o módulo desligado: pedido e recibo passam; criar e aprovar substituta não;
 *   8. concorrência: dois recibos finais ao mesmo tempo → um vale, o outro lê "resposta final";
 *   9. isolamento: outra clínica não vê o pedido nem registra recibo nele.
 *
 *   SECURITY_PG_BIN=... PORT=55554 NODE_OPTIONS=--conditions=react-server \
 *     npx tsx scripts/security/health-insurance-guide-cancellation-db.ts
 */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';

import { readDevOrderChain } from './dev-order-chain';
import { startScratchSchema } from './scratch-schema';

const PORT = Number(process.env.PORT ?? 55554);
const chain = await readDevOrderChain();
assert.ok(chain.some((m) => m.file.startsWith('0165_')), 'a cadeia traz a 0165');
const cluster = await startScratchSchema({ port: PORT, maxConnections: 10, migrations: chain });
const { sql } = cluster;
if (!new RegExp(`@(?:127\\.0\\.0\\.1|localhost):${PORT}/`, 'u').test(cluster.url)) throw new Error('não é o cluster local');
process.env.DATABASE_URL = cluster.url;
delete process.env.DATABASE_URL_RUNTIME;
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://ci.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_ci';
process.env.CRYPTO_SECRET_BACKEND = 'env';
process.env.CRYPTO_MASTER_KEY_V1 = Buffer.alloc(32, 7).toString('base64');
process.env.CRYPTO_LOOKUP_SALT = Buffer.alloc(32, 9).toString('base64');

const svc = await import('../../src/contexts/health-insurance/internal/guide-cancellation-service');
const { issueConsultaGuide } = await import('../../src/contexts/health-insurance/internal/guide-issuance');
const { loadXmllintValidator } = await import('../../src/contexts/health-insurance/tiss/xml/xsd-validator');
const { loadHiFixtures, SYNTHETIC_CARD } = await import('./hi-fixtures');

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
const pass = (m: string) => {
  passed += 1;
  console.log(`PASS ${passed}: ${m}`);
};
const key = (p: string) => `${p}-${randomUUID()}`;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
type E = { name?: string; code?: string; message?: string; cause?: { code?: string; constraint_name?: string; message?: string } };
const errText = (e: E) => `${e.message ?? ''} ${e.cause?.message ?? ''}`;
async function rejects(fn: () => Promise<unknown>, re: RegExp, code?: string) {
  await assert.rejects(fn, (e: E) => re.test(errText(e)) && (code === undefined || e.code === code || e.cause?.code === code));
}

const request = (c: Clinic, guideId: string, k = key('can'), generateXml = true) =>
  fx.asUser(c, (tx) => svc.requestGuideCancellationTx(tx, { validateXsd: xsd }, {
    clinicId: c.clinicId, guideId, purpose: 'substitution', channel: 'portal', requestedOn: '2026-11-12',
    reason: 'Guia enviada com o tipo de consulta errado; reenvio corrigido', idempotencyKey: k, generateXml,
  }));
const receipt = (c: Clinic, cancellationId: string, statusCode: '1' | '2' | '3' | '4' | '5' | '6', over: Partial<{ receivedOn: string; operatorProtocol: string | null; evidenceSha256: string | null }> = {}) =>
  fx.asUser(c, (tx) => svc.recordGuideCancellationReceiptTx(tx, {
    clinicId: c.clinicId, cancellationId, statusCode, receivedOn: over.receivedOn ?? '2026-11-13',
    operatorProtocol: over.operatorProtocol === undefined ? `9${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}` : over.operatorProtocol,
    evidenceSha256: over.evidenceSha256 ?? null, operatorMessage: 'Recibo SINTÉTICO (homologação interna)', idempotencyKey: key('rec'),
  }));
const substitute = (c: Clinic, originalGuideId: string, k = key('sub')) =>
  fx.asUser(c, (tx) => svc.createSubstituteGuideTx(tx, { clinicId: c.clinicId, originalGuideId, idempotencyKey: k, actorUserId: c.doctorId }));
async function approve(c: Clinic, guideId: string) {
  const [g] = (await sql`select membership_id::text m from public.hi_guides where id = ${guideId}::uuid`) as unknown as Array<{ m: string }>;
  // Conferida uma vez (de novo é nada a fazer): só a partir de "para conferir".
  await fx.asUser(c, (tx) => tx.execute(fx.sqlTag`update public.hi_guides set status = 'reviewed', reviewed_by = ${c.doctorId}::uuid where id = ${guideId}::uuid and status = 'ready_for_review'`));
  return fx.asUser(c, (tx) => issueConsultaGuide(tx, {
    clinicId: c.clinicId, guideId,
    card: { membershipId: g!.m, cardNumber: SYNTHETIC_CARD, auditEventId: 'leitura-auditada-simulada' },
    newborn: false, professionalName: 'Dra. Sintética', actorUserId: c.doctorId, today: '2026-12-31',
  }));
}
const statusOf = async (id: string) => String((await sql`select status from public.hi_guide_cancellations where id = ${id}::uuid`)[0]!.status);
const guide = async (id: string) => {
  const [g] = await sql`select status, live from public.hi_guides where id = ${id}::uuid`;
  return { status: String(g!.status), live: g!.live === true };
};

try {
  await sql`GRANT SELECT ON public.clinics, public.profiles TO authenticated`;
  await fx.seedTerminology();
  const A = await fx.setupClinic('Substituição A');
  const B = await fx.setupClinic('Substituição B');

  // 1. Estado: guia aprovada (antes do envio) não recebe pedido de cancelamento à operadora.
  const approved = await A.approvedGuide();
  await rejects(() => request(A, approved), /só para guia exportada, enviada ou em análise/u);
  assert.equal(Number((await sql`select count(*)::int n from public.hi_guide_cancellations`)[0]!.n), 0);
  pass('pedido só de guia exportada, enviada ou em análise: a aprovada é recusada com a orientação (reabrir/cancelar antes; recurso depois)');

  // 2. Pedido com XML validado no XSD; idempotência; um ativo por guia; autor da sessão.
  const L = await fx.sentBatch(A, 3);
  const [g1, g2, g3] = L.guides as [string, string, string];
  const k1 = key('can');
  const r1 = await request(A, g1, k1);
  assert.ok(r1.xmlSha256 && /^[0-9a-f]{64}$/u.test(r1.xmlSha256));
  const [row1] = await sql`select request_xml, request_xml_sha256, created_by::text, guide_number, batch_protocol, status from public.hi_guide_cancellations where id = ${r1.cancellationId}::uuid`;
  const xmlBytes = Buffer.from(String(row1!.request_xml), 'latin1');
  assert.equal(createHash('sha256').update(xmlBytes).digest('hex'), r1.xmlSha256);
  const recheck = await xsd({ fileName: 'cancela-guia.xml', bytes: xmlBytes });
  assert.equal(recheck.valid, true, `XSD: ${JSON.stringify(recheck.errors)}`);
  assert.match(String(row1!.request_xml), /<ans:tipoTransacao>CANCELA_GUIA<\/ans:tipoTransacao>/u);
  assert.match(String(row1!.request_xml), /<ans:cancelaGuia>/u);
  assert.deepEqual([row1!.created_by, row1!.status], [A.doctorId, 'awaiting_receipt']);
  assert.ok(row1!.batch_protocol, 'protocolo do lote copiado');
  const again = await request(A, g1, k1);
  assert.deepEqual([again.cancellationId, again.existing], [r1.cancellationId, true]);
  await rejects(() => request(A, g1), /pedido de cancelamento ativo/u);
  pass('pedido com o cancelaGuia gerado pelo app e válido no XSD oficial 4.03.00 (SHA-256 conferido); a mesma chave devolve o mesmo pedido; segundo pedido ativo recusado; autor = pessoa da sessão');

  // 3. Substituta em rascunho; aprovação recusada sem recibo e com "em processamento".
  const s1 = await substitute(A, g1);
  assert.deepEqual(await guide(s1.guideId), { status: 'ready_for_review', live: false });
  const s2 = await substitute(A, g2);
  await rejects(() => approve(A, s2.guideId), /registre o pedido de cancelamento e o recibo/u);
  await rejects(() => approve(A, s1.guideId), /ainda não foi confirmado/u);
  await receipt(A, r1.cancellationId, '4');
  assert.equal(await statusOf(r1.cancellationId), 'awaiting_receipt');
  await rejects(() => approve(A, s1.guideId), /ainda não foi confirmado/u);
  assert.deepEqual(await guide(g1), { status: 'under_review', live: true }, 'a original segue viva');
  pass('substituta em rascunho (não segura o atendimento); aprovação recusada sem pedido, sem recibo e com o recibo 4 (em processamento); a original continua em análise e viva');

  // 4. Recibos 2 e 3: recusa e divergência; resposta final fecha o pedido; imutabilidade.
  const r2 = await request(A, g2);
  await receipt(A, r2.cancellationId, '2');
  assert.equal(await statusOf(r2.cancellationId), 'refused');
  await rejects(() => approve(A, s2.guideId), /não cancelou a guia original/u);
  await rejects(() => receipt(A, r2.cancellationId, '1'), /resposta final/u);
  const r3 = await request(A, g3);
  const s3 = await substitute(A, g3);
  await receipt(A, r3.cancellationId, '3');
  assert.equal(await statusOf(r3.cancellationId), 'divergent');
  await rejects(() => approve(A, s3.guideId), /Divergência com a operadora/u);
  await rejects(() => sql`update public.hi_guide_cancellation_receipts set status_code = '1' where cancellation_id = ${r3.cancellationId}::uuid`, /só de inclusão/u);
  await rejects(() => sql`update public.hi_guide_cancellations set status = 'confirmed', status_code = '1', version = version + 1 where id = ${r3.cancellationId}::uuid`, /resposta final/u);
  pass('recibo 2 → recusado e 3 → divergência: a aprovação da substituta é recusada com a mensagem de cada um; resposta final não aceita outro recibo; recibo e pedido não se reescrevem');

  // 5. Evidência e datas.
  const L2 = await fx.sentBatch(A, 2);
  const [g4, g5] = L2.guides as [string, string];
  const r4 = await request(A, g4);
  await rejects(() => receipt(A, r4.cancellationId, '1', { operatorProtocol: null, evidenceSha256: null }), /sem evidência/u);
  await rejects(() => receipt(A, r4.cancellationId, '1', { receivedOn: '2026-11-01' }), /entre a data do pedido e hoje/u);
  await rejects(() => receipt(A, r4.cancellationId, '1', { receivedOn: '2099-01-01' }), /entre a data do pedido e hoje/u);
  assert.equal(await statusOf(r4.cancellationId), 'awaiting_receipt');
  pass('recibo sem protocolo nem comprovante é recusado (não há recibo sem evidência); data antes do pedido ou no futuro, recusada; o pedido segue aguardando');

  // 6. Recibo 1 → substituição efetivada, original preservada, recebível da original cancelado.
  const recvBefore = await sql`select status from public.lancamentos where source_hi_guide_id = ${g1}::uuid`;
  assert.equal(recvBefore.length, 1, 'o envio do lote criou o recebível da original (0153)');
  await receipt(A, r1.cancellationId, '1', { evidenceSha256: sha('comprovante-sintetico-1') });
  assert.equal(await statusOf(r1.cancellationId), 'confirmed');
  await approve(A, s1.guideId);
  assert.deepEqual(await guide(g1), { status: 'replaced', live: false });
  assert.deepEqual(await guide(s1.guideId), { status: 'approved', live: true });
  assert.equal(String((await sql`select status from public.lancamentos where source_hi_guide_id = ${g1}::uuid`)[0]!.status), 'cancelado');
  assert.equal((await sql`select 1 from public.lancamentos where source_hi_guide_id = ${s1.guideId}::uuid`).length, 0, 'a substituta não ganha recebível antes do envio');
  const events = await sql`select to_status from public.hi_guide_events where guide_id = ${g1}::uuid order by created_at`;
  assert.ok(events.some((e) => e.to_status === 'replaced'), 'o histórico da original registra a substituição');
  const receipts = await sql`select status_code from public.hi_guide_cancellation_receipts where cancellation_id = ${r1.cancellationId}::uuid order by created_at`;
  assert.deepEqual(receipts.map((r) => r.status_code), ['4', '1'], 'os recibos ficam no histórico');
  pass('recibo 1 (cancelado com sucesso) → a substituta é aprovada e a original vira "substituída" no mesmo ato, sem ser apagada; histórico e recibos preservados; recebível da original cancelado pela ponte (0153); nenhum recebível novo');

  // 7. Módulo desligado: pedido e recibo passam (classe C); criar e aprovar substituta não (classe A).
  await sql`update public.hi_clinic_settings set enabled = false where clinic_id = ${A.clinicId}::uuid`;
  const r5 = await request(A, g5);
  await receipt(A, r5.cancellationId, '1');
  assert.equal(await statusOf(r5.cancellationId), 'confirmed');
  await rejects(() => substitute(A, g5), /desligado/u);
  await rejects(() => approve(A, s3.guideId), /desligado|Divergência/u);
  await sql`update public.hi_clinic_settings set enabled = true where clinic_id = ${A.clinicId}::uuid`;
  pass('com o módulo desligado: pedir o cancelamento e registrar o recibo continuam (preservação); criar a substituta é recusado pelo banco (classe A)');

  // 8. Concorrência: dois recibos finais ao mesmo tempo → um vale.
  const r4b = r4.cancellationId;
  const both = await Promise.allSettled([receipt(A, r4b, '1'), receipt(A, r4b, '2')]);
  assert.equal(both.filter((x) => x.status === 'fulfilled').length, 1);
  const lost = both.find((x) => x.status === 'rejected') as PromiseRejectedResult;
  assert.match(errText(lost.reason as E), /resposta final/u);
  assert.equal(Number((await sql`select count(*)::int n from public.hi_guide_cancellation_receipts where cancellation_id = ${r4b}::uuid`)[0]!.n), 1);
  pass('dois recibos finais ao mesmo tempo: o pedido travado aceita um; o outro lê "resposta final" e nada é gravado');

  // 9. Isolamento.
  const seenByB = await fx.asUser(B, (tx) => svc.listGuideCancellationsTx(tx, B.clinicId, g1));
  assert.deepEqual(seenByB, []);
  await rejects(() => fx.asUser(B, (tx) => svc.recordGuideCancellationReceiptTx(tx, {
    clinicId: B.clinicId, cancellationId: r4b, statusCode: '1', receivedOn: '2026-11-13', operatorProtocol: '123', idempotencyKey: key('x'),
  })), /não encontrado|inexistente/u);
  assert.equal(await fx.asUser(B, (tx) => svc.readCancellationXmlTx(tx, B.clinicId, r1.cancellationId)), null);
  pass('isolamento: a clínica B não vê os pedidos, não lê o XML e não registra recibo no pedido da A');

  console.log(`\n${passed}/9 provas do cancelamento na operadora e da substituição (P7.5, 0165).`);
  assert.equal(passed, 9);
} finally {
  await cluster.stop();
}
