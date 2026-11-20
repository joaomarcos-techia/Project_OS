/**
 * P9.4 — envio do lote pelo conector homologado, em Postgres DESCARTÁVEL com as migrations reais e
 * a operadora STUB (valida o envelope no XSD oficial do webservice, confere hash, login e destino).
 * Sem operadora real: o teto é "Testado". Sintético: nenhuma credencial ou dado real.
 *
 *   SECURITY_PG_BIN=... PORT=55566 NODE_OPTIONS="--import ./scripts/security/server-only-hook.mjs" \
 *     npx tsx --tsconfig tsconfig.scripts.json scripts/security/health-insurance-batch-connector-db.ts
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { startScratchSchema } from './scratch-schema';

const PORT = Number(process.env.PORT ?? 55566);
const cluster = await startScratchSchema({ port: PORT, maxConnections: 16 });
const { sql } = cluster;
if (!new RegExp(`@(?:127\\.0\\.0\\.1|localhost):${PORT}/`, 'u').test(cluster.url)) throw new Error('não é o cluster local');
process.env.DATABASE_URL = cluster.url;
delete process.env.DATABASE_URL_RUNTIME;
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://ci.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_ci';
process.env.OUTBOX_CRON_ALLOW_NON_VERCEL = 'true';
process.env.CRYPTO_SECRET_BACKEND = 'env';
process.env.CRYPTO_MASTER_KEY_V1 = Buffer.alloc(32, 7).toString('base64');
process.env.CRYPTO_LOOKUP_SALT = Buffer.alloc(32, 9).toString('base64');
process.env.LOG_LEVEL = 'error';

const { withTenant } = await import('../../src/lib/db/tenant');
await import('../../src/app/api/cron/outbox/handlers');
const { runOutboxEventsNow } = await import('../../src/lib/outbox/worker');
const { decryptForTenant } = await import('../../src/lib/crypto/encryption');
const { HEALTH_INSURANCE_EVENTS } = await import('../../src/contexts/health-insurance/events');
const cred = await import('../../src/contexts/health-insurance/internal/insurer-credentials');
const send = await import('../../src/contexts/health-insurance/internal/batch-connector-send');
const { batchSendRuntime, handleBatchSendRequested } = await import('../../src/contexts/health-insurance/internal/handlers/batch-send-requested');
const { createTissXsdEngine, TISS_WS_ELEMENTS, TISS_WS_ENTRYPOINT } = await import('../../src/contexts/health-insurance/tiss/xml/xsd-engine');
const { startStubOperator } = await import('../../src/contexts/health-insurance/internal/connectors/tiss-soap/stub-operator');
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
const wsXsd = createTissXsdEngine({ entrypoint: TISS_WS_ENTRYPOINT, rootElements: TISS_WS_ELEMENTS });

const LOGIN = 'prestador-sint';
const PASSWORD = 'senha-sintetica-789';
const MD5 = createHash('md5').update(PASSWORD, 'latin1').digest('hex');
const stub = await startStubOperator({ registroANS: '123456', login: LOGIN, senhaPrestador: MD5, plainPassword: PASSWORD, soapVersion: '1.1', xsd: wsXsd });
const registry = new Map([
  ['123456', {
    registroANS: '123456', homologatedOn: '2026-11-19', evidence: 'homologação SINTÉTICA contra o stub',
    soap: { endpoints: { submit_batch: stub.url }, soapVersion: '1.1' as const, passwordEncoding: 'md5_hex' as const, deduplicatesSubmissions: false, allowLoopbackHttp: true, timeoutMs: 3_000, retries: 0 },
  }],
]);
batchSendRuntime.deps = () => ({ store, registry, xsd: () => wsXsd });
const rc = { ip: null, userAgent: 'harness', requestId: 'p9-4', correlationId: null };

let passed = 0;
const pass = (m: string) => {
  passed += 1;
  console.log(`PASS ${passed}: ${m}`);
};

try {
  await sql`GRANT SELECT ON public.clinics, public.profiles TO authenticated`;
  await fx.seedTerminology();
  const A = await fx.setupClinic('Conector A');
  const B = await fx.setupClinic('Conector B');
  const asA = <T>(fn: Parameters<typeof withTenant<T>>[1]) => withTenant(A.clinicId, fn, A.doctorId);
  await asA((tx) => cred.saveInsurerCredentialTx(tx, { clinicId: A.clinicId, userId: A.doctorId, insurerId: A.insurerId, kind: 'webservice_login', username: LOGIN, secret: PASSWORD }));

  const exportedBatch = async () => {
    const guides = [await A.approvedGuide(), await A.approvedGuide()];
    const batchId = await fx.createBatch(A, guides);
    const out = await fx.exportBatch(A, batchId);
    if (out.kind !== 'exported') throw new Error(`lote não exportado: ${out.kind}`);
    return { batchId, version: await fx.batchVersion(batchId) };
  };
  const request = (b: { batchId: string; version: number }, reg = registry) =>
    asA((tx) => send.requestBatchConnectorSendTx(tx, { clinicId: A.clinicId, batchId: b.batchId, version: b.version, userId: A.doctorId, requestContext: rc, registry: reg }));
  const run = (key: string) => runOutboxEventsNow([{ eventType: HEALTH_INSURANCE_EVENTS.BATCH_SEND_REQUESTED, idempotencyKeys: [key] }]);
  const job = async (key: string) => (await sql`select status::text, error_code, attempts from public.outbox where idempotency_key = ${key}`)[0]!;
  const batchRow = async (id: string) => (await sql`select status, send_channel, protocol_number, send_count from public.hi_batches where id = ${id}::uuid`)[0]!;

  // 1. Aceito: enviado pelo conector e recebido com o protocolo, recibo guardado cifrado, credencial usada.
  const b1 = await exportedBatch();
  assert.equal(await asA((tx) => send.connectorSendAvailableTx(tx, A.clinicId, b1.batchId, registry)), true);
  const { key: k1 } = await request(b1);
  // Dois pedidos da mesma versão antes de processar: um só job (chave única do outbox).
  await request(b1).catch(() => null);
  await run(k1);
  const r1 = await batchRow(b1.batchId);
  assert.equal(r1.status, 'received');
  assert.equal(r1.send_channel, 'connector');
  assert.match(String(r1.protocol_number), /^PROT\d+$/u);
  assert.equal((await job(k1)).status, 'processed');
  assert.equal(stub.received.length, 1, 'um envio só');
  assert.equal(stub.received[0]!.element, 'loteGuiasWS');
  assert.deepEqual([stub.received[0]!.xsdValid, stub.received[0]!.hashOk, stub.received[0]!.loginOk, stub.received[0]!.plainPasswordSeen], [true, true, true, false]);
  const [ret] = await sql`select content_sha256 from public.hi_batch_returns where batch_id = ${b1.batchId}::uuid and kind = 'protocol_receipt'`;
  const [file] = await sql`select storage_ref, content_sha256 from public.hi_files where batch_id = ${b1.batchId}::uuid and kind = 'batch_return'`;
  assert.equal(file!.content_sha256, ret!.content_sha256, 'recibo guardado é o do protocolo');
  const plain = Buffer.from(await decryptForTenant(A.clinicId, Buffer.from(objects.get(String(file!.storage_ref))!).toString('utf8')), 'base64');
  assert.equal(createHash('sha256').update(plain).digest('hex'), file!.content_sha256);
  assert.match(plain.toString('latin1'), /protocoloRecebimentoWS/u);
  const [used] = await sql`select last_used_at is not null as used from public.hi_insurer_credentials where clinic_id = ${A.clinicId}::uuid and status = 'active'`;
  assert.equal(used!.used, true);
  const [aud] = await sql`select count(*)::int as n from public.audit_events where resource_id = ${b1.batchId} and action = 'health_insurance.batch.sent_via_connector'`;
  assert.equal(aud!.n, 1);
  pass('aceito: o lote exportado sai UMA vez (dois pedidos, um job), o envelope chega válido no XSD com hash e login; "enviado" pelo conector e "recebido" com o protocolo do recibo, guardado cifrado e com o mesmo SHA-256; credencial marcada como usada; trilha gravada');

  // 2. Lote já enviado: novo pedido é recusado e nada sai.
  await assert.rejects(() => request({ batchId: b1.batchId, version: b1.version }), /lote exportado, ainda não enviado|mudou/u);
  assert.equal(stub.received.length, 1);
  pass('lote já enviado: o pedido é recusado antes da rede');

  // 3. Recusa da operadora: o lote continua exportado (nada de "enviado"), job falho com o motivo.
  stub.setMode('business_error');
  const b3 = await exportedBatch();
  const { key: k3 } = await request(b3);
  await run(k3);
  assert.equal((await batchRow(b3.batchId)).status, 'exported');
  assert.deepEqual([(await job(k3)).status, (await job(k3)).error_code], ['failed', 'operator_rejected']);
  assert.equal(Number((await sql`select count(*)::int as n from public.hi_batch_returns where batch_id = ${b3.batchId}::uuid`)[0]!.n), 0);
  pass('recusa da operadora: o lote segue exportado, sem protocolo; o job termina com o motivo (sem nova tentativa)');

  // 4. Webservice fora: sem estado falso e SEM reenvio automático (pode ter chegado).
  stub.setMode('http500');
  const b4 = await exportedBatch();
  const before4 = stub.received.length;
  const { key: k4 } = await request(b4);
  await run(k4);
  await run(k4);
  assert.equal((await batchRow(b4.batchId)).status, 'exported');
  assert.deepEqual([(await job(k4)).status, (await job(k4)).error_code], ['failed', 'connector_unavailable']);
  assert.equal(stub.received.length, before4 + 1, 'uma chamada só, sem repetição');
  pass('webservice fora: o lote segue exportado, o job pede conferência no portal e não há reenvio automático');

  // 5. Segunda tentativa de um job (o processo caiu no meio) sem deduplicação declarada: não reenvia.
  stub.setMode('accept');
  const b5 = await exportedBatch();
  const before5 = stub.received.length;
  await assert.rejects(
    () => handleBatchSendRequested({ clinicId: A.clinicId, payload: { clinicId: A.clinicId, batchId: b5.batchId, version: b5.version, requestedBy: A.doctorId }, eventId: '00000000-0000-4000-8000-000000000005', attempt: 2 }, { store, registry, xsd: () => wsXsd }),
    (e: Error & { code?: string }) => e.name === 'PoisonPillError' && /portal/u.test(e.message),
  );
  assert.equal(stub.received.length, before5);
  assert.equal((await batchRow(b5.batchId)).status, 'exported');
  pass('segunda tentativa sem deduplicação da operadora: não reenvia (pede conferência no portal) e o lote fica como estava');

  // 6. Sem homologação, sem credencial ou de outra clínica: recusado antes de publicar.
  await assert.rejects(() => request(b5, new Map()), /não tem webservice homologado/u);
  assert.equal(await asA((tx) => send.connectorSendAvailableTx(tx, A.clinicId, b5.batchId, new Map())), false);
  await assert.rejects(
    () => withTenant(B.clinicId, (tx) => send.requestBatchConnectorSendTx(tx, { clinicId: B.clinicId, batchId: b5.batchId, version: b5.version, userId: B.doctorId, requestContext: rc, registry }), B.doctorId),
    /não encontrado/u,
  );
  const [active] = await sql`select id::text from public.hi_insurer_credentials where clinic_id = ${A.clinicId}::uuid and status = 'active'`;
  await asA((tx) => cred.revokeInsurerCredentialTx(tx, { clinicId: A.clinicId, insurerId: A.insurerId, credentialId: String(active!.id) }));
  await assert.rejects(() => request(b5), /credencial/u);
  assert.equal(await asA((tx) => send.connectorSendAvailableTx(tx, A.clinicId, b5.batchId, registry)), false);
  const [pub] = await sql`select count(*)::int as n from public.outbox where idempotency_key = ${send.batchSendKey(b5.batchId, b5.version)}`;
  assert.equal(pub!.n, 0);
  pass('sem homologação, sem credencial ativa ou de outra clínica (RLS): o pedido é recusado e nenhum evento é publicado; a tela não oferece o envio');

  // 7. Nenhum segredo no banco: nem a senha em claro nem o MD5 aparecem em outbox, trilha, lote ou arquivos.
  const dump = JSON.stringify([
    await sql`select * from public.outbox`,
    await sql`select * from public.audit_events`,
    await sql`select * from public.hi_batches`,
    await sql`select * from public.hi_batch_returns`,
    await sql`select * from public.hi_files`,
  ]);
  assert.ok(!dump.includes(PASSWORD) && !dump.includes(MD5) && !dump.includes(LOGIN), 'segredo no banco');
  pass('nenhum segredo (senha, MD5 ou login) em outbox, trilha, lote, retornos ou arquivos');

  console.log(`\n${passed}/7 provas do envio pelo conector (P9.4, teto "Testado") passaram.`);
} finally {
  await stub.close();
  await cluster.stop();
}
process.exit(0);
