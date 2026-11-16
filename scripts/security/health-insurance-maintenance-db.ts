/**
 * Convênios P6.6/P12.6 — manutenção chamada no fim do `financial-reconcile`, em Postgres DESCARTÁVEL
 * (cadeia do DEV), dados sintéticos. Nunca no DEV compartilhado.
 *
 *   1. vence a autorização cuja senha venceu (data da clínica), com o histórico; a que vence amanhã
 *      fica concedida e entra no resumo como "senha vencendo";
 *   2. idempotência: a segunda execução não vence nada de novo nem repete o histórico;
 *   3. resumo diário só com contagens (senha vencendo, pedido parado há mais de 3 dias, revisões,
 *      cancelamentos), por clínica certa; métricas sem nenhum identificador;
 *   4. isolamento: a clínica B não é tocada pela A (a falha isolada por clínica está nos unitários);
 *   5. sem tempo: as clínicas ficam adiadas, sem efeito parcial;
 *   6. a leitura privilegiada (auditoria §4): a varredura entre clínicas devolve só `clinic_id` das
 *      clínicas com Convênios instalado (ligado ou desligado), respeita o LIMIT, e a rodada sem lista
 *      explícita processa cada uma sob RLS sem falhar com o módulo desligado.
 *
 *   SECURITY_PG_BIN=... PORT=55555 NODE_OPTIONS=--conditions=react-server \
 *     npx tsx scripts/security/health-insurance-maintenance-db.ts
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { readDevOrderChain } from './dev-order-chain';
import { startScratchSchema } from './scratch-schema';

const PORT = Number(process.env.PORT ?? 55555);
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

const { metrics } = await import('../../src/lib/observability/metrics');
const auths = await import('../../src/contexts/health-insurance/internal/authorizations');
const maint = await import('../../src/contexts/health-insurance/maintenance');
const { listInsuranceMaintenanceClinics } = await import('../../src/contexts/health-insurance/billing-gap-candidates');
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

let passed = 0;
const pass = (msg: string) => {
  passed += 1;
  console.log(`PASS ${passed}: ${msg}`);
};
const captured: Array<[string, unknown]> = [];
(metrics as { emit: (e: string, f?: unknown) => void }).emit = (event: string, fields?: unknown) => {
  captured.push([event, fields]);
};

const day = async (offset: number): Promise<string> =>
  String((await sql`select ((now() at time zone 'America/Sao_Paulo')::date + ${offset}::int)::text as d`)[0]!.d);

async function grantedAuthorization(c: Clinic, membershipId: string, validUntil: string, requestedOn: string) {
  const { authorizationId } = await fx.asUser(c, (tx) =>
    auths.requestManualAuthorizationTx(tx, {
      clinicId: c.clinicId, insurerId: c.insurerId, membershipId, requestedOn,
      items: [{ tableCode: '22', procedureCode: '10101012', quantityRequested: 1 }], actorUserId: c.doctorId,
    }),
  );
  const [a] = await sql`select version from public.hi_authorizations where id = ${authorizationId}::uuid`;
  const items = await sql`select id::text from public.hi_authorization_items where authorization_id = ${authorizationId}::uuid`;
  await fx.asUser(c, (tx) =>
    auths.recordManualAuthorizationResponseTx(tx, {
      decision: 'authorized', clinicId: c.clinicId, authorizationId, version: Number(a!.version),
      authorizedOn: requestedOn, operatorGuideNumber: `OP${randomUUID().slice(0, 8)}`,
      password: 'SENHA-SINTETICA', passwordValidUntil: validUntil,
      items: items.map((i) => ({ itemId: String(i.id), quantityAuthorized: 1 })), actorUserId: c.doctorId,
    }),
  );
  return authorizationId;
}
const statusOf = async (id: string) => String((await sql`select status from public.hi_authorizations where id = ${id}::uuid`)[0]!.status);

try {
  await sql`GRANT SELECT ON public.clinics, public.profiles TO authenticated`;
  await fx.seedTerminology();
  const A = await fx.setupClinic('Manutenção A');
  const B = await fx.setupClinic('Manutenção B');
  const gA = await A.approvedGuide();
  const gB = await B.approvedGuide();
  const cardA = String((await sql`select membership_id from public.hi_guides where id = ${gA}::uuid`)[0]!.membership_id);
  const cardB = String((await sql`select membership_id from public.hi_guides where id = ${gB}::uuid`)[0]!.membership_id);
  const [yesterday, tomorrow, threeAgo, sixAgo] = [await day(-1), await day(1), await day(-3), await day(-6)];

  const expiredA = await grantedAuthorization(A, cardA, yesterday, threeAgo);
  const expiringA = await grantedAuthorization(A, cardA, tomorrow, threeAgo);
  // Pedido sem resposta há 6 dias (parado na operadora).
  await fx.asUser(A, (tx) => auths.requestManualAuthorizationTx(tx, {
    clinicId: A.clinicId, insurerId: A.insurerId, membershipId: cardA, requestedOn: sixAgo,
    items: [{ tableCode: '22', procedureCode: '10101012', quantityRequested: 1 }], actorUserId: A.doctorId,
  }));
  const expiredB = await grantedAuthorization(B, cardB, yesterday, threeAgo);

  // 1. Vencimento + resumo, só na clínica A.
  captured.length = 0;
  const r1 = await maint.runInsuranceMaintenance({ deadlineAt: Date.now() + 60_000, clinics: [A.clinicId], forceDaily: true, store });
  assert.deepEqual([r1.processed, r1.expired, r1.failed, r1.deferred], [1, 1, 0, 0]);
  assert.deepEqual([await statusOf(expiredA), await statusOf(expiringA)], ['expired', 'authorized']);
  const ev = await sql`select to_status, actor_id, note from public.hi_authorization_events where authorization_id = ${expiredA}::uuid and to_status = 'expired'`;
  assert.equal(ev.length, 1);
  assert.equal(ev[0]!.actor_id, null, 'vencimento é do sistema, sem autor humano');
  assert.deepEqual(r1.daily, { passwordExpiring: 1, sessionsEnding: 0, awaitingOperatorOverdue: 1, openPayoutReviews: 0, awaitingCancellationReceipts: 0, clinicsWithAlerts: 1 });
  pass('a senha vencida ontem vira "vencida" (histórico do sistema); a que vence amanhã fica concedida e entra no resumo como "senha vencendo"; pedido parado há 6 dias entra como "aguardando a operadora"');

  // 2. Idempotência.
  const r2 = await maint.runInsuranceMaintenance({ deadlineAt: Date.now() + 60_000, clinics: [A.clinicId] });
  assert.deepEqual([r2.expired, r2.daily], [0, null]);
  const ev2 = await sql`select count(*)::int n from public.hi_authorization_events where authorization_id = ${expiredA}::uuid and to_status = 'expired'`;
  assert.equal(Number(ev2[0]!.n), 1);
  pass('segunda execução: nada vence de novo, o histórico não se repete e, fora da janela diária, não há resumo (sem repetição indefinida)');

  // 3. Métricas sem identificador.
  const text = JSON.stringify(captured);
  for (const id of [A.clinicId, B.clinicId, expiredA, expiringA, cardA]) assert.ok(!text.includes(id), `métrica sem ${id.slice(0, 8)}`);
  assert.ok(captured.some(([e]) => e === 'insurance.maintenance.daily_summary'));
  assert.ok(captured.some(([e]) => e === 'insurance.authorization.expired'));
  pass('métricas da manutenção e do vencimento só com contagens: nenhum id de clínica, autorização ou carteirinha');

  // 4. Isolamento: B não foi tocada pela execução da A; na própria execução, vence só a dela.
  assert.equal(await statusOf(expiredB), 'authorized');
  const rB = await maint.runInsuranceMaintenance({ deadlineAt: Date.now() + 60_000, clinics: [B.clinicId, randomUUID(), A.clinicId] });
  assert.equal(await statusOf(expiredB), 'expired');
  assert.deepEqual([rB.processed, rB.expired], [3, 1]);
  pass('isolamento: a execução da clínica A não toca a B; na da B, só a autorização dela vence (clínica inexistente na lista não quebra a rodada)');

  // 5. Sem tempo: tudo adiado, sem efeito parcial.
  const rLate = await maint.runInsuranceMaintenance({ deadlineAt: Date.now() - 1, clinics: [A.clinicId, B.clinicId] });
  assert.deepEqual([rLate.processed, rLate.deferred], [0, 2]);
  pass('sem orçamento de tempo: as clínicas ficam para a próxima execução de 15 minutos, sem efeito parcial');

  // 6. A varredura privilegiada (auditoria §4): só ids, só clínica com o módulo instalado, LIMIT.
  const bare = randomUUID();
  await sql`insert into public.clinics (id, slug, nome, status)
    values (${bare}::uuid, ${`fx-${bare.slice(0, 12)}`}, 'Clínica sem Convênios', 'active')`;
  await sql`update public.hi_clinic_settings set enabled = false where clinic_id = ${B.clinicId}::uuid`;
  const listed = await listInsuranceMaintenanceClinics();
  assert.ok(listed.every((id) => /^[0-9a-f-]{36}$/u.test(id)), 'só identificadores');
  assert.ok(listed.includes(A.clinicId) && listed.includes(B.clinicId), 'instaladas (ligada e desligada) entram');
  assert.ok(!listed.includes(bare), 'clínica sem Convênios não entra');
  assert.equal((await listInsuranceMaintenanceClinics(1)).length, 1, 'LIMIT respeitado');
  const installed = Number((await sql`select count(*)::int n from public.hi_clinic_settings`)[0]!.n);
  assert.equal(listed.length, installed);
  const rScan = await maint.runInsuranceMaintenance({ deadlineAt: Date.now() + 60_000 });
  assert.deepEqual([rScan.clinics, rScan.processed, rScan.failed], [installed, installed, 0], 'módulo desligado não quebra o vencimento');
  pass('leitura privilegiada §4: a varredura devolve só clinic_id das clínicas com Convênios instalado (ligado ou desligado), respeita o LIMIT, e a rodada sem lista processa todas sob RLS sem falhar com o módulo desligado');

  console.log(`\n${passed}/6 provas da manutenção de Convênios (P6.6/P12.6).`);
  assert.equal(passed, 6);
} finally {
  await cluster.stop();
}
