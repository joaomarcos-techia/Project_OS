/**
 * Convênios: interruptor do módulo (`hi_clinic_settings.enabled`) × operações, em Postgres
 * DESCARTÁVEL (cadeia na ordem do DEV), com dados sintéticos. Nunca no DEV compartilhado.
 *
 * Política já aprovada (ADR-072 item 10; bloqueio-comercial-trial.md: "assinatura paga com o
 * módulo desligado não opera Convênios"; diretriz do fundador de 15/11) e o parecer em
 * docs/convenios/modulo-desligado.md:
 *   - classe A (cria ou avança trabalho TISS): recusada com o módulo desligado, mesmo com a
 *     assinatura paga e ativa, sem tocar em nada;
 *   - classe C (preservação de obrigação já faturada e encerramento): continua com o módulo
 *     desligado — cancelar guia não enviada, glosa e pagamento do lote já enviado, leitura;
 *   - a decisão comercial vem primeiro (no trial, a resposta é a comercial);
 *   - religado, a mesma operação passa (a recusa não consumiu nada).
 *
 *   NODE_OPTIONS=--conditions=react-server npx tsx scripts/security/health-insurance-module-switch-db.ts
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { readDevOrderChain } from './dev-order-chain';
import { startScratchSchema } from './scratch-schema';

const PORT = Number(process.env.PORT ?? 55551);
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

const acct = await import('../../src/contexts/health-insurance/internal/insurance-account-service');
const { issueConsultaGuide } = await import('../../src/contexts/health-insurance/internal/guide-issuance');
const { updateConsultaOverridesInTx } = await import('../../src/contexts/health-insurance/internal/consulta-overrides-service');
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
const pass = (msg: string) => {
  passed += 1;
  console.log(`PASS: ${msg}`);
};
const outcome = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
    return 'aceitou';
  } catch (e) {
    const err = e as { name?: string; reason?: string };
    if (err.name === 'ConveniosModuleDisabledError') return 'module_disabled';
    if (err.name === 'PremiumAccessError') return `premium:${err.reason}`;
    throw e;
  }
};
const setModule = (c: Clinic, on: boolean) =>
  sql`update public.hi_clinic_settings set enabled = ${on} where clinic_id = ${c.clinicId}::uuid`;
const guideRow = async (id: string) =>
  (await sql`select status, version, revision, membership_id, consulta_overrides from public.hi_guides where id = ${id}::uuid`)[0]!;
/** Guia aprovada reaberta (nota obrigatória) e, se pedido, conferida de novo: alvo de emissão ou ajuste. */
async function reopened(c: Clinic, toReviewed: boolean): Promise<string> {
  const g = await c.approvedGuide();
  await fx.asUser(c, (tx) =>
    tx.execute(fx.sqlTag`update public.hi_guides set status = 'ready_for_review', transition_note = 'Reaberta para a prova do módulo' where id = ${g}::uuid`),
  );
  if (toReviewed) {
    await fx.asUser(c, (tx) =>
      tx.execute(fx.sqlTag`update public.hi_guides set status = 'reviewed', reviewed_by = ${c.doctorId}::uuid where id = ${g}::uuid`),
    );
  }
  return g;
}
const issue = async (c: Clinic, guideId: string) => {
  const row = await guideRow(guideId);
  return fx.asUser(c, (tx) =>
    issueConsultaGuide(tx, {
      clinicId: c.clinicId,
      guideId,
      card: { membershipId: String(row.membership_id), cardNumber: SYNTHETIC_CARD, auditEventId: 'leitura-auditada-simulada' },
      newborn: false,
      professionalName: 'Dra. Sintética',
      actorUserId: c.doctorId,
      today: '2026-12-31',
    }),
  );
};
const editOverrides = async (c: Clinic, guideId: string) => {
  const row = await guideRow(guideId);
  return fx.asUser(c, (tx) =>
    updateConsultaOverridesInTx(tx, { clinicId: c.clinicId, guideId, version: Number(row.version), input: { tipoConsulta: '1' } }),
  );
};

try {
  await sql`GRANT SELECT ON public.clinics, public.profiles TO authenticated`;
  await fx.seedTerminology();
  const A = await fx.setupClinic('Módulo desligado');

  // Preparado com o módulo LIGADO: um lote já enviado (obrigação faturada), uma guia aprovada fora
  // de lote, um lote exportado ainda não enviado, uma guia conferida e uma guia em edição.
  const L = await fx.sentBatch(A, 2);
  const gLoose = await A.approvedGuide();
  const gCancel = await A.approvedGuide();
  const gExp = await A.approvedGuide();
  const bExp = await fx.createBatch(A, [gExp]);
  const outExp = await fx.exportBatch(A, bExp);
  assert.equal(outExp.kind, 'exported');
  const gReviewed = await reopened(A, true);
  const gEditing = await reopened(A, false);

  // ── 1. Módulo DESLIGADO com assinatura paga e ativa: classe A recusada, nada tocado ─────────
  await setModule(A, false);
  const before = {
    batches: Number((await sql`select count(*)::int as n from public.hi_batches where clinic_id = ${A.clinicId}::uuid`)[0]!.n),
    reviewed: await guideRow(gReviewed),
    editing: await guideRow(gEditing),
    exported: (await sql`select status, version from public.hi_batches where id = ${bExp}::uuid`)[0],
  };
  const classA = {
    montarLote: await outcome(fx.createBatch(A, [gLoose])),
    enviarLote: await outcome(
      fx.asUser(A, async (tx) =>
        fx.batches.markBatchSentInTx(tx, { clinicId: A.clinicId, batchId: bExp, version: await fx.batchVersion(bExp), channel: 'manual', sentOn: '2026-11-11', evidence: 'Enviado pelo portal da operadora, comprovante sintético' }),
      ),
    ),
    emitir: await outcome(issue(A, gReviewed)),
    ajustarConsulta: await outcome(editOverrides(A, gEditing)),
  };
  assert.deepEqual(classA, { montarLote: 'module_disabled', enviarLote: 'module_disabled', emitir: 'module_disabled', ajustarConsulta: 'module_disabled' });
  assert.equal(Number((await sql`select count(*)::int as n from public.hi_batches where clinic_id = ${A.clinicId}::uuid`)[0]!.n), before.batches);
  assert.deepEqual(await guideRow(gReviewed), before.reviewed);
  assert.deepEqual(await guideRow(gEditing), before.editing);
  assert.deepEqual((await sql`select status, version from public.hi_batches where id = ${bExp}::uuid`)[0], before.exported);
  pass('1. módulo desligado com assinatura ativa: montar lote, enviar lote, emitir guia e ajustar a Consulta são recusados (classe A), sem criar lote nem mudar guia ou lote');

  // ── 2. Classe C continua com o módulo desligado ──────────────────────────────────────────
  const vCancel = Number((await guideRow(gCancel)).version);
  await fx.asUser(A, (tx) =>
    tx.execute(fx.sqlTag`update public.hi_guides set status = 'cancelled', cancel_reason = 'Atendimento não será faturado', cancelled_by = ${A.doctorId}::uuid
      where clinic_id = ${A.clinicId}::uuid and id = ${gCancel}::uuid and version = ${vCancel}`),
  );
  assert.equal((await guideRow(gCancel)).status, 'cancelled');
  const [g1] = L.guides as [string, string];
  const glossId = await fx.asSystem(A, (tx) =>
    acct.recordGlossInTx(tx, {
      clinicId: A.clinicId, batchId: L.batchId, guideId: g1, code: '1705', amountCents: 1000, source: 'statement',
      returnId: L.analysisReturn, idempotencyKey: `dem:${L.analysisReturn}:${g1}:1705:1000`,
    }),
  );
  assert.ok(glossId, 'glosa do demonstrativo registrada');
  await fx.asUser(A, (tx) =>
    acct.recordPaymentInTx(tx, {
      clinicId: A.clinicId, insurerId: A.insurerId, paidOn: '2026-11-11', amountCents: 5000, source: 'manual',
      idempotencyKey: `pg-${randomUUID()}`, allocations: [{ guideId: g1, batchId: L.batchId, amountCents: 5000 }],
    } as Parameters<typeof acct.recordPaymentInTx>[1]),
  );
  const contents = await fx.contentsOf(A, L.batchId);
  assert.equal(contents.length, 2, 'o conteúdo emitido continua legível');
  pass('2. com o módulo desligado continuam: cancelar guia não enviada, glosa e pagamento do lote já enviado (preservação) e a leitura do conteúdo emitido');

  // ── 3. A decisão comercial vem primeiro ─────────────────────────────────────────────────
  await sql`update public.subscriptions set billing_status = 'trial', trial_ends_at = now() + interval '10 days',
      enforce_trial_deadline = true where clinic_id = ${A.clinicId}::uuid`;
  assert.equal(await outcome(fx.createBatch(A, [gLoose])), 'premium:trial');
  await sql`update public.subscriptions set billing_status = 'active', trial_ends_at = null,
      enforce_trial_deadline = false where clinic_id = ${A.clinicId}::uuid`;
  pass('3. trial com o módulo desligado: a resposta é a comercial (contrate), não a do módulo');

  // ── 4. Religado: a mesma operação passa ─────────────────────────────────────────────────
  await setModule(A, true);
  assert.equal(await outcome(fx.createBatch(A, [gLoose])), 'aceitou');
  assert.equal(await outcome(editOverrides(A, gEditing)), 'aceitou');
  pass('4. módulo religado: montar o lote e ajustar a Consulta passam (a recusa não consumiu nada)');

  console.log(`\nOK — ${passed}/4 provas do interruptor do módulo (classes A e C).`);
  assert.equal(passed, 4);
} finally {
  await cluster.stop();
}
