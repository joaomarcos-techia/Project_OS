/**
 * Convênios P1.13 — interruptor do módulo PELA PLATAFORMA (contrato do console do #57), em Postgres
 * DESCARTÁVEL (cadeia do DEV), dados sintéticos. Nunca no DEV compartilhado.
 *
 *   1. nada ligado por padrão: clínica nova aparece como "não instalada, desligada"; a lista só leva
 *      id, nome, situação, estado do módulo e o motivo comercial (nenhum paciente, guia ou valor);
 *   2. desligar A pela plataforma: a trilha da PRÓPRIA clínica registra quem, quando e o motivo; a
 *      clínica B continua ligada; com A desligada, a classe A é recusada pelo banco (55000);
 *   3. ligar A de novo: volta a operar; repetir o pedido não grava nada (idempotente, sem trilha nova);
 *   4. clínica em avaliação (trial): ligar é recusado pelo serviço (D24) e o banco recusa também o
 *      caminho direto; nada muda;
 *   5. ligar clínica que nunca configurou Convênios cria a linha ligada com autor e data; clínica
 *      inexistente é recusada;
 *   6. paginação da lista (limite e continuação por id).
 *
 *   SECURITY_PG_BIN=... PORT=55559 NODE_OPTIONS=--conditions=react-server \
 *     npx tsx scripts/security/health-insurance-platform-db.ts
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { readDevOrderChain } from './dev-order-chain';
import { grantPaidSubscription, startScratchSchema } from './scratch-schema';

const PORT = Number(process.env.PORT ?? 55559);
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

const { dbAdmin } = await import('../../src/lib/db');
const platform = await import('../../src/contexts/health-insurance/platform');
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

let passed = 0;
const pass = (msg: string) => {
  passed += 1;
  console.log(`PASS ${passed}: ${msg}`);
};
const pgCode = (e: unknown) => (e as { code?: string; cause?: { code?: string } }).code ?? (e as { cause?: { code?: string } }).cause?.code;

const ADMIN = randomUUID();
const rc = { ip: '127.0.0.1', userAgent: 'harness', requestId: `req-${randomUUID()}`, correlationId: null } as never;
const set = (clinicId: string, enabled: boolean, reason: string) =>
  dbAdmin.transaction((tx) => platform.setConveniosModuleTx(tx, { clinicId, enabled, reason, actorUserId: ADMIN, requestContext: rc }));
const list = (input: { limit?: number; afterClinicId?: string | null }) =>
  dbAdmin.transaction((tx) => platform.listConveniosModuleStatesTx(tx, input));
const enabledOf = async (clinicId: string) =>
  (await sql`select enabled from public.hi_clinic_settings where clinic_id = ${clinicId}::uuid`)[0]?.enabled ?? null;
const trail = (clinicId: string) =>
  sql`select user_id::text, action, before, after from public.audit_events
       where clinic_id = ${clinicId}::uuid and action like 'health_insurance.module.%' order by created_at`;
const requestAuthorization = (c: Clinic, membershipId: string) =>
  fx.asUser(c, (tx) => auths.requestManualAuthorizationTx(tx, {
    clinicId: c.clinicId, insurerId: c.insurerId, membershipId, requestedOn: '2026-11-10',
    items: [{ tableCode: '22', procedureCode: '10101012', quantityRequested: 1 }], actorUserId: c.doctorId,
  }));

try {
  await sql`GRANT SELECT ON public.clinics, public.profiles TO authenticated`;
  await fx.seedTerminology();
  const A = await fx.setupClinic('Plataforma A');
  const B = await fx.setupClinic('Plataforma B');
  const T = await fx.setupClinic('Plataforma em avaliação');
  const cardOf = async (c: Clinic) =>
    String((await sql`select membership_id from public.hi_guides where id = ${await c.approvedGuide()}::uuid`)[0]!.membership_id);
  const cardA = await cardOf(A);
  const bare = randomUUID();
  await sql`insert into public.clinics (id, slug, nome, status) values (${bare}::uuid, ${`fx-${bare.slice(0, 12)}`}, 'Clínica sem Convênios', 'active')`;
  await grantPaidSubscription(sql, bare);

  // 1. Nada ligado por padrão; leitura mínima.
  const all = await list({ limit: 200 });
  const row = all.find((r) => r.clinicId === bare)!;
  assert.deepEqual([row.installed, row.enabled, row.enabledAt], [false, false, null]);
  assert.deepEqual(Object.keys(row).sort(), ['clinicId', 'clinicName', 'clinicStatus', 'commercialDenial', 'enabled', 'enabledAt', 'installed']);
  assert.equal(all.find((r) => r.clinicId === A.clinicId)!.enabled, true);
  pass('nada ligado por padrão: clínica nova aparece "não instalada, desligada"; a lista só leva id, nome, situação, estado do módulo e o motivo comercial');

  // 2. Desligar A: trilha da clínica, B intacta, classe A recusada pelo banco.
  const off = await set(A.clinicId, false, 'contenção: incidente sintético de teste');
  assert.deepEqual(off, { clinicId: A.clinicId, enabled: false, changed: true });
  assert.deepEqual([await enabledOf(A.clinicId), await enabledOf(B.clinicId)], [false, true]);
  const t2 = await trail(A.clinicId);
  assert.equal(t2.length, 1);
  assert.deepEqual([t2[0]!.user_id, t2[0]!.action, t2[0]!.before, t2[0]!.after], [
    ADMIN, 'health_insurance.module.disabled_by_platform', { enabled: true }, { enabled: false, reason: 'contenção: incidente sintético de teste' },
  ]);
  assert.equal((await trail(B.clinicId)).length, 0, 'nada na trilha da B');
  await assert.rejects(() => requestAuthorization(A, cardA), (e: unknown) => pgCode(e) === '55000' || /desligad|habilitad/iu.test(String((e as Error).message)));
  pass('desligar A pela plataforma: trilha da própria clínica com autor e motivo; B continua ligada; com A desligada a classe A é recusada');

  // 3. Ligar A de novo; repetir não grava nada.
  const on = await set(A.clinicId, true, 'contenção encerrada');
  assert.deepEqual(on, { clinicId: A.clinicId, enabled: true, changed: true });
  await requestAuthorization(A, cardA);
  const again = await set(A.clinicId, true, 'pedido repetido');
  assert.deepEqual(again, { clinicId: A.clinicId, enabled: true, changed: false });
  assert.equal((await trail(A.clinicId)).length, 2, 'o pedido repetido não deixa trilha');
  const [settingsA] = await sql`select enabled_by::text as by from public.hi_clinic_settings where clinic_id = ${A.clinicId}::uuid`;
  assert.equal(settingsA!.by, ADMIN);
  pass('ligar A de novo volta a operar (autor gravado); repetir o pedido é idempotente, sem trilha nova');

  // 4. Avaliação (trial): serviço e banco recusam ligar.
  await sql`update public.hi_clinic_settings set enabled = false where clinic_id = ${T.clinicId}::uuid`;
  await sql`update public.subscriptions set billing_status = 'trial', trial_ends_at = now() + interval '10 days', enforce_trial_deadline = true
             where clinic_id = ${T.clinicId}::uuid`;
  await assert.rejects(() => set(T.clinicId, true, 'tentativa em avaliação'), (e: unknown) => (e as { code?: string }).code === 'commercial');
  await assert.rejects(
    () => sql`update public.hi_clinic_settings set enabled = true, enabled_at = now(), enabled_by = ${ADMIN}::uuid where clinic_id = ${T.clinicId}::uuid`,
    (e: unknown) => pgCode(e) === '23514',
  );
  assert.equal(await enabledOf(T.clinicId), false);
  assert.equal((await trail(T.clinicId)).length, 0);
  assert.ok((await list({ limit: 200 })).find((r) => r.clinicId === T.clinicId)!.commercialDenial, 'a lista mostra o motivo comercial');
  pass('clínica em avaliação: ligar é recusado pelo serviço (D24) e pelo banco no caminho direto; nada muda, nenhuma trilha');

  // 5. Primeira vez (sem configuração) e clínica inexistente.
  const first = await set(bare, true, 'piloto aprovado pelo fundador (sintético)');
  assert.deepEqual(first, { clinicId: bare, enabled: true, changed: true });
  const [nb] = await sql`select enabled, enabled_at is not null as dated, enabled_by::text as by from public.hi_clinic_settings where clinic_id = ${bare}::uuid`;
  assert.deepEqual([nb!.enabled, nb!.dated, nb!.by], [true, true, ADMIN]);
  await assert.rejects(() => set(randomUUID(), true, 'clínica que não existe'), (e: unknown) => (e as { code?: string }).code === 'not_found');
  pass('clínica que nunca configurou Convênios: a linha nasce ligada com autor e data; clínica inexistente é recusada');

  // 6. Paginação.
  const page1 = await list({ limit: 2 });
  assert.equal(page1.length, 2);
  const page2 = await list({ limit: 2, afterClinicId: page1[1]!.clinicId });
  assert.ok(page2.every((r) => r.clinicId > page1[1]!.clinicId));
  assert.ok(!page2.some((r) => page1.some((p) => p.clinicId === r.clinicId)));
  pass('lista paginada: limite respeitado e continuação pelo id, sem repetir clínica');

  // 7. Estado de UMA clínica (detalhe do console): o mesmo que a lista mostra; inexistente = null.
  const one = await dbAdmin.transaction((tx) => platform.readConveniosModuleStateTx(tx, bare));
  const inList = (await list({ limit: 200 })).find((r) => r.clinicId === bare);
  assert.deepEqual(one, inList);
  assert.equal(await dbAdmin.transaction((tx) => platform.readConveniosModuleStateTx(tx, randomUUID())), null);
  pass('detalhe de uma clínica (tela do console): mesmo estado da lista; clínica inexistente devolve null');

  console.log(`\n${passed}/7 provas do interruptor de Convênios pela plataforma (P1.13).`);
  assert.equal(passed, 7);
} finally {
  await cluster.stop();
}
