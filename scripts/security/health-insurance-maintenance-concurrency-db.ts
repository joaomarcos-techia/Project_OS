/**
 * Convênios P6.6/P12.6 — CONCORRÊNCIA da manutenção do fim do `financial-reconcile`, em Postgres
 * DESCARTÁVEL (cadeia do DEV + 0166), dados sintéticos. Nunca no DEV compartilhado; o cron real não
 * é disparado e nenhum agendamento muda.
 *
 * A manutenção não usa lease nem Redis: a exclusão mútua é do banco (linha travada no vencimento,
 * chave única do aviso, trava por clínica na sincronização dos avisos). Este harness prova que isso
 * basta quando duas ou mais execuções se sobrepõem (cron atrasado + reexecução manual, worker lento):
 *
 *   1. quatro execuções simultâneas nas mesmas clínicas: cada senha vencida vence UMA vez (um
 *      histórico), cada fato vira UM aviso, cada clínica recebe UM pedido de entrega; a soma das
 *      contagens das execuções é exata (nada contado duas vezes, nada perdido);
 *   2. só avisos (nada a vencer, então o vencimento não serializa): seis sincronizações simultâneas
 *      criam cada aviso uma vez e UM lote, sem impasse (deadlock) nem falha registrada;
 *   3. outra transação segura a linha (worker preso): a execução espera até o `lock_timeout`, a
 *      clínica falha SEM efeito parcial (nada vence, nenhum aviso), a outra clínica segue; solta a
 *      linha, a próxima execução recupera tudo uma vez só;
 *   4. a conexão da execução cai no meio (banco derrubou o backend): a clínica falha sem efeito
 *      parcial, as outras seguem; a próxima execução recupera;
 *   5. falha parcial: a sincronização dos avisos falha (permissão retirada no banco descartável) e o
 *      vencimento continua gravado (ponto de salvamento); a métrica leva só o SQLSTATE; devolvida a
 *      permissão, a próxima execução cria os avisos e pede a entrega uma vez;
 *   6. duas execuções em clínicas diferentes ao mesmo tempo não se bloqueiam nem se misturam.
 *
 *   SECURITY_PG_BIN=... PORT=55558 NODE_OPTIONS=--conditions=react-server \
 *     npx tsx scripts/security/health-insurance-maintenance-concurrency-db.ts
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { readDevOrderChain } from './dev-order-chain';
import { startScratchSchema } from './scratch-schema';

const PORT = Number(process.env.PORT ?? 55558);
const chain = await readDevOrderChain();
assert.ok(chain.some((m) => m.file.startsWith('0166_')), 'a cadeia precisa trazer a 0166');
const cluster = await startScratchSchema({ port: PORT, maxConnections: 24, migrations: chain });
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
const captured: Array<[string, Record<string, unknown> | undefined]> = [];
(metrics as { emit: (e: string, f?: Record<string, unknown>) => void }).emit = (event, fields) => {
  captured.push([event, fields]);
};

const day = async (offset: number): Promise<string> =>
  String((await sql`select ((now() at time zone 'America/Sao_Paulo')::date + ${offset}::int)::text as d`)[0]!.d);

async function requested(c: Clinic, membershipId: string, requestedOn: string) {
  const { authorizationId } = await fx.asUser(c, (tx) =>
    auths.requestManualAuthorizationTx(tx, {
      clinicId: c.clinicId, insurerId: c.insurerId, membershipId, requestedOn,
      items: [{ tableCode: '22', procedureCode: '10101012', quantityRequested: 1 }], actorUserId: c.doctorId,
    }),
  );
  return authorizationId;
}
async function granted(c: Clinic, membershipId: string, requestedOn: string, validUntil: string) {
  const id = await requested(c, membershipId, requestedOn);
  const [a] = await sql`select version from public.hi_authorizations where id = ${id}::uuid`;
  const items = await sql`select id::text from public.hi_authorization_items where authorization_id = ${id}::uuid`;
  await fx.asUser(c, (tx) =>
    auths.recordManualAuthorizationResponseTx(tx, {
      decision: 'authorized', clinicId: c.clinicId, authorizationId: id, version: Number(a!.version),
      authorizedOn: requestedOn, operatorGuideNumber: `OP${randomUUID().slice(0, 8)}`,
      password: 'SENHA-SINTETICA', passwordValidUntil: validUntil,
      items: items.map((i) => ({ itemId: String(i.id), quantityAuthorized: 1 })), actorUserId: c.doctorId,
    }),
  );
  return id;
}
const cardOf = async (c: Clinic) =>
  String((await sql`select membership_id from public.hi_guides where id = ${await c.approvedGuide()}::uuid`)[0]!.membership_id);
const statusOf = async (id: string) => String((await sql`select status from public.hi_authorizations where id = ${id}::uuid`)[0]!.status);
const expiredEvents = async (id: string) =>
  Number((await sql`select count(*)::int n from public.hi_authorization_events where authorization_id = ${id}::uuid and to_status = 'expired'`)[0]!.n);
const alertRows = (clinicId: string) =>
  sql`select kind, status, alert_key, delivery_batch, authorization_id::text from public.hi_authorization_alerts
       where clinic_id = ${clinicId}::uuid order by alert_key`;
const deliveries = (clinicId: string) =>
  sql`select payload from public.outbox
       where clinic_id = ${clinicId}::uuid and event_type = 'health_insurance.authorization_alerts.delivery_requested'`;
/** Execução na janela dos avisos (minuto < 15 UTC), com orçamento de sobra. */
const run = (clinics: string[]) => {
  const now = new Date();
  now.setUTCMinutes(5);
  return maint.runInsuranceMaintenance({ deadlineAt: Date.now() + 120_000, now, clinics, store });
};
const sum = (rs: Array<Record<string, unknown>>, k: string) => rs.reduce((n, r) => n + Number(r[k] ?? 0), 0);
const failedSyncs = () => captured.filter(([e]) => e === 'insurance.alerts.sync_failed');
/** Cada aviso num lote só, e o pedido de entrega soma exatamente os avisos do lote. */
async function oneDeliveryPerBatch(clinicId: string, expectedBatches: number) {
  const rows = await alertRows(clinicId);
  const ob = await deliveries(clinicId);
  const batches = new Set(rows.map((r) => r.delivery_batch).filter(Boolean));
  assert.equal(ob.length, expectedBatches, 'pedidos de entrega');
  assert.equal(batches.size, expectedBatches, 'lotes');
  const counted = ob.reduce((n, o) => n + Number((o.payload as { count: number }).count), 0);
  assert.equal(counted, rows.filter((r) => r.delivery_batch).length, 'a soma dos lotes é a dos avisos com lote');
}

try {
  await sql`GRANT SELECT ON public.clinics, public.profiles TO authenticated`;
  await fx.seedTerminology();
  const A = await fx.setupClinic('Concorrência A');
  const B = await fx.setupClinic('Concorrência B');
  const C = await fx.setupClinic('Concorrência C (só avisos)');
  const D = await fx.setupClinic('Concorrência D (linha presa)');
  const E = await fx.setupClinic('Concorrência E (conexão derrubada)');
  const F = await fx.setupClinic('Concorrência F (falha parcial)');
  const [cardA, cardB, cardC, cardD, cardE, cardF] = await Promise.all([A, B, C, D, E, F].map(cardOf));
  const [yesterday, tomorrow, threeAgo, sixAgo] = [await day(-1), await day(1), await day(-3), await day(-6)];

  // 1. Quatro execuções simultâneas nas mesmas clínicas.
  const dueA = [
    await granted(A, cardA, threeAgo, yesterday),
    await granted(A, cardA, threeAgo, yesterday),
    await granted(A, cardA, threeAgo, yesterday),
  ];
  await granted(A, cardA, threeAgo, tomorrow);
  await requested(A, cardA, sixAgo);
  const dueB = [await granted(B, cardB, threeAgo, yesterday)];
  captured.length = 0;
  const rs1 = await Promise.all([1, 2, 3, 4].map(() => run([A.clinicId, B.clinicId])));
  for (const id of [...dueA, ...dueB]) {
    assert.equal(await statusOf(id), 'expired');
    assert.equal(await expiredEvents(id), 1, 'um histórico de vencimento por autorização');
  }
  assert.equal(sum(rs1 as never, 'expired'), 4, 'as execuções somam exatamente os 4 vencimentos');
  assert.equal(sum(rs1 as never, 'failed'), 0);
  assert.equal(sum(rs1 as never, 'processed'), 8);
  const aA = await alertRows(A.clinicId);
  assert.deepEqual(aA.map((r) => r.kind).sort(), ['operator_overdue', 'password_expired', 'password_expired', 'password_expired', 'password_expiring']);
  assert.equal(new Set(aA.map((r) => r.alert_key)).size, aA.length);
  assert.equal((await alertRows(B.clinicId)).length, 1);
  assert.equal(sum(rs1 as never, 'alertsCreated'), 6, 'cada aviso contado uma vez');
  await oneDeliveryPerBatch(A.clinicId, 1);
  await oneDeliveryPerBatch(B.clinicId, 1);
  assert.equal(failedSyncs().length, 0, 'nenhuma sincronização falhou');
  pass('quatro execuções simultâneas: cada senha vencida vence uma vez (um histórico), cada fato vira um aviso, um pedido de entrega por clínica; as contagens das execuções somam exatamente');

  // 2. Só avisos: nada a vencer, então o vencimento não ordena as execuções.
  await granted(C, cardC, threeAgo, tomorrow);
  await granted(C, cardC, threeAgo, tomorrow);
  await requested(C, cardC, sixAgo);
  await requested(C, cardC, sixAgo);
  captured.length = 0;
  const rs2 = await Promise.all([1, 2, 3, 4, 5, 6].map(() => run([C.clinicId])));
  const aC = await alertRows(C.clinicId);
  assert.equal(aC.length, 4);
  assert.equal(sum(rs2 as never, 'alertsCreated'), 4);
  assert.equal(sum(rs2 as never, 'failed'), 0);
  assert.equal(failedSyncs().length, 0, `sincronizações com falha: ${JSON.stringify(failedSyncs())}`);
  await oneDeliveryPerBatch(C.clinicId, 1);
  pass('seis sincronizações simultâneas só de avisos: cada aviso uma vez, um lote e um pedido de entrega, sem impasse nem falha registrada');

  // 3. Outra transação segura a linha (worker preso): espera até o lock_timeout e falha sem efeito parcial.
  const dueD = await granted(D, cardD, threeAgo, yesterday);
  const dueB2 = await granted(B, cardB, threeAgo, yesterday);
  captured.length = 0;
  let release!: () => void;
  const held = new Promise<void>((r) => { release = r; });
  let locked!: () => void;
  const isLocked = new Promise<void>((r) => { locked = r; });
  const holder = sql.begin(async (t) => {
    await t`select id from public.hi_authorizations where id = ${dueD}::uuid for update`;
    locked();
    await held;
  });
  await isLocked;
  const t0 = Date.now();
  const r3 = await run([D.clinicId, B.clinicId]);
  const waited = Date.now() - t0;
  assert.deepEqual([r3.processed, r3.failed, r3.expired], [1, 1, 1], 'D falha, B segue');
  assert.ok(waited >= 14_000, `esperou o lock_timeout (${waited} ms)`);
  assert.equal(await statusOf(dueD), 'authorized', 'nada vence em D');
  assert.equal(await expiredEvents(dueD), 0);
  assert.equal((await alertRows(D.clinicId)).length, 0, 'nenhum aviso em D');
  assert.equal(await statusOf(dueB2), 'expired');
  const failed3 = captured.filter(([e]) => e === 'insurance.maintenance.clinic_failed');
  assert.equal(failed3.length, 1);
  assert.ok(!JSON.stringify(failed3).includes(D.clinicId), 'a métrica não leva a clínica');
  release();
  await holder;
  const r3b = await run([D.clinicId]);
  assert.deepEqual([r3b.processed, r3b.failed, r3b.expired], [1, 0, 1]);
  assert.equal(await expiredEvents(dueD), 1);
  await oneDeliveryPerBatch(D.clinicId, 1);
  pass(`linha presa por outra transação: a execução espera o lock_timeout (${Math.round(waited / 1000)} s), a clínica falha sem efeito parcial e a outra segue; solta a linha, a próxima execução recupera uma vez só`);

  // 4. A conexão da execução cai no meio (o banco derruba o backend enquanto ela espera a linha).
  const dueE = await granted(E, cardE, threeAgo, yesterday);
  const dueB3 = await granted(B, cardB, threeAgo, yesterday);
  captured.length = 0;
  let release4!: () => void;
  const held4 = new Promise<void>((r) => { release4 = r; });
  let locked4!: () => void;
  const isLocked4 = new Promise<void>((r) => { locked4 = r; });
  const holder4 = sql.begin(async (t) => {
    await t`select id from public.hi_authorizations where id = ${dueE}::uuid for update`;
    locked4();
    await held4;
  });
  await isLocked4;
  const running = run([E.clinicId, B.clinicId]);
  let killed = 0;
  for (let i = 0; i < 100 && killed === 0; i++) {
    await new Promise((r) => setTimeout(r, 100));
    const k = await sql`select pg_terminate_backend(pid) as ok from pg_stat_activity
                         where wait_event_type = 'Lock' and pid <> pg_backend_pid() and state = 'active'`;
    killed = k.filter((x) => x.ok).length;
  }
  assert.equal(killed, 1, 'o backend da execução foi derrubado');
  const r4 = await running;
  release4();
  await holder4;
  assert.deepEqual([r4.processed, r4.failed], [1, 1], 'E falha, B segue');
  assert.equal(await statusOf(dueE), 'authorized');
  assert.equal(await expiredEvents(dueE), 0);
  assert.equal((await alertRows(E.clinicId)).length, 0);
  assert.equal(await statusOf(dueB3), 'expired');
  const r4b = await run([E.clinicId]);
  assert.deepEqual([r4b.failed, r4b.expired], [0, 1]);
  assert.equal(await expiredEvents(dueE), 1);
  await oneDeliveryPerBatch(E.clinicId, 1);
  pass('conexão derrubada no meio da execução: a clínica falha sem efeito parcial, a outra segue, e a próxima execução recupera uma vez só');

  // 5. Falha parcial: a sincronização dos avisos falha; o vencimento fica (ponto de salvamento).
  const dueF = await granted(F, cardF, threeAgo, yesterday);
  await sql`REVOKE INSERT ON public.hi_authorization_alerts FROM authenticated`;
  captured.length = 0;
  const r5 = await run([F.clinicId]);
  assert.deepEqual([r5.processed, r5.failed, r5.expired, r5.alertsCreated], [1, 0, 1, 0]);
  assert.equal(await statusOf(dueF), 'expired', 'o vencimento não é desfeito pela falha dos avisos');
  assert.equal((await alertRows(F.clinicId)).length, 0);
  const sf = failedSyncs();
  assert.equal(sf.length, 1);
  assert.equal(sf[0]![1]!.code, '42501');
  assert.ok(!JSON.stringify(sf).includes(F.clinicId) && !JSON.stringify(sf).includes(dueF), 'a métrica só leva o tipo e o SQLSTATE');
  await sql`GRANT INSERT ON public.hi_authorization_alerts TO authenticated`;
  const r5b = await run([F.clinicId]);
  assert.deepEqual([r5b.expired, r5b.alertsCreated, r5b.alertsQueued], [0, 1, 1], 'a próxima execução cria o aviso da senha vencida');
  assert.equal(await expiredEvents(dueF), 1);
  await oneDeliveryPerBatch(F.clinicId, 1);
  const r5c = await run([F.clinicId]);
  assert.deepEqual([r5c.alertsCreated, r5c.alertsQueued], [0, 0]);
  pass('falha parcial: a sincronização dos avisos falha (SQLSTATE na métrica, sem identificador) e o vencimento fica; devolvida a permissão, a próxima execução cria o aviso e pede a entrega uma vez; a seguinte não repete');

  // 6. Clínicas diferentes ao mesmo tempo: sem bloqueio mútuo e sem mistura.
  const G = await fx.setupClinic('Concorrência G');
  const H = await fx.setupClinic('Concorrência H');
  const [cardG, cardH] = [await cardOf(G), await cardOf(H)];
  const dueG = await granted(G, cardG, threeAgo, yesterday);
  const dueH = await granted(H, cardH, threeAgo, yesterday);
  const [rG, rH] = await Promise.all([run([G.clinicId]), run([H.clinicId])]);
  assert.deepEqual([rG.expired, rH.expired, rG.failed + rH.failed], [1, 1, 0]);
  const gAlerts = await alertRows(G.clinicId);
  const hAlerts = await alertRows(H.clinicId);
  assert.deepEqual([gAlerts.map((r) => r.authorization_id), hAlerts.map((r) => r.authorization_id)], [[dueG], [dueH]]);
  pass('execuções simultâneas em clínicas diferentes não se bloqueiam nem se misturam');

  console.log(`\n${passed}/6 provas de concorrência da manutenção de Convênios (P6.6/P12.6).`);
  assert.equal(passed, 6);
} finally {
  await cluster.stop();
}
