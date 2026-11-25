/**
 * Convênios: o interruptor do módulo também nos gatilhos do banco — migration 0164
 * (drizzle/migrations/0164_hi_module_switch_guard.sql, autorizada para o DEV em 16/11; era a
 * candidata sem número provada 9/9), em Postgres DESCARTÁVEL com dados sintéticos. A prova monta a
 * cadeia do DEV SEM a 0164 e aplica o arquivo final por cima. Nunca no DEV compartilhado.
 *
 * O que precisa ficar provado antes de pedir a aplicação (modulo-desligado.md §7):
 *   1. a candidata aplica depois da cadeia do DEV e é reaplicável;
 *   2. cada tipo de `hi_files` está classificado (operação nova × preservação) e os gatilhos
 *      novos disparam depois do D24 e antes das validações de cada tabela;
 *   3. com o módulo desligado e a assinatura ativa, a classe A é recusada MESMO por caminho
 *      direto (SQL do dono e funções do banco chamadas sem o serviço);
 *   4. com o módulo desligado, a recuperação e a preservação continuam: cancelar guia,
 *      devolver, reabrir, cancelar lote exportado (guias voltam a "aprovada"), retorno da
 *      operadora, glosa, pagamento, resposta de autorização; tabelas de obrigação sem gatilho;
 *   5. no trial, a resposta continua sendo a comercial;
 *   6. o serviço continua respondendo primeiro, com a mensagem do módulo;
 *   7. restauração (replica) e backfill (gatilho desligado nominalmente) passam;
 *   8. religado, a classe A volta a passar;
 *   9. a reversão do cabeçalho remove tudo e a candidata reaplica.
 *
 *   SECURITY_PG_BIN=... PORT=55552 NODE_OPTIONS=--conditions=react-server \
 *     npx tsx scripts/security/health-insurance-module-switch-triggers-db.ts
 */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { readDevOrderChain } from './dev-order-chain';
import { startScratchSchema } from './scratch-schema';

const MIGRATION_FILE = '0164_hi_module_switch_guard.sql';
const CANDIDATE = `drizzle/migrations/${MIGRATION_FILE}`;
const PORT = Number(process.env.PORT ?? 55552);
const body = await readFile(CANDIDATE, 'utf8');
const rollback = body
  .split('\n')
  .filter((l) => /^--\s+DROP (TRIGGER|FUNCTION) IF EXISTS /u.test(l))
  .map((l) => l.replace(/^--\s+/u, ''));
assert.equal(rollback.length, 9, 'a reversão do cabeçalho lista 8 gatilhos e a função');

const chain = (await readDevOrderChain()).filter((m) => m.file < MIGRATION_FILE);
assert.ok(!chain.some((m) => m.file.startsWith('0164_')), 'a 0164 entra por cima, não na cadeia');
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
const auths = await import('../../src/contexts/health-insurance/internal/authorizations');
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

const MODULE = '55000:hi_module_enabled';
const PREMIUM = '23514:qoro_premium_health_insurance';
const ADVANCING_KINDS = ['batch_xml', 'authorization_request_xml', 'authorization_request_pdf'];
const PRESERVING_KINDS = ['guide_pdf', 'batch_return', 'gloss_appeal_xml'];
const GUARDED = ['hi_guides', 'hi_guide_snapshots', 'hi_batches', 'hi_files', 'hi_authorizations', 'hi_sadt_requests', 'hi_appointment_coverages', 'hi_copayments'];
const OBLIGATIONS = ['hi_glosses', 'hi_payments', 'hi_payment_allocations', 'hi_account_events', 'hi_payouts', 'hi_payout_movements', 'hi_authorization_events', 'hi_authorization_attachments', 'hi_batch_returns', 'hi_memberships'];

let passed = 0;
const pass = (msg: string) => {
  passed += 1;
  console.log(`PASS: ${msg}`);
};
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
type PgErr = { code?: string; constraint_name?: string; cause?: PgErr; name?: string; reason?: string };
/** Resultado de uma operação: 'aceitou', 'SQLSTATE:constraint' (erro do banco) ou a recusa do serviço. */
const outcome = async (run: () => Promise<unknown>): Promise<string> => {
  try {
    await run();
    return 'aceitou';
  } catch (e) {
    const err = e as PgErr;
    if (err.name === 'ConveniosModuleDisabledError') return 'module_disabled';
    if (err.name === 'PremiumAccessError') return `premium:${err.reason}`;
    const pg = err.code ? err : err.cause?.code ? err.cause : null;
    if (pg) return `${pg.code}:${pg.constraint_name ?? ''}`;
    throw e;
  }
};
/** Comando do dono (superusuário do cluster descartável): o caminho de script, migration ou função do banco. */
const asOwner = (stmt: string) => () => sql.begin(async (tx) => { await tx.unsafe(stmt); });
const setModule = (c: Clinic, on: boolean) =>
  sql`update public.hi_clinic_settings set enabled = ${on} where clinic_id = ${c.clinicId}::uuid`;
const guideRow = async (id: string) =>
  (await sql`select status, version, membership_id from public.hi_guides where id = ${id}::uuid`)[0]!;
const batchRow = async (id: string) => (await sql`select status, version from public.hi_batches where id = ${id}::uuid`)[0]!;
const applyCandidate = () => sql.begin(async (tx) => { await tx.unsafe(body); });
const moduleTriggers = async () =>
  (await sql`select tgrelid::regclass::text as t, tgname from pg_trigger where tgname like 'hi_ab_module_%' and not tgisinternal order by 1, 2`).map(
    (r) => `${String(r.t)}:${String(r.tgname)}`,
  );
const userUpdate = (c: Clinic, stmt: ReturnType<typeof fx.sqlTag>) => () => fx.asUser(c, (tx) => tx.execute(stmt));
async function reopened(c: Clinic, toReviewed: boolean): Promise<string> {
  const g = await c.approvedGuide();
  await fx.asUser(c, (tx) =>
    tx.execute(fx.sqlTag`update public.hi_guides set status = 'ready_for_review', transition_note = 'Reaberta para a prova dos gatilhos' where id = ${g}::uuid`),
  );
  if (toReviewed) {
    await fx.asUser(c, (tx) =>
      tx.execute(fx.sqlTag`update public.hi_guides set status = 'reviewed', reviewed_by = ${c.doctorId}::uuid where id = ${g}::uuid`),
    );
  }
  return g;
}
/** Lote real até "em análise", SEM retorno registrado (o retorno é a prova da preservação). */
async function underReviewBatch(c: Clinic): Promise<string> {
  const g = await c.approvedGuide();
  const batchId = await fx.createBatch(c, [g]);
  const out = await fx.exportBatch(c, batchId);
  assert.equal(out.kind, 'exported');
  const exported = await fx.batchVersion(batchId);
  let v = await fx.asUser(c, (tx) =>
    fx.batches.markBatchSentInTx(tx, { clinicId: c.clinicId, batchId, version: exported, channel: 'manual', sentOn: '2026-11-11', evidence: 'Enviado pelo portal da operadora, comprovante sintético' }),
  );
  v = await fx.asUser(c, (tx) =>
    fx.batches.recordBatchProtocolInTx(tx, { clinicId: c.clinicId, batchId, version: v, protocol: `PROT-${batchId.slice(0, 8)}`, receivedOn: '2026-11-11', evidenceSha256: sha(`recibo-${batchId}`) }),
  );
  await fx.asUser(c, (tx) => fx.batches.markBatchUnderReviewInTx(tx, { clinicId: c.clinicId, batchId, version: v }));
  return batchId;
}

try {
  await sql`GRANT SELECT ON public.clinics, public.profiles TO authenticated`;
  await fx.seedTerminology();

  // ── 1. Aplica depois da cadeia do DEV e reaplica sem mudar nada ─────────────────────────
  assert.deepEqual(await moduleTriggers(), [], 'nenhum gatilho do módulo antes da candidata');
  await applyCandidate();
  const triggers = await moduleTriggers();
  assert.equal(triggers.length, 8);
  await applyCandidate();
  assert.deepEqual(await moduleTriggers(), triggers);
  pass(`1. a candidata aplica depois da cadeia do DEV e reaplica sem mudança: ${triggers.length} gatilhos hi_ab_module_* e a função hi_module_guard`);

  // ── 2. Classificação completa e ordem dos gatilhos ───────────────────────────────────────
  const [kindDef] = await sql`select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'hi_files_kind_chk'`;
  const kinds = [...String(kindDef!.def).matchAll(/'([a-z_]+)'/gu)].map((m) => m[1]!).sort();
  assert.deepEqual(kinds, [...ADVANCING_KINDS, ...PRESERVING_KINDS].sort(), 'todo tipo de hi_files classificado (operação nova × preservação)');
  for (const table of GUARDED) {
    // O Postgres dispara os gatilhos BEFORE ROW em ordem de bytes do nome (não pela collation do
    // cluster): a comparação é feita aqui, em JS, que compara por código como o servidor.
    const rows = await sql`select tgname::text as n from pg_trigger
      where tgrelid = ${`public.${table}`}::regclass and not tgisinternal and (tgtype & 2) = 2`;
    const mine = `hi_ab_module_`;
    for (const n of rows.map((r) => String(r.n)).filter((n) => n < mine)) {
      assert.match(n, /^(hi_aa_premium_|a0_hi_premium_)/u, `${table}: só o D24 dispara antes do módulo (achou ${n})`);
    }
  }
  const obligations = await sql`select tgrelid::regclass::text as t from pg_trigger
    where tgname like 'hi_ab_module_%' and tgrelid::regclass::text = any(${OBLIGATIONS.map((t) => `${t}`)})`;
  assert.equal(obligations.length, 0, 'tabelas de obrigação e de preservação sem gatilho do módulo');
  pass(`2. os ${kinds.length} tipos de hi_files estão classificados (${ADVANCING_KINDS.length} de operação nova); nas ${GUARDED.length} tabelas da classe A só o D24 dispara antes do módulo; glosas, pagamentos, alocações, conta da guia, repasses, eventos e comprovantes de autorização, retornos e carteirinhas ficam sem gatilho do módulo`);

  // Preparado com o módulo LIGADO.
  const A = await fx.setupClinic('Gatilhos do módulo');
  const L = await fx.sentBatch(A, 1);
  const RB = await underReviewBatch(A);
  const gLoose = await A.approvedGuide();
  const gCancel = await A.approvedGuide();
  const gExp = await A.approvedGuide();
  const bExp = await fx.createBatch(A, [gExp]);
  assert.equal((await fx.exportBatch(A, bExp)).kind, 'exported');
  const gReviewed = await reopened(A, true);
  const gEditing = await reopened(A, false);
  const gReopen = await A.approvedGuide();
  const card = String((await guideRow(gLoose)).membership_id);
  const { authorizationId } = await fx.asUser(A, (tx) =>
    auths.requestManualAuthorizationTx(tx, {
      clinicId: A.clinicId, insurerId: A.insurerId, membershipId: card, requestedOn: '2026-11-10',
      items: [{ tableCode: '22', procedureCode: '10101012', quantityRequested: 1 }], actorUserId: A.doctorId,
    }),
  );

  // ── 3. Módulo DESLIGADO, assinatura ativa: classe A recusada mesmo por caminho direto ─────
  await setModule(A, false);
  const snapshot = async () => ({
    batches: Number((await sql`select count(*)::int as n from public.hi_batches where clinic_id = ${A.clinicId}::uuid`)[0]!.n),
    guides: Number((await sql`select count(*)::int as n from public.hi_guides where clinic_id = ${A.clinicId}::uuid`)[0]!.n),
    files: Number((await sql`select count(*)::int as n from public.hi_files where clinic_id = ${A.clinicId}::uuid`)[0]!.n),
    auths: Number((await sql`select count(*)::int as n from public.hi_authorizations where clinic_id = ${A.clinicId}::uuid`)[0]!.n),
    reviewed: await guideRow(gReviewed),
    editing: await guideRow(gEditing),
    exported: await batchRow(bExp),
  });
  const before3 = await snapshot();
  const C = A.clinicId;
  const direct = {
    novaGuia: await outcome(asOwner(`insert into public.hi_guides (clinic_id, guide_type) values ('${C}', 'consulta')`)),
    snapshot: await outcome(asOwner(`insert into public.hi_guide_snapshots (clinic_id, guide_id, revision) values ('${C}', '${gReviewed}', 1)`)),
    novoLote: await outcome(asOwner(`insert into public.hi_batches (clinic_id, insurer_id) values ('${C}', '${A.insurerId}')`)),
    xmlLote: await outcome(asOwner(`insert into public.hi_files (clinic_id, kind) values ('${C}', 'batch_xml')`)),
    xmlPedido: await outcome(asOwner(`insert into public.hi_files (clinic_id, kind) values ('${C}', 'authorization_request_xml')`)),
    pdfPedido: await outcome(asOwner(`insert into public.hi_files (clinic_id, kind) values ('${C}', 'authorization_request_pdf')`)),
    pedidoAutorizacao: await outcome(asOwner(`insert into public.hi_authorizations (clinic_id, insurer_id, guide_type, status, origin) values ('${C}', '${A.insurerId}', 'consulta', 'requested', 'manual')`)),
    solicitacaoSadt: await outcome(asOwner(`insert into public.hi_sadt_requests (clinic_id) values ('${C}')`)),
    cobertura: await outcome(asOwner(`insert into public.hi_appointment_coverages (clinic_id) values ('${C}')`)),
    conferir: await outcome(userUpdate(A, fx.sqlTag`update public.hi_guides set status = 'reviewed', reviewed_by = ${A.doctorId}::uuid where id = ${gEditing}::uuid`)),
    aprovar: await outcome(asOwner(`update public.hi_guides set status = 'approved' where id = '${gReviewed}'`)),
    ajustarConsulta: await outcome(asOwner(`update public.hi_guides set consulta_overrides = '{"tipoConsulta":"1"}'::jsonb where id = '${gEditing}'`)),
    enviarLoteDono: await outcome(asOwner(`update public.hi_batches set status = 'sent' where id = '${bExp}'`)),
    criarLotePelaFuncao: await outcome(userUpdate(A, fx.sqlTag`select public.hi_batch_create(${C}::uuid, ${A.insurerId}::uuid, 'consulta', ${`{${gLoose}}`}::uuid[], ${`direto-${randomUUID()}`})`)),
    enviarLotePelaFuncao: await outcome(userUpdate(A, fx.sqlTag`select public.hi_batch_mark_sent(${C}::uuid, ${bExp}::uuid, ${Number(before3.exported.version)}, 'manual', '2026-11-11'::date, 'Enviado pelo portal da operadora, comprovante sintético')`)),
  };
  for (const [op, got] of Object.entries(direct)) assert.equal(got, MODULE, `${op}: esperado ${MODULE}, veio ${got}`);
  assert.deepEqual(await snapshot(), before3, 'nada foi criado nem mudado');
  pass(`3. módulo desligado com assinatura ativa: ${Object.keys(direct).length} operações da classe A recusadas pelo banco com 55000/hi_module_enabled mesmo sem o serviço (SQL do dono, sessão da clínica e as funções hi_batch_create e hi_batch_mark_sent chamadas direto): nova guia, snapshot, lote, XML do lote, XML e PDF do pedido, pedido de autorização, solicitação SP/SADT, cobertura, conferir, aprovar, ajustar a Consulta e enviar lote; nenhuma linha criada ou mudada`);

  // ── 4. Módulo desligado: recuperação e preservação continuam ────────────────────────────
  const vCancel = Number((await guideRow(gCancel)).version);
  assert.equal(await outcome(userUpdate(A, fx.sqlTag`update public.hi_guides set status = 'cancelled', cancel_reason = 'Atendimento não será faturado', cancelled_by = ${A.doctorId}::uuid where id = ${gCancel}::uuid and version = ${vCancel}`)), 'aceitou');
  assert.equal(await outcome(userUpdate(A, fx.sqlTag`update public.hi_guides set status = 'ready_for_review' where id = ${gReviewed}::uuid`)), 'aceitou');
  assert.equal(await outcome(userUpdate(A, fx.sqlTag`update public.hi_guides set status = 'ready_for_review', transition_note = 'Reaberta com o módulo desligado' where id = ${gReopen}::uuid`)), 'aceitou');
  assert.equal(await outcome(() => fx.asUser(A, async (tx) => fx.batches.cancelBatchInTx(tx, { clinicId: C, batchId: bExp, version: Number((await batchRow(bExp)).version), reason: 'Lote cancelado com o módulo desligado' }))), 'aceitou');
  assert.equal((await batchRow(bExp)).status, 'cancelled');
  assert.equal((await guideRow(gExp)).status, 'approved', 'a guia do lote cancelado volta a "aprovada" (exported → approved não é barrado)');
  assert.equal(await outcome(() => fx.asUser(A, (tx) => fx.batches.recordBatchReturnInTx(tx, { clinicId: C, batchId: RB, kind: 'analysis_statement', contentSha256: sha(`analise-${RB}`), receivedOn: '2026-11-20' }))), 'aceitou');
  assert.equal(await outcome(asOwner(`insert into public.hi_files (clinic_id, kind, batch_id, storage_ref, content_sha256, ciphertext_sha256, size_bytes, media_type, tiss_version, created_via, created_by)
      values ('${C}', 'batch_return', '${RB}', '${C}/${randomUUID()}', '${sha('retorno')}', '${sha('cifrado')}', 10, 'application/xml', '4.03.00', 'user', '${A.doctorId}')`)), 'aceitou');
  const [g1] = L.guides as [string];
  assert.equal(await outcome(() => fx.asSystem(A, (tx) => acct.recordGlossInTx(tx, {
    clinicId: C, batchId: L.batchId, guideId: g1, code: '1705', amountCents: 1000, source: 'statement',
    returnId: L.analysisReturn, idempotencyKey: `dem:${L.analysisReturn}:${g1}:1705:1000`,
  }))), 'aceitou');
  assert.equal(await outcome(() => fx.asUser(A, (tx) => acct.recordPaymentInTx(tx, {
    clinicId: C, insurerId: A.insurerId, paidOn: '2026-11-11', amountCents: 5000, source: 'manual',
    idempotencyKey: `pg-${randomUUID()}`, allocations: [{ guideId: g1, batchId: L.batchId, amountCents: 5000 }],
  } as Parameters<typeof acct.recordPaymentInTx>[1]))), 'aceitou');
  // Classe C pelo SERVIÇO (decisão de 16/11): a resposta da operadora à Consulta já pedida passa com o módulo desligado.
  const [{ version: authVersion }] = (await sql`select version from public.hi_authorizations where id = ${authorizationId}::uuid`) as unknown as [{ version: number }];
  assert.equal(await outcome(() => fx.asUser(A, (tx) => auths.recordManualAuthorizationResponseTx(tx, {
    decision: 'denied', clinicId: C, authorizationId, version: Number(authVersion), denialReason: 'Negada pela operadora (sintético)', actorUserId: A.doctorId,
  }))), 'aceitou');
  assert.equal(await outcome(() => setModule(A, false)), 'aceitou');
  pass('4. com o módulo desligado continuam no banco: cancelar guia, devolver para correção, reabrir guia aprovada, cancelar lote exportado (a guia volta a "aprovada"), retorno da operadora (registro e arquivo batch_return), glosa, pagamento com alocação e a resposta da operadora à autorização de Consulta pelo SERVIÇO (classe C, decisão de 16/11)');

  // ── 5. A decisão comercial vem primeiro ─────────────────────────────────────────────────
  await sql`update public.subscriptions set billing_status = 'trial', trial_ends_at = now() + interval '10 days',
      enforce_trial_deadline = true where clinic_id = ${C}::uuid`;
  assert.equal(await outcome(asOwner(`insert into public.hi_authorizations (clinic_id, insurer_id, guide_type, status, origin) values ('${C}', '${A.insurerId}', 'consulta', 'requested', 'manual')`)), PREMIUM);
  assert.equal(await outcome(() => fx.createBatch(A, [gLoose])), 'premium:trial');
  await sql`update public.subscriptions set billing_status = 'active', trial_ends_at = null,
      enforce_trial_deadline = false where clinic_id = ${C}::uuid`;
  pass('5. trial com o módulo desligado: o banco responde a restrição comercial (23514), não a do módulo; o serviço também');

  // ── 6. O serviço continua respondendo primeiro (a mensagem da tela não muda) ─────────────
  assert.equal(await outcome(() => fx.createBatch(A, [gLoose])), 'module_disabled');
  // O PEDIDO novo de autorização continua classe A (a resposta é que é preservação).
  assert.equal(await outcome(() => fx.asUser(A, (tx) => auths.requestManualAuthorizationTx(tx, {
    clinicId: C, insurerId: A.insurerId, membershipId: card, requestedOn: '2026-11-10',
    items: [{ tableCode: '22', procedureCode: '10101012', quantityRequested: 1 }], actorUserId: A.doctorId,
  }))), 'module_disabled');
  pass('6. pelo serviço, a recusa continua sendo ConveniosModuleDisabledError (mensagem do módulo), antes de chegar ao gatilho: montar lote e PEDIR autorização (a resposta da operadora é classe C e passou na prova 4)');

  // ── 7. Restauração e backfill: caminhos documentados passam ─────────────────────────────
  const restored = await outcome(() =>
    sql.begin(async (tx) => {
      await tx.unsafe(`set local session_replication_role = replica`);
      // Em replica NENHUM gatilho roda (nem o que preenche reviewed_at), mas os CHECKs continuam:
      // a linha vem completa, como numa restauração de verdade (execução 43785054810).
      await tx.unsafe(`update public.hi_guides set status = 'reviewed', reviewed_by = '${A.doctorId}', reviewed_at = now() where id = '${gEditing}'`);
      throw Object.assign(new Error('desfaz'), { code: 'ROLLBACK_OK', constraint_name: 'replica' });
    }),
  );
  assert.equal(restored, 'ROLLBACK_OK:replica', 'em replica a linha passou (desfeita em seguida)');
  const backfill = await outcome(() =>
    sql.begin(async (tx) => {
      await tx.unsafe(`alter table public.hi_guides disable trigger hi_ab_module_guides`);
      await tx.unsafe(`update public.hi_guides set status = 'reviewed', reviewed_by = '${A.doctorId}' where id = '${gEditing}'`);
      throw Object.assign(new Error('desfaz'), { code: 'ROLLBACK_OK', constraint_name: 'backfill' });
    }),
  );
  assert.equal(backfill, 'ROLLBACK_OK:backfill', 'com o gatilho desligado nominalmente a linha passou (desfeita em seguida)');
  assert.equal((await guideRow(gEditing)).status, 'ready_for_review', 'as duas provas foram desfeitas');
  assert.equal((await sql`select tgenabled from pg_trigger where tgname = 'hi_ab_module_guides'`)[0]!.tgenabled, 'O', 'o gatilho continua ligado');
  pass('7. restauração com session_replication_role = replica e backfill com o gatilho desligado nominalmente (ALTER TABLE ... DISABLE TRIGGER na própria transação) passam; o gatilho continua ligado depois');

  // ── 8. Religado: a classe A volta a passar ──────────────────────────────────────────────
  await setModule(A, true);
  assert.equal(await outcome(userUpdate(A, fx.sqlTag`update public.hi_guides set status = 'reviewed', reviewed_by = ${A.doctorId}::uuid where id = ${gEditing}::uuid`)), 'aceitou');
  assert.equal(await outcome(() => fx.createBatch(A, [gLoose])), 'aceitou');
  pass('8. módulo religado: conferir por SQL direto e montar lote pelo serviço passam (a recusa não consumiu nada)');

  // ── 9. Reversão do cabeçalho e reaplicação ──────────────────────────────────────────────
  await sql.begin(async (tx) => {
    for (const s of rollback) await tx.unsafe(s);
  });
  assert.deepEqual(await moduleTriggers(), []);
  assert.equal(Number((await sql`select count(*)::int as n from pg_proc where proname = 'hi_module_guard'`)[0]!.n), 0);
  await setModule(A, false);
  assert.equal(await outcome(asOwner(`update public.hi_guides set status = 'ready_for_review' where id = '${gEditing}'`)), 'aceitou');
  assert.equal(await outcome(asOwner(`update public.hi_guides set status = 'reviewed', reviewed_by = '${A.doctorId}' where id = '${gEditing}'`)), 'aceitou', 'sem a candidata, o banco volta a não olhar o interruptor');
  await applyCandidate();
  assert.deepEqual(await moduleTriggers(), triggers);
  pass('9. a reversão do cabeçalho remove os 8 gatilhos e a função (o banco volta ao comportamento de hoje) e a candidata reaplica igual');

  console.log(`\nOK — ${passed}/9 provas dos gatilhos do módulo (migration 0164, arquivo final; aplicada no DEV em 16/11).`);
  assert.equal(passed, 9);
} finally {
  await cluster.stop();
}
