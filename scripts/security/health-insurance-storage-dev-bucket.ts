/**
 * Convênios P12.7 — aceite do armazenamento contra o bucket REAL `tiss-files` do DEV
 * (decisão 1 do fundador, 12/11: bucket privado só no DEV, testes com documentos sintéticos).
 *
 * Metadados num Postgres DESCARTÁVEL (as tabelas `hi_*` não existem no DEV compartilhado e
 * nenhuma migration é aplicada lá); BYTES no bucket privado do DEV, pelo adaptador real
 * (`supabaseTissObjectStore`, service role só no servidor). Clínicas, pacientes e
 * carteirinha são sintéticos; os objetos ficam sob prefixos de clínicas que só existem
 * neste cluster e são removidos no fim.
 *
 * Aceite exigido: upload e download autorizados; outra clínica e sem permissão negados;
 * arquivo cifrado; SHA-256 íntegro; adulterado recusado; auditoria de leitura; falha de
 * armazenamento tratada; reprocessamento idempotente; sem URL pública permanente; sem dado
 * sensível em log; órfãos.
 *
 * Uso (o wrapper fora do repositório lê SÓ as variáveis do DEV e recusa produção):
 *   TISS_DEV_BUCKET_URL=https://<ref-dev>.supabase.co TISS_DEV_BUCKET_SECRET_KEY=... \
 *   TISS_DEV_BUCKET_PUBLISHABLE_KEY=... NODE_OPTIONS=--conditions=react-server \
 *   npx tsx scripts/security/health-insurance-storage-dev-bucket.ts
 */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import { startScratchSchema } from './scratch-schema';

const DEV_REF = 'pqhkirrszzpwezdaqrai';
const PROD_REF = 'shlcbxawrxuaebazuiue';
const devUrl = process.env.TISS_DEV_BUCKET_URL ?? '';
const devKey = process.env.TISS_DEV_BUCKET_SECRET_KEY ?? '';
const devPublishable = process.env.TISS_DEV_BUCKET_PUBLISHABLE_KEY ?? '';
if (new URL(devUrl).host !== `${DEV_REF}.supabase.co` || devUrl.includes(PROD_REF)) throw new Error('só o projeto DEV é aceito');
if (!devKey.startsWith('sb_secret_') || !devPublishable) throw new Error('credenciais do DEV ausentes');

const cluster = await startScratchSchema({ port: 55512, maxConnections: 24 });
const { sql } = cluster;
if (!/@(?:127\.0\.0\.1|localhost):55512\//u.test(cluster.url)) throw new Error('não é o cluster local');
process.env.DATABASE_URL = cluster.url;
delete process.env.DATABASE_URL_RUNTIME;
process.env.NEXT_PUBLIC_SUPABASE_URL = devUrl;
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = devPublishable;
process.env.SUPABASE_SECRET_KEY = devKey;
process.env.CRYPTO_SECRET_BACKEND = 'env';
process.env.CRYPTO_MASTER_KEY_V1 = Buffer.alloc(32, 7).toString('base64');
process.env.CRYPTO_LOOKUP_SALT = Buffer.alloc(32, 9).toString('base64');

// Tudo o que o processo escreve em stdout/stderr é capturado para a varredura de vazamento.
const logged: string[] = [];
for (const stream of [process.stdout, process.stderr]) {
  const original = stream.write.bind(stream) as (chunk: unknown, ...rest: unknown[]) => boolean;
  (stream as unknown as { write: typeof original }).write = (chunk: unknown, ...rest: unknown[]) => {
    logged.push(String(chunk));
    return original(chunk, ...rest);
  };
}

const { createClient } = await import('@supabase/supabase-js');
const storage = await import('../../src/lib/storage/tiss-files');
const fileAccess = await import('../../src/contexts/health-insurance/internal/tiss-file-access');
const { loadXmllintValidator } = await import('../../src/contexts/health-insurance/tiss/xml/xsd-validator');
const { loadHiFixtures, SYNTHETIC_CARD } = await import('./hi-fixtures');

const xsd = loadXmllintValidator();
if (!xsd) throw new Error('validador XSD do app indisponível (TISS_XMLLINT_WASM_DIR fora do CI)');

const store = storage.supabaseTissObjectStore();
const fx = await loadHiFixtures(sql, { store, validateXsd: xsd });
const admin = createClient(devUrl, devKey, { auth: { persistSession: false, autoRefreshToken: false } });
const bucket = admin.storage.from(storage.TISS_FILES_BUCKET);
const sha = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');
const audit = { ip: null, userAgent: 'harness-dev-bucket', requestId: 'harness-dev-bucket' };
const timings: Record<string, number> = {};
const timed = async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
  const t0 = performance.now();
  try {
    return await fn();
  } finally {
    timings[label] = Math.round(performance.now() - t0);
  }
};

let passed = 0;
const pass = (msg: string): void => {
  passed += 1;
  console.log(`PASS: ${msg}`);
};
const prefixes: string[] = [];

try {
  await sql`GRANT SELECT ON public.clinics TO authenticated`;
  await fx.seedTerminology();
  const A = await fx.setupClinic('A');
  const B = await fx.setupClinic('B');
  prefixes.push(A.clinicId, B.clinicId);

  // ── 0. Prontidão: o bucket existe e é privado ─────────────────────────
  assert.deepEqual(await storage.checkTissBucketReadiness(), { ok: true, reason: 'ready' });
  const { data: meta } = await admin.storage.getBucket(storage.TISS_FILES_BUCKET);
  assert.deepEqual([meta!.public, meta!.file_size_limit, meta!.allowed_mime_types], [false, 31457280, ['application/octet-stream']]);
  pass('bucket tiss-files do DEV: existe, privado, 30 MiB, só application/octet-stream (prontidão do app = ready)');

  // ── 1. Upload autorizado: exportação real grava o objeto cifrado no bucket ──
  const g = [await A.approvedGuide(), await A.approvedGuide()];
  const batchId = await fx.createBatch(A, g);
  const out = await timed('export_2_guias_ms', () => fx.exportBatch(A, batchId));
  assert.equal(out.kind, 'exported');
  const [file] = await sql`select * from public.hi_files where id = ${(out as { fileId: string }).fileId}::uuid`;
  const ref = file!.storage_ref as string;
  assert.ok(ref.startsWith(`${A.clinicId}/`));
  const listed = await store.list!(A.clinicId);
  assert.deepEqual(listed.map((o) => o.ref), [ref]);
  pass('upload autorizado: a exportação real (13 passos) gravou UM objeto no bucket do DEV, sob o prefixo da clínica, com hi_files na mesma transação');

  // ── 2. Cifrado: o objeto guardado não tem XML, carteirinha nem nome em claro ──
  const raw = await store.get(ref);
  const rawText = Buffer.from(raw).toString('latin1');
  assert.equal(sha(raw), file!.ciphertext_sha256);
  for (const needle of ['<?xml', 'ans:', SYNTHETIC_CARD, 'Paciente Sint', 'Dra. Sint']) assert.ok(!rawText.includes(needle), `vazou ${needle}`);
  pass('arquivo CIFRADO no bucket: os bytes guardados batem com ciphertext_sha256 e não contêm XML, carteirinha, nome do paciente nem do profissional');

  // ── 3. Download autorizado com SHA-256 íntegro e auditoria ─────────────
  const readArgs = { clinicId: A.clinicId, fileId: file!.id as string, userId: A.doctorId, purpose: 'download_arquivo' as const, requestContext: audit };
  const ok = await timed('download_ms', () => fileAccess.readTissFile(store, readArgs));
  assert.ok(ok);
  assert.deepEqual([ok.kind, ok.mediaType, sha(ok.bytes) === file!.content_sha256, ok.bytes.toString('latin1').includes('<ans:numeroLote>')], ['batch_xml', 'application/xml', true, true]);
  pass('download autorizado: decifra, confere o SHA-256 do cifrado e do conteúdo e entrega o XML do lote');

  // ── 4. Outra clínica e acesso direto ao bucket ─────────────────────────
  assert.equal(await fileAccess.readTissFile(store, { ...readArgs, clinicId: B.clinicId, userId: B.doctorId }), null);
  assert.deepEqual(await store.list!(B.clinicId), []);
  const anon = createClient(devUrl, devPublishable, { auth: { persistSession: false, autoRefreshToken: false } });
  const anonDownload = await anon.storage.from(storage.TISS_FILES_BUCKET).download(ref);
  const anonList = await anon.storage.from(storage.TISS_FILES_BUCKET).list(A.clinicId);
  assert.ok(anonDownload.error && !anonDownload.data, 'anon baixou o objeto');
  assert.deepEqual(anonList.data ?? [], [], 'anon listou objetos');
  const publicUrl = anon.storage.from(storage.TISS_FILES_BUCKET).getPublicUrl(ref).data.publicUrl;
  const publicRes = await fetch(publicUrl);
  assert.notEqual(publicRes.status, 200);
  await publicRes.body?.cancel();
  const anonUpload = await anon.storage.from(storage.TISS_FILES_BUCKET).upload(`${A.clinicId}/${randomUUID()}`, new Uint8Array([1, 2, 3]), { contentType: 'application/octet-stream' });
  assert.ok(anonUpload.error, 'anon gravou no bucket');
  pass(`acesso negado: outra clínica não acha o arquivo pelo ID (mesmo null de inexistente) nem lista o prefixo; sem sessão de servidor (chave publicável) não baixa, não lista, não grava; URL "pública" do objeto responde ${publicRes.status}`);

  // Sem permissão: o bucket não é acessível pelo navegador; quem entrega é a rota, que
  // exige MANAGE_FINANCIAL antes de ler (route.test.ts). Aqui: nenhum caminho do app
  // cria URL assinada ou pública para este bucket.
  const srcRoot = path.resolve('src');
  const offenders: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = path.join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/u.test(name)) {
        const text = readFileSync(p, 'utf8');
        if ((text.includes('tiss-files') || text.includes('TISS_FILES_BUCKET')) && /createSignedUrl|getPublicUrl/u.test(text)) offenders.push(path.relative(srcRoot, p));
      }
    }
  };
  walk(srcRoot);
  assert.deepEqual(offenders, []);
  pass('sem permissão e sem URL permanente: nenhum código do app gera URL assinada ou pública do tiss-files; a entrega é só pela rota com gate de permissão (route.test.ts)');

  // ── 5. Adulterado e ausente: recusados, auditoria da falha gravada ─────
  await bucket.upload(ref, Buffer.from('conteudo-adulterado'), { contentType: 'application/octet-stream', upsert: true });
  await assert.rejects(() => fileAccess.readTissFile(store, readArgs), fileAccess.TissFileIntegrityError);
  await bucket.remove([ref]);
  await assert.rejects(() => fileAccess.readTissFile(store, readArgs), fileAccess.TissFileMissingError);
  // Restauração do backup: os mesmos bytes cifrados (o banco guarda o SHA-256 para conferir).
  await bucket.upload(ref, raw, { contentType: 'application/octet-stream', upsert: false });
  assert.ok(await fileAccess.readTissFile(store, readArgs));
  const outcomes = (await sql`select after->>'outcome' as o, after->>'purpose' as p from public.audit_events
      where action = 'health_insurance.file.read' and resource_id = ${file!.id} order by created_at`).map((r) => `${r.o}:${r.p}`);
  assert.deepEqual(outcomes, ['granted:download_arquivo', 'integrity_failed:download_arquivo', 'missing:download_arquivo', 'granted:download_arquivo']);
  pass('adulterado no bucket real: recusado (SHA-256 não confere); ausente: classificado como "missing" a partir do erro REAL do Supabase; restauração com os bytes originais volta a abrir; a auditoria tem as 4 leituras com finalidade, inclusive as falhas');

  // ── 6. Falha de armazenamento tratada (credencial recusada pelo DEV, de verdade) ──
  const broken = storage.supabaseTissObjectStore(() =>
    createClient(devUrl, 'sb_secret_invalida_para_teste_000000000', { auth: { persistSession: false, autoRefreshToken: false } }),
  );
  const gFail = await A.approvedGuide();
  const bFail = await fx.createBatch(A, [gFail]);
  await assert.rejects(() => fx.exportBatch(A, bFail, { store: broken, validateXsd: xsd }), storage.TissStorageError);
  const [failRow] = await sql`select status, file_id from public.hi_batches where id = ${bFail}::uuid`;
  assert.deepEqual([failRow!.status, failRow!.file_id], ['prepared', null]);
  assert.deepEqual((await store.list!(A.clinicId)).length, 1);
  await assert.rejects(() => fileAccess.readTissFile(broken, readArgs), storage.TissStorageError);
  pass('falha REAL de armazenamento (chave recusada pelo DEV): a exportação recusa, o lote continua "preparado" sem arquivo, nada fica no bucket; a leitura responde indisponível (503 na rota), sem entregar nada');

  // ── 7. Reprocessamento idempotente ───────────────────────────────────
  const again = await fx.exportBatch(A, batchId);
  assert.equal(again.kind, 'already_exported');
  assert.equal((await store.list!(A.clinicId)).length, 1);
  const okFail = await fx.exportBatch(A, bFail);
  assert.equal(okFail.kind, 'exported');
  assert.equal((await store.list!(A.clinicId)).length, 2);
  pass('reprocessamento: exportar de novo o lote exportado não grava outro objeto (already_exported); o lote que falhou exporta ao repetir com o armazenamento de volta');

  // ── 8. Concorrência: 6 lotes exportados em paralelo, objetos distintos ──
  const par: string[] = [];
  for (let i = 0; i < 6; i++) par.push(await fx.createBatch(A, [await A.approvedGuide()]));
  const results = await timed('export_6_paralelo_ms', () => Promise.all(par.map((b) => fx.exportBatch(A, b))));
  assert.ok(results.every((r) => r.kind === 'exported'));
  const refs = (await sql`select storage_ref from public.hi_files where clinic_id = ${A.clinicId}::uuid`).map((r) => r.storage_ref as string);
  assert.equal(new Set(refs).size, 8);
  assert.deepEqual((await store.list!(A.clinicId)).map((o) => o.ref).sort(), [...refs].sort());
  pass('concorrência: 6 exportações simultâneas no bucket real, 8 objetos distintos, banco e bucket iguais objeto a objeto');

  // ── 9. Restrição do bucket: tipo de mídia diferente é recusado pelo próprio bucket ──
  const wrongType = await bucket.upload(`${A.clinicId}/${randomUUID()}`, Buffer.from('<x/>'), { contentType: 'application/xml' });
  assert.ok(wrongType.error, 'bucket aceitou application/xml');
  pass('o bucket recusa qualquer tipo diferente de application/octet-stream (XML em claro não entra nem por engano)');

  // ── 10. Órfãos: conferência e descarte só fora da carência ────────────
  const orphan = `${A.clinicId}/${randomUUID()}`;
  const up = await bucket.upload(orphan, Buffer.from('cifrado-sem-registro'), { contentType: 'application/octet-stream' });
  assert.ok(!up.error);
  const dry = await fileAccess.reconcileTissStorage(store, { clinicId: A.clinicId });
  assert.deepEqual([dry.missing.length, dry.orphans, dry.recentOrphans, dry.discarded], [0, [], 1, 0]);
  const later = await fileAccess.reconcileTissStorage(store, { clinicId: A.clinicId, now: new Date(Date.now() + 25 * 3_600_000), discardOrphans: true });
  assert.deepEqual([later.orphans, later.discarded], [[orphan], 1]);
  assert.equal((await store.list!(A.clinicId)).length, 8);
  pass('órfão no bucket real: dentro da carência de 24 h fica (pode ser exportação em curso); fora dela é descartado; os 8 arquivos registrados ficam intactos');

  // ── 11. Sem dado sensível em log nem na auditoria ─────────────────────
  const auditText = JSON.stringify(await sql`select action, after, before from public.audit_events`);
  const out11 = logged.join('');
  for (const needle of [SYNTHETIC_CARD, 'Paciente Sint', devKey, devPublishable, 'cifrado-sem-registro']) {
    assert.ok(!out11.includes(needle), `log contém ${needle.slice(0, 6)}…`);
    assert.ok(!auditText.includes(needle), `auditoria contém ${needle.slice(0, 6)}…`);
  }
  assert.ok(!/storage_ref|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}/u.test(out11), 'referência de objeto em log');
  pass('sem vazamento: nada do que o processo escreveu nem a auditoria contém carteirinha, nome, chaves ou referência de objeto');

  console.log(JSON.stringify({ timings }));
  console.log(`\n${passed}/13 cenários do bucket real do DEV passaram.`);
  assert.equal(passed, 13);
} finally {
  // Limpeza: remove SÓ os objetos sintéticos dos prefixos criados neste cluster.
  let removed = 0;
  for (const prefix of prefixes) {
    const { data } = await bucket.list(prefix, { limit: 1000 });
    const names = (data ?? []).map((o) => `${prefix}/${o.name}`);
    if (names.length) {
      const { error } = await bucket.remove(names);
      if (!error) removed += names.length;
    }
    const { data: left } = await bucket.list(prefix, { limit: 10 });
    if ((left ?? []).length) console.error(`ATENÇÃO: sobrou objeto sintético sob um prefixo de teste (${(left ?? []).length})`);
  }
  console.log(`limpeza: ${removed} objetos sintéticos removidos do bucket do DEV`);
  await cluster.stop();
}
