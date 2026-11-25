/**
 * B6 — retenção documental do Convênios em Postgres DESCARTÁVEL (cadeia do DEV), dados sintéticos:
 *
 *   1. inventário por paciente: guia, arquivo do lote (marcado como compartilhado), carteirinha ligada à guia;
 *      só metadados (nenhum conteúdo de guia, nenhum número de carteirinha);
 *   2. simulação de vencimento: hoje "dentro do prazo"; simulando 2033, "revisão humana" — e NENHUMA linha muda
 *      (guias, snapshots, arquivos, carteirinhas, eventos, recebíveis);
 *   3. trava: descarte de guia bloqueado (fundamento não confirmado), mesmo com prazo vencido e termo;
 *   4. isolamento: a sessão da clínica B não vê o inventário do paciente da A;
 *   5. paciente com guia continua bloqueado para exclusão física pelo banco (a guia retém o documento).
 *
 *   SECURITY_PG_BIN=... PORT=55606 NODE_OPTIONS=--conditions=react-server npx tsx scripts/security/health-insurance-retention-db.ts
 */
import assert from 'node:assert/strict';

import { readDevOrderChain } from './dev-order-chain';
import { startScratchSchema } from './scratch-schema';

const PORT = Number(process.env.PORT ?? 55606);
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

const inv = await import('../../src/contexts/health-insurance/internal/retention-inventory');
const { assertDisposalAllowed, RetentionDisposalBlocked } = await import('../../src/lib/compliance/retention-catalog');
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

let passed = 0;
const pass = (msg: string) => {
  passed += 1;
  console.log(`PASS ${passed}: ${msg}`);
};
async function counts() {
  const [r] = await sql`select
      (select count(*)::int from public.hi_guides) as guides,
      (select count(*)::int from public.hi_guide_snapshots) as snapshots,
      (select count(*)::int from public.hi_files) as files,
      (select count(*)::int from public.hi_memberships) as memberships,
      (select count(*)::int from public.hi_account_events) as events,
      (select count(*)::int from public.lancamentos) as lancamentos,
      (select count(*)::int from public.patients) as patients`;
  return r;
}

try {
  await sql`GRANT SELECT ON public.clinics, public.profiles TO authenticated`;
  await fx.seedTerminology();
  const A = await fx.setupClinic('Retenção A');
  const B = await fx.setupClinic('Retenção B');
  const L = await fx.sentBatch(A, 1);
  const g = L.guides[0]!;
  const patientId = String((await sql`select patient_id from public.hi_guides where id = ${g}::uuid`)[0]!.patient_id);

  // ── 1. Inventário ─────────────────────────────────────────────────
  const today = new Date('2026-11-25T12:00:00Z');
  const i1 = await fx.asUser(A, (tx) => inv.readPatientTissInventoryTx(tx, A.clinicId, patientId, today));
  assert.deepEqual(i1.guides.map((x) => x.guideId), [g]);
  const batchXml = i1.files.find((f) => f.kind === 'batch_xml');
  assert.ok(batchXml, JSON.stringify(i1.files));
  assert.equal(batchXml.shared, true);
  assert.equal(batchXml.batchId, L.batchId);
  assert.match(batchXml.contentSha256, /^[0-9a-f]{64}$/u);
  assert.ok(i1.memberships.length >= 1 && i1.memberships.some((m) => m.linkedGuides >= 1));
  const serialized = JSON.stringify(i1);
  assert.ok(!serialized.includes(SYNTHETIC_CARD), 'o inventário não leva o número da carteirinha');
  assert.ok(!/cipher|encrypted/iu.test(serialized), 'o inventário não leva conteúdo cifrado');
  pass(`inventário do paciente: 1 guia, ${i1.files.length} arquivo(s) (XML do lote marcado como compartilhado, com SHA-256), carteirinha ligada à guia; nenhum conteúdo de guia nem número de carteirinha`);

  // ── 2. Simulação de vencimento sem efeito colateral ───────────────
  const before = await counts();
  assert.equal(i1.guides[0]!.retention.status, 'dentro_do_prazo');
  assert.equal(i1.guides[0]!.retention.descarteAutorizado, false);
  const i2033 = await fx.asUser(A, (tx) => inv.readPatientTissInventoryTx(tx, A.clinicId, patientId, new Date('2033-06-01T00:00:00Z')));
  assert.equal(i2033.guides[0]!.retention.status, 'revisao_humana');
  assert.equal(i2033.guides[0]!.retention.descarteAutorizado, false);
  assert.match(i2033.guides[0]!.retention.motivo, /pendência/u);
  assert.deepEqual(await counts(), before);
  pass(`simulação: hoje "dentro do prazo" (até ${i1.guides[0]!.retention.elegivelEm?.slice(0, 10)}); em 2033 "revisão humana" com a pendência; nenhuma linha mudou (${JSON.stringify(before)})`);

  // ── 3. Trava de descarte ──────────────────────────────────────────
  assert.throws(
    () => assertDisposalAllowed({ categoria: 'guia_tiss', marco: new Date('2020-01-01T00:00:00Z'), now: new Date('2040-01-01T00:00:00Z'), termo: { aprovadoPor: 'gestão', referencia: 'T-1' } }),
    RetentionDisposalBlocked,
  );
  pass('trava: descarte de guia recusado por fundamento não confirmado, mesmo com prazo vencido e termo humano');

  // ── 4. Isolamento ─────────────────────────────────────────────────
  const iB = await fx.asUser(B, (tx) => inv.readPatientTissInventoryTx(tx, A.clinicId, patientId, today));
  assert.deepEqual([iB.guides.length, iB.files.length, iB.memberships.length], [0, 0, 0]);
  pass('isolamento: a sessão da clínica B, passando o id da clínica e do paciente da A, não vê guia, arquivo nem carteirinha');

  // ── 5. O banco segura a exclusão física do paciente com guia ──────
  await assert.rejects(
    () => sql`delete from public.patients where id = ${patientId}::uuid`,
    (e: unknown) => (e as { code?: string }).code === '23503',
  );
  assert.deepEqual(await counts(), before);
  pass('paciente com guia: exclusão física recusada pelo banco (23503); a guia e os arquivos ficam (o caminho LGPD anonimiza o cadastro)');

  console.log(`\n${passed}/5 provas de retenção (B6) passaram.`);
  assert.equal(passed, 5);
} finally {
  await cluster.stop();
}
