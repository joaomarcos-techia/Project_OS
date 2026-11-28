/**
 * Convênios P6.3 — comprovante da autorização em PARTES (até 10 MB), em Postgres DESCARTÁVEL (cadeia
 * do DEV), com a criptografia REAL do app e um armazenamento em memória com listagem. Nunca no DEV.
 *
 *   1. arquivo de 7 MB (3 partes de 3 MiB): partes cifradas no armazenamento, montagem conferida,
 *      anexo pelo domínio (tipo pelo conteúdo, cifra, registro); leitura auditada devolve o mesmo
 *      SHA-256; as partes são descartadas;
 *   2. token de outra clínica e de outra pessoa é recusado; parte adulterada não monta;
 *   3. regressão do achado de 16/11: a conferência de órfãos com descarte NÃO apaga o comprovante
 *      registrado em hi_authorization_attachments nem as partes de um envio em andamento;
 *   4. limpeza: partes de envio abandonado (> 2 h) saem; as recentes ficam.
 *
 *   SECURITY_PG_BIN=... PORT=55556 NODE_OPTIONS=--conditions=react-server \
 *     npx tsx scripts/security/health-insurance-receipt-upload-db.ts
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { readDevOrderChain } from './dev-order-chain';
import { startScratchSchema } from './scratch-schema';

const PORT = Number(process.env.PORT ?? 55556);
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

const auths = await import('../../src/contexts/health-insurance/internal/authorizations');
const up = await import('../../src/contexts/health-insurance/internal/receipt-upload');
const fileAccess = await import('../../src/contexts/health-insurance/internal/tiss-file-access');
const { TissStorageError } = await import('../../src/lib/storage/tiss-files');
const { loadXmllintValidator } = await import('../../src/contexts/health-insurance/tiss/xml/xsd-validator');
const { loadHiFixtures } = await import('./hi-fixtures');

const xsd = loadXmllintValidator();
if (!xsd) throw new Error('validador XSD do app indisponível (TISS_XMLLINT_WASM_DIR fora do CI)');
const objects = new Map<string, { bytes: Uint8Array; createdAt: Date }>();
const store = {
  async put(ref: string, bytes: Uint8Array) {
    if (objects.has(ref)) throw new TissStorageError('put', 'The resource already exists');
    objects.set(ref, { bytes, createdAt: new Date() });
  },
  async get(ref: string) {
    const o = objects.get(ref);
    if (!o) throw new TissStorageError('get', 'Object not found', 'not_found');
    return o.bytes;
  },
  async remove(ref: string) {
    objects.delete(ref);
  },
  async list(clinicId: string) {
    return [...objects.entries()].filter(([r]) => r.startsWith(`${clinicId}/`)).map(([ref, o]) => ({ ref, createdAt: o.createdAt }));
  },
};
const fx = await loadHiFixtures(sql, { store, validateXsd: xsd });

let passed = 0;
const pass = (m: string) => {
  passed += 1;
  console.log(`PASS ${passed}: ${m}`);
};
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const FILE = (() => {
  const b = new Uint8Array(7 * 1024 * 1024);
  b.set([0x25, 0x50, 0x44, 0x46, 0x2d], 0); // %PDF-
  for (let i = 5; i < b.length; i++) b[i] = (i * 31) % 251;
  return b;
})();
const part = (i: number) => FILE.slice(i * up.RECEIPT_CHUNK_BYTES, (i + 1) * up.RECEIPT_CHUNK_BYTES);
const ctx = { requestContext: { ip: null, userAgent: null, requestId: 'harness' } };

try {
  await sql`GRANT SELECT ON public.clinics, public.profiles TO authenticated`;
  await fx.seedTerminology();
  const A = await fx.setupClinic('Comprovante A');
  const B = await fx.setupClinic('Comprovante B');
  const gA = await A.approvedGuide();
  const card = String((await sql`select membership_id from public.hi_guides where id = ${gA}::uuid`)[0]!.membership_id);
  const { authorizationId } = await fx.asUser(A, (tx) =>
    auths.requestManualAuthorizationTx(tx, {
      clinicId: A.clinicId, insurerId: A.insurerId, membershipId: card, requestedOn: '2026-11-10',
      items: [{ tableCode: '22', procedureCode: '10101012', quantityRequested: 1 }], actorUserId: A.doctorId,
    }),
  );

  // 1. Ponta a ponta com a cifra real.
  const begin = await up.beginReceiptUpload({ clinicId: A.clinicId, userId: A.doctorId, authorizationId, size: FILE.length, sha256: sha(FILE), declaredType: 'application/pdf' });
  assert.equal(begin.chunks, 3);
  const claims = await up.openReceiptUpload(begin.token, { clinicId: A.clinicId, userId: A.doctorId });
  for (const i of [0, 1, 2]) await up.putReceiptChunk(store, claims, i, part(i));
  const staged = [...objects.keys()].filter((k) => k.includes('/upload-'));
  assert.equal(staged.length, 3);
  for (const k of staged) assert.ok(!Buffer.from(objects.get(k)!.bytes).includes(Buffer.from('%PDF-')), 'parte gravada cifrada');
  const whole = await up.assembleReceiptUpload(store, claims);
  const out = await auths.attachAuthorizationReceipt(store, (fn) => fx.asUser(A, fn), {
    clinicId: A.clinicId, authorizationId, bytes: whole, declaredType: claims.type, actorUserId: A.doctorId,
  });
  await up.discardReceiptUpload(store, claims);
  assert.equal(out.contentSha256, sha(FILE));
  const read = await auths.readAuthorizationReceipt(store, { clinicId: A.clinicId, attachmentId: out.attachmentId, userId: A.doctorId, ...ctx });
  assert.ok(read && sha(read.bytes) === sha(FILE) && read.mediaType === 'application/pdf');
  const audited = await sql`select count(*)::int n from public.audit_events where action = ${auths.AUTHORIZATION_RECEIPT_READ_ACTION} and resource_id = ${out.attachmentId}`;
  assert.equal(Number(audited[0]!.n), 1, 'leitura auditada');
  assert.equal([...objects.keys()].filter((k) => k.includes('/upload-')).length, 0, 'partes descartadas');
  pass('7 MB em 3 partes cifradas: montagem conferida, anexo pelo domínio (tipo pelo conteúdo, cifra, registro), leitura auditada com o mesmo SHA-256; partes descartadas');

  // 2. Token de outra clínica / pessoa; parte adulterada.
  await assert.rejects(() => up.openReceiptUpload(begin.token, { clinicId: B.clinicId, userId: B.doctorId }), (e: { code?: string }) => e.code === 'forbidden');
  await assert.rejects(() => up.openReceiptUpload(begin.token, { clinicId: A.clinicId, userId: B.doctorId }), (e: { code?: string }) => e.code === 'forbidden');
  const b2 = await up.beginReceiptUpload({ clinicId: A.clinicId, userId: A.doctorId, authorizationId, size: FILE.length, sha256: sha(FILE), declaredType: 'application/pdf' });
  const c2 = await up.openReceiptUpload(b2.token, { clinicId: A.clinicId, userId: A.doctorId });
  for (const i of [0, 1, 2]) {
    const p = part(i);
    if (i === 1) p[100] = (p[100]! + 1) % 256;
    await up.putReceiptChunk(store, c2, i, p);
  }
  await assert.rejects(() => up.assembleReceiptUpload(store, c2), (e: { code?: string }) => e.code === 'integrity');
  pass('token só abre na mesma clínica e pessoa; parte adulterada (mesmo tamanho) não monta');

  // 3. Regressão: a conferência com descarte não apaga o comprovante nem as partes em andamento.
  const plan = await fileAccess.reconcileTissStorage(store, { clinicId: A.clinicId, now: new Date(Date.now() + 48 * 3_600_000), discardOrphans: true });
  const receiptRef = String((await sql`select storage_ref from public.hi_authorization_attachments where id = ${out.attachmentId}::uuid`)[0]!.storage_ref);
  assert.ok(objects.has(receiptRef), 'o comprovante registrado continua no armazenamento');
  assert.ok(!plan.orphans.some((r) => r.includes('/upload-')), 'partes em andamento fora da conferência');
  assert.equal([...objects.keys()].filter((k) => k.includes('/upload-')).length, 3);
  const again = await auths.readAuthorizationReceipt(store, { clinicId: A.clinicId, attachmentId: out.attachmentId, userId: A.doctorId, ...ctx });
  assert.ok(again && sha(again.bytes) === sha(FILE));
  pass('regressão do achado de 16/11: a conferência de órfãos com descarte não apaga o comprovante (hi_authorization_attachments) nem as partes de um envio em andamento');

  // 4. Limpeza das partes abandonadas.
  for (const k of [...objects.keys()].filter((r) => r.includes('/upload-'))) objects.get(k)!.createdAt = new Date(Date.now() - 3 * 3_600_000);
  const fresh = await up.beginReceiptUpload({ clinicId: A.clinicId, userId: A.doctorId, authorizationId, size: FILE.length, sha256: sha(FILE), declaredType: 'application/pdf' });
  await up.putReceiptChunk(store, await up.openReceiptUpload(fresh.token, { clinicId: A.clinicId, userId: A.doctorId }), 0, part(0));
  assert.equal(await up.sweepStaleReceiptUploads(store, A.clinicId), 3);
  assert.equal([...objects.keys()].filter((k) => k.includes('/upload-')).length, 1, 'a parte recente fica');
  assert.ok(objects.has(receiptRef));
  pass('limpeza: as 3 partes do envio abandonado (> 2 h) saem; a parte recente e o comprovante registrado ficam');

  console.log(`\n${passed}/4 provas do comprovante em partes (P6.3).`);
  assert.equal(passed, 4);
} finally {
  await cluster.stop();
}
