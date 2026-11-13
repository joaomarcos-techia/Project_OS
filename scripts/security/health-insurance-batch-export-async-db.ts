/**
 * R45 — exportação do lote em segundo plano pelo OUTBOX, com a leitura DELEGADA das guias.
 * Schema real num Postgres descartável; worker real (`runOutboxOnce` com o boot dos
 * handlers); exportação real (regras, TUSS, XSD oficial, hash, cifra). Prova:
 *
 *  1. leitura delegada: serviço não declarado recusado; a leitura de sistema comum não
 *     usa a operação delegada; lote de outra clínica = não encontrado;
 *  2. quem pediu sem `manage:financial` (ou que perdeu o acesso depois do pedido) é
 *     negado NA EXECUÇÃO, com auditoria de negação em nome dessa pessoa; nenhum arquivo;
 *  3. caminho feliz: pedido → job → XML exportado e validado; auditoria de leitura em nome
 *     de quem pediu, com serviço e job (`actor.kind = delegated`);
 *  4. idempotência: o mesmo pedido (mesma chave) é um job só; worker duplicado / replay →
 *     `already_exported`; UM arquivo faturável;
 *  5. lote alterado (cancelado) depois do pedido → o job caduca, nada é gerado;
 *  6. XSD reprovado → falha sem nova tentativa, com código; lote continua preparado;
 *  7. armazenamento indisponível → erro transitório (nova tentativa), nada órfão; depois
 *     do retorno do armazenamento, exporta;
 *  8. assinatura suspensa depois do pedido → bloqueio comercial (D24), sem arquivo;
 *  9. backlog: 12 lotes pedidos de uma vez → todos exportados, um arquivo cada.
 *
 * Não toca DEV nem produção. Uso:
 *   NODE_OPTIONS="--import ./scripts/security/server-only-hook.mjs" npx tsx --tsconfig tsconfig.scripts.json scripts/security/health-insurance-batch-export-async-db.ts
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { startScratchSchema } from './scratch-schema';

const cluster = await startScratchSchema({ port: 55529, maxConnections: 32 });
const { sql } = cluster;
if (!/@(?:127\.0\.0\.1|localhost):55529\//u.test(cluster.url)) throw new Error('não é o cluster local');
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
const { publishEvent } = await import('../../src/lib/outbox/publish');
const { HEALTH_INSURANCE_EVENTS } = await import('../../src/contexts/health-insurance/events');
const access = await import('../../src/contexts/health-insurance/internal/guide-access');
const job = await import('../../src/contexts/health-insurance/internal/handlers/batch-export-requested');
const batches = await import('../../src/contexts/health-insurance/internal/batch-service');
const { loadXmllintValidator } = await import('../../src/contexts/health-insurance/tiss/xml/xsd-validator');
const { loadHiFixtures } = await import('./hi-fixtures');

const xsd = loadXmllintValidator();
if (!xsd) throw new Error('validador XSD do app indisponível');
const objects = new Map<string, Uint8Array>();
let storageDown = false;
const store = {
  async put(ref: string, bytes: Uint8Array) {
    if (storageDown) throw new Error('armazenamento indisponível (simulado)');
    objects.set(ref, bytes);
  },
  async get(ref: string) {
    return objects.get(ref)!;
  },
  async remove(ref: string) {
    objects.delete(ref);
  },
};
let xsdOverride: typeof xsd | null = null;
job.batchExportRuntime.deps = () => ({ store, validateXsd: xsdOverride ?? xsd });

const fx = await loadHiFixtures(sql, { store, validateXsd: xsd });
await fx.seedTerminology();
await sql`GRANT SELECT ON public.clinics, public.profiles TO authenticated`;

let passed = 0;
const pass = (msg: string) => {
  passed += 1;
  console.log(`PASS: ${msg}`);
};
type Clinic = Awaited<ReturnType<typeof fx.setupClinic>>;

async function gestor(c: Clinic): Promise<string> {
  const id = randomUUID();
  await sql`insert into auth.users (id, email) values (${id}::uuid, ${`${id}@example.invalid`})`;
  await sql`insert into public.profiles (id, clinic_id, nome, role, ativo) values (${id}::uuid, ${c.clinicId}::uuid, 'Gestora Sintética', 'gestor', true)`;
  return id;
}
async function newBatch(c: Clinic, n = 1): Promise<{ batchId: string; version: number }> {
  const guides: string[] = [];
  for (let i = 0; i < n; i++) guides.push(await c.approvedGuide());
  const batchId = (await fx.createBatch(c, guides)) as string;
  return { batchId, version: await fx.batchVersion(batchId) };
}
const key = (b: { batchId: string; version: number }) => `hi-batch-export:${b.batchId}:v${b.version}`;
async function request(c: Clinic, b: { batchId: string; version: number }, requestedBy: string) {
  await withTenant(
    c.clinicId,
    (tx) =>
      publishEvent(tx, {
        clinicId: c.clinicId,
        eventType: HEALTH_INSURANCE_EVENTS.BATCH_EXPORT_REQUESTED,
        payload: { clinicId: c.clinicId, batchId: b.batchId, version: b.version, requestedBy },
        idempotencyKey: key(b),
      }),
    requestedBy,
  );
}
async function drain(times = 3) {
  for (let i = 0; i < times; i++) await runOutboxOnce({ batchSize: 50, parallelism: 2 });
}
const outboxRow = async (b: { batchId: string; version: number }) =>
  (await sql`select status::text as status, attempts, error_code from public.outbox where idempotency_key = ${key(b)}`)[0];
const batchRow = async (batchId: string) => (await sql`select status, file_id from public.hi_batches where id = ${batchId}::uuid`)[0]!;
const files = async (batchId: string) => Number((await sql`select count(*)::int as n from public.hi_files where batch_id = ${batchId}::uuid and kind = 'batch_xml'`)[0]!.n);

try {
  const A = await fx.setupClinic('A');
  const B = await fx.setupClinic('B');
  const gA = await gestor(A);

  // ── 1. Leitura delegada: só pelo caminho próprio ─────────────────────
  const b0 = await newBatch(A);
  await assert.rejects(
    access.readBatchGuidesDelegated({ clinicId: A.clinicId, batchId: b0.batchId, requestedBy: gA, service: 'insurance-reconcile', jobId: randomUUID() }),
    (e: unknown) => (e as { reason?: string }).reason === 'service_not_allowed',
  );
  await assert.rejects(
    access.readGuidesAsSystem({ clinicId: A.clinicId, guideIds: [randomUUID()], operation: 'delegated_batch_export', service: 'insurance-batch-export', jobId: randomUUID() }),
    (e: unknown) => (e as { reason?: string }).reason === 'invalid_argument',
  );
  await assert.rejects(
    access.readBatchGuidesDelegated({ clinicId: B.clinicId, batchId: b0.batchId, requestedBy: gA, service: job.BATCH_EXPORT_SERVICE, jobId: randomUUID() }),
    (e: unknown) => (e as { reason?: string }).reason === 'not_found',
  );
  pass('leitura delegada: serviço não declarado recusado; a leitura de sistema comum não usa a delegada; lote de outra clínica = não encontrado');

  // ── 2. Quem pediu sem permissão (médica) → negado na execução ───────
  await request(A, b0, A.doctorId);
  await drain();
  const denied = await outboxRow(b0);
  assert.equal(denied!.status, 'failed');
  assert.equal(denied!.error_code, 'access_permission_revoked');
  assert.equal(await files(b0.batchId), 0);
  assert.equal((await batchRow(b0.batchId)).status, 'prepared');
  const [deniedAudit] = await sql`select count(*)::int as n from public.audit_events
    where action = 'health_insurance.guide.access_denied' and user_id = ${A.doctorId}::uuid and after->>'reason' = 'permission_revoked' and after->'actor'->>'kind' = 'delegated'`;
  assert.ok(deniedAudit!.n >= 1);
  pass('quem pediu sem manage:financial é negado NA EXECUÇÃO (falha sem nova tentativa, código access_permission_revoked), negação auditada em nome dessa pessoa; nenhum arquivo');

  // ── 3. Caminho feliz ────────────────────────────────────────────────
  const b1 = await newBatch(A, 2);
  await request(A, b1, gA);
  await drain();
  const ok = await outboxRow(b1);
  assert.equal(ok!.status, 'processed', JSON.stringify(ok));
  assert.equal((await batchRow(b1.batchId)).status, 'exported');
  assert.equal(await files(b1.batchId), 1);
  const reads = await sql`select user_id, after from public.audit_events where action = 'health_insurance.guide.content_viewed' and after->>'batchRef' = ${b1.batchId}`;
  assert.equal(reads.length, 2);
  assert.ok(reads.every((r) => r.user_id === gA && (r.after as { actor: { kind: string; service: string } }).actor.kind === 'delegated' && (r.after as { actor: { service: string } }).actor.service === 'insurance-batch-export'));
  pass('pedido → job → XML exportado e validado no XSD; 2 leituras auditadas em nome de quem pediu, com serviço e job (delegated)');

  // ── 4. Idempotência ────────────────────────────────────────────────
  await request(A, b1, gA); // mesma chave: ON CONFLICT DO NOTHING
  const [jobs] = await sql`select count(*)::int as n from public.outbox where idempotency_key = ${key(b1)}`;
  assert.equal(jobs!.n, 1);
  const replay = await job.handleBatchExportRequested(
    { clinicId: A.clinicId, eventId: randomUUID(), payload: { clinicId: A.clinicId, batchId: b1.batchId, version: b1.version, requestedBy: gA } },
    { store, validateXsd: xsd },
  );
  assert.equal(replay, 'already_exported');
  // Dois workers no mesmo lote ao mesmo tempo.
  const b2 = await newBatch(A);
  const twin = await Promise.allSettled([1, 2].map(() =>
    job.handleBatchExportRequested({ clinicId: A.clinicId, eventId: randomUUID(), payload: { clinicId: A.clinicId, batchId: b2.batchId, version: b2.version, requestedBy: gA } }, { store, validateXsd: xsd }),
  ));
  const kinds = twin.map((t) => (t.status === 'fulfilled' ? t.value : `erro:${String((t.reason as Error).message).slice(0, 60)}`));
  assert.ok(kinds.includes('exported'), JSON.stringify(kinds));
  assert.equal(await files(b1.batchId), 1);
  assert.equal(await files(b2.batchId), 1);
  pass(`idempotência: mesmo pedido = 1 job; replay = already_exported; dois workers no mesmo lote (${kinds.join(' + ')}) → 1 arquivo faturável por lote`);

  // ── 5. Lote alterado depois do pedido ──────────────────────────────
  const b3 = await newBatch(A);
  await request(A, b3, gA);
  await fx.asUser(A, (tx) => batches.cancelBatchInTx(tx, { clinicId: A.clinicId, batchId: b3.batchId, version: b3.version, reason: 'Cancelado depois do pedido (teste)' } as Parameters<typeof batches.cancelBatchInTx>[1]));
  await drain();
  assert.equal((await outboxRow(b3))!.status, 'processed');
  assert.equal(await files(b3.batchId), 0);
  assert.equal((await batchRow(b3.batchId)).status, 'cancelled');
  pass('lote cancelado depois do pedido: o job caduca (processado sem efeito), nenhum arquivo');

  // ── 6. XSD reprovado ───────────────────────────────────────────────
  const b4 = await newBatch(A);
  xsdOverride = async () => ({ valid: false, errors: ['elemento inesperado (simulado)'], engine: 'simulado', stage: 'xsd' as const });
  await request(A, b4, gA);
  await drain();
  xsdOverride = null;
  const xsdFail = await outboxRow(b4);
  assert.equal(xsdFail!.status, 'failed', JSON.stringify(xsdFail));
  assert.match(String(xsdFail!.error_code), /^export_/u);
  assert.equal((await batchRow(b4.batchId)).status, 'prepared');
  assert.equal(await files(b4.batchId), 0);
  pass(`XSD reprovado: falha sem nova tentativa (${String(xsdFail!.error_code)}), lote continua preparado, nenhum arquivo`);

  // ── 7. Armazenamento indisponível → transitório ─────────────────────
  const b5 = await newBatch(A);
  storageDown = true;
  await request(A, b5, gA);
  await runOutboxOnce({ batchSize: 50, parallelism: 1 });
  const retrying = await outboxRow(b5);
  assert.notEqual(retrying!.status, 'processed');
  assert.notEqual(retrying!.status, 'failed');
  assert.ok(Number(retrying!.attempts) >= 1);
  assert.equal(await files(b5.batchId), 0);
  assert.equal([...objects.keys()].filter((k) => k.includes(b5.batchId)).length, 0);
  storageDown = false;
  await sql`update public.outbox set next_attempt_at = now() where idempotency_key = ${key(b5)}`;
  await drain();
  assert.equal((await outboxRow(b5))!.status, 'processed');
  assert.equal(await files(b5.batchId), 1);
  pass('armazenamento fora: erro transitório (nova tentativa agendada), nada órfão; com o armazenamento de volta, exporta 1 arquivo');

  // ── 8. Assinatura suspensa depois do pedido ────────────────────────
  const b6 = await newBatch(A);
  await request(A, b6, gA);
  await sql`update public.subscriptions set billing_status = 'cancelled' where clinic_id = ${A.clinicId}::uuid`;
  await drain();
  await sql`update public.subscriptions set billing_status = 'active' where clinic_id = ${A.clinicId}::uuid`;
  const susp = await outboxRow(b6);
  assert.equal(susp!.status, 'failed', JSON.stringify(susp));
  assert.equal(susp!.error_code, 'premium_denied');
  assert.equal(await files(b6.batchId), 0);
  pass('assinatura suspensa depois do pedido: bloqueio comercial (premium_denied), nenhum arquivo, lote preparado');

  // ── 8b. Worker interrompido no meio do job ─────────────────────────
  const b7 = await newBatch(A);
  await request(A, b7, gA);
  // Simula um worker que reservou o job e morreu: a linha fica "processing" há 10 min.
  await sql`update public.outbox set created_at = now() - interval '11 minutes', status = 'processing',
               processing_started_at = now() - interval '10 minutes', attempts = attempts + 1
             where idempotency_key = ${key(b7)}`;
  await drain();
  assert.equal((await outboxRow(b7))!.status, 'processed');
  assert.equal(await files(b7.batchId), 1);
  pass('worker interrompido: o job preso em "processing" é devolvido à fila pelo zelador do outbox e exporta 1 arquivo (sem duplicar)');

  // ── 9. Backlog ────────────────────────────────────────────────────
  const many: Array<{ batchId: string; version: number }> = [];
  for (let i = 0; i < 12; i++) many.push(await newBatch(A));
  const t0 = Date.now();
  for (const b of many) await request(A, b, gA);
  await drain(4);
  const ms = Date.now() - t0;
  for (const b of many) {
    assert.equal((await outboxRow(b))!.status, 'processed');
    assert.equal(await files(b.batchId), 1);
  }
  pass(`backlog: 12 lotes pedidos de uma vez → 12 exportados, 1 arquivo cada (${ms} ms no worker local, concorrência 2)`);

  console.log(`\n${passed}/${passed} provas da exportação assíncrona (R45) passaram.`);
} finally {
  await cluster.stop();
}
