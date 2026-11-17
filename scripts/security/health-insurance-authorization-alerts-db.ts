/**
 * Convênios P6.6 (0166): avisos de autorização ENTREGUES à clínica, em Postgres DESCARTÁVEL (cadeia
 * do DEV + 0166), dados sintéticos. Nunca no DEV compartilhado.
 *
 *   1. a manutenção (fim do financial-reconcile) cria os avisos sem ninguém abrir a tela: senha
 *      vencendo, senha vencida (a que ela mesma venceu) e pedido parado na operadora; o lote de
 *      entrega vai ao outbox na mesma transação, só com o lote e a contagem;
 *   2. idempotência: rodar de novo não cria aviso nem pedido de entrega;
 *   3. obsoleto: a operadora respondeu o pedido parado → o aviso é ENCERRADO (não volta);
 *   4. leitura: quem viu é a pessoa da sessão (o banco grava); sem pessoa, recusa; de novo, recusa;
 *      outra clínica não vê nem marca;
 *   5. guardas do banco: aviso não nasce lido nem entregue; o fato não muda; encerrado não reabre;
 *      a entrega gravada não muda; tentativas não diminuem;
 *   6. módulo desligado e clínica em avaliação (trial): nada é criado (e o banco recusa a inclusão direta
 *      com o módulo desligado);
 *   7. entrega: o lote lido na hora conta só os abertos; entregue = carimbo; o que foi visto não vai;
 *   8. frequência: no máximo 3 lotes por clínica em 24 horas;
 *   9. nenhum dado pessoal no aviso nem no evento (só datas, contagens e ids).
 *
 *   SECURITY_PG_BIN=... PORT=55557 NODE_OPTIONS=--conditions=react-server \
 *     npx tsx scripts/security/health-insurance-authorization-alerts-db.ts
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { readDevOrderChain } from './dev-order-chain';
import { startScratchSchema } from './scratch-schema';

const PORT = Number(process.env.PORT ?? 55557);
const chain = await readDevOrderChain();
assert.ok(chain.some((m) => m.file.startsWith('0166_')), 'a cadeia precisa trazer a 0166');
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
const alerts = await import('../../src/contexts/health-insurance/internal/authorization-alert-service');
const delivery = await import('../../src/contexts/health-insurance/alerts');
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
const pgCode = (e: unknown) => (e as { code?: string; cause?: { code?: string } }).code ?? (e as { cause?: { code?: string } }).cause?.code;
const rejectsWith = async (fn: () => Promise<unknown>, code: string, what: string) => {
  await assert.rejects(fn, (e: unknown) => pgCode(e) === code, what);
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
async function respond(c: Clinic, authorizationId: string, authorizedOn: string, validUntil: string) {
  const [a] = await sql`select version from public.hi_authorizations where id = ${authorizationId}::uuid`;
  const items = await sql`select id::text from public.hi_authorization_items where authorization_id = ${authorizationId}::uuid`;
  await fx.asUser(c, (tx) =>
    auths.recordManualAuthorizationResponseTx(tx, {
      decision: 'authorized', clinicId: c.clinicId, authorizationId, version: Number(a!.version),
      authorizedOn, operatorGuideNumber: `OP${randomUUID().slice(0, 8)}`,
      password: 'SENHA-SINTETICA', passwordValidUntil: validUntil,
      items: items.map((i) => ({ itemId: String(i.id), quantityAuthorized: 1 })), actorUserId: c.doctorId,
    }),
  );
}
const alertRows = (clinicId: string) =>
  sql`select id::text, kind, status, alert_key, detail, delivery_batch, delivered_at, read_by::text, authorization_id::text
        from public.hi_authorization_alerts where clinic_id = ${clinicId}::uuid order by created_at, id`;
const outboxRows = (clinicId: string) =>
  sql`select payload, idempotency_key from public.outbox
       where clinic_id = ${clinicId}::uuid and event_type = 'health_insurance.authorization_alerts.delivery_requested'
       order by created_at`;

try {
  await sql`GRANT SELECT ON public.clinics, public.profiles TO authenticated`;
  await fx.seedTerminology();
  const A = await fx.setupClinic('Avisos A');
  const B = await fx.setupClinic('Avisos B');
  // Clínica que vira AVALIAÇÃO (trial) depois de montada: o cadastro de Convênios exige assinatura.
  const T = await fx.setupClinic('Avisos em avaliação');
  const cardOf = async (c: Clinic) => String((await sql`select membership_id from public.hi_guides where id = ${await c.approvedGuide()}::uuid`)[0]!.membership_id);
  const [cardA, cardB] = [await cardOf(A), await cardOf(B)];
  const [yesterday, tomorrow, threeAgo, sixAgo] = [await day(-1), await day(1), await day(-3), await day(-6)];

  const expiredA = await requested(A, cardA, threeAgo);
  await respond(A, expiredA, threeAgo, yesterday);
  const expiringA = await requested(A, cardA, threeAgo);
  await respond(A, expiringA, threeAgo, tomorrow);
  const overdueA = await requested(A, cardA, sixAgo);
  const expiringB = await requested(B, cardB, threeAgo);
  await respond(B, expiringB, threeAgo, tomorrow);

  // 1. A manutenção cria os avisos e pede a entrega, sem ninguém abrir a tela.
  const now = new Date();
  now.setUTCMinutes(5);
  const r1 = await maint.runInsuranceMaintenance({ deadlineAt: Date.now() + 60_000, now, clinics: [A.clinicId], store });
  let a1 = await alertRows(A.clinicId);
  if (a1.length === 0) {
    // Diagnóstico (só dados sintéticos): a manutenção engole a falha dos avisos de propósito; aqui a
    // mesma sincronização roda direto para a causa aparecer no log do job.
    try {
      await fx.asSystem(A, (tx) => alerts.syncAuthorizationAlertsTx(tx, A.clinicId));
      a1 = await alertRows(A.clinicId);
      console.log(`diagnóstico: a sincronização direta passou e criou ${a1.length} aviso(s)`);
    } catch (e) {
      const c = (e as { cause?: { code?: string; message?: string; constraint_name?: string } }).cause;
      const first = (e as Error).message.split(/\r?\n/u)[0];
      console.log(`diagnóstico: ${(e as Error).name}: ${first} | causa ${c?.code ?? '-'} ${c?.constraint_name ?? '-'} ${c?.message ?? '-'}`);
    }
    throw new Error('a manutenção não criou os avisos (ver o diagnóstico acima)');
  }
  assert.deepEqual(a1.map((r) => r.kind).sort(), ['operator_overdue', 'password_expired', 'password_expiring']);
  assert.equal(a1.find((r) => r.kind === 'password_expired')!.authorization_id, expiredA);
  assert.equal(a1.find((r) => r.kind === 'password_expiring')!.authorization_id, expiringA);
  assert.equal(a1.find((r) => r.kind === 'operator_overdue')!.authorization_id, overdueA);
  assert.ok(a1.every((r) => r.status === 'open' && r.delivery_batch && !r.delivered_at));
  assert.equal(new Set(a1.map((r) => r.delivery_batch)).size, 1, 'um lote só');
  const ob1 = await outboxRows(A.clinicId);
  assert.equal(ob1.length, 1);
  assert.deepEqual(ob1[0]!.payload, { clinicId: A.clinicId, batch: a1[0]!.delivery_batch, count: 3 });
  assert.equal(r1.alertsCreated, 3);
  assert.equal(r1.alertsQueued, 3);
  assert.equal((await alertRows(B.clinicId)).length, 0, 'a clínica B não foi processada');
  pass('a manutenção cria os avisos (senha vencendo, senha vencida, pedido parado) e pede UMA entrega pelo outbox, só com o lote e a contagem; a clínica B não é tocada');

  // 2. Idempotência.
  const r2 = await maint.runInsuranceMaintenance({ deadlineAt: Date.now() + 60_000, now, clinics: [A.clinicId], store });
  assert.equal(r2.alertsCreated, 0);
  assert.equal(r2.alertsQueued, 0);
  assert.equal((await alertRows(A.clinicId)).length, 3);
  assert.equal((await outboxRows(A.clinicId)).length, 1);
  pass('rodar de novo não cria aviso nem pedido de entrega (a chave do fato é única por clínica)');

  // 3. Obsoleto: a operadora respondeu o pedido parado.
  await respond(A, overdueA, sixAgo, tomorrow);
  await fx.asSystem(A, (tx) => alerts.syncAuthorizationAlertsTx(tx, A.clinicId));
  const a3 = await alertRows(A.clinicId);
  const overdueAlert = a3.find((r) => r.kind === 'operator_overdue')!;
  assert.equal(overdueAlert.status, 'cancelled');
  assert.equal(a3.find((r) => r.kind === 'password_expired')!.status, 'open', 'senha vencida fica até ser vista');
  // A resposta virou mais uma senha vencendo amanhã: aviso novo, outro fato.
  assert.ok(a3.some((r) => r.kind === 'password_expiring' && r.authorization_id === overdueA && r.status === 'open'));
  await rejectsWith(
    () => fx.asSystem(A, (tx) => tx.execute(fx.sqlTag`update public.hi_authorization_alerts set status = 'open' where id = ${overdueAlert.id}::uuid`)),
    '23514',
    'encerrado não reabre',
  );
  pass('a operadora respondeu o pedido parado: o aviso é encerrado e não reabre; a senha vencida continua aberta até ser vista');

  // 4. Leitura: quem viu é a pessoa da sessão.
  const expiredAlert = a3.find((r) => r.kind === 'password_expired')!;
  const seen = await fx.asUser(A, (tx) => alerts.markAuthorizationAlertReadTx(tx, A.clinicId, expiredAlert.id));
  assert.equal(seen.kind, 'password_expired');
  const after = (await alertRows(A.clinicId)).find((r) => r.id === expiredAlert.id)!;
  assert.deepEqual([after.status, after.read_by], ['read', A.doctorId]);
  await assert.rejects(() => fx.asUser(A, (tx) => alerts.markAuthorizationAlertReadTx(tx, A.clinicId, expiredAlert.id)), alerts.AuthorizationAlertError);
  // O aviso aberto do PRIMEIRO lote (senha vencendo da autorização expiringA).
  const openA = (await alertRows(A.clinicId)).find((r) => r.status === 'open' && r.kind === 'password_expiring' && r.authorization_id === expiringA)!;
  await rejectsWith(() => fx.asSystem(A, (tx) => alerts.markAuthorizationAlertReadTx(tx, A.clinicId, openA.id)), '42501', 'sem pessoa na sessão');
  await assert.rejects(() => fx.asUser(B, (tx) => alerts.markAuthorizationAlertReadTx(tx, B.clinicId, openA.id)), alerts.AuthorizationAlertError);
  assert.equal((await fx.asUser(B, (tx) => alerts.listOpenAuthorizationAlertsTx(tx, B.clinicId))).length, 0);
  assert.equal((await alertRows(A.clinicId)).find((r) => r.id === openA.id)!.status, 'open', 'a outra clínica não mudou nada');
  pass('marcar como visto grava a pessoa da sessão; repetir, sem pessoa ou de outra clínica é recusado e não muda nada');

  // 5. Guardas do banco.
  await rejectsWith(
    () => fx.asSystem(A, (tx) => tx.execute(fx.sqlTag`insert into public.hi_authorization_alerts (clinic_id, authorization_id, kind, alert_key, status, read_at, read_by)
        values (${A.clinicId}::uuid, ${expiringA}::uuid, 'password_expiring', ${`teste:${randomUUID()}`}, 'read', now(), ${A.doctorId}::uuid)`)),
    '23514',
    'não nasce lido',
  );
  await rejectsWith(
    () => fx.asSystem(A, (tx) => tx.execute(fx.sqlTag`update public.hi_authorization_alerts set detail = '{"x":1}'::jsonb where id = ${openA.id}::uuid`)),
    '23514',
    'fato imutável',
  );
  await rejectsWith(
    () => fx.asSystem(A, (tx) => tx.execute(fx.sqlTag`update public.hi_authorization_alerts set delivery_attempts = -1 where id = ${openA.id}::uuid`)),
    '23514',
    'tentativas não diminuem',
  );
  pass('o banco recusa aviso nascendo lido, mudança do fato e tentativas diminuindo');

  // 6. Módulo desligado e clínica sem assinatura: nada é criado.
  await sql`update public.hi_clinic_settings set enabled = false where clinic_id = ${B.clinicId}::uuid`;
  const offB = await fx.asSystem(B, (tx) => alerts.syncAuthorizationAlertsTx(tx, B.clinicId));
  assert.deepEqual([offB.operable, offB.created], [false, 0]);
  await rejectsWith(
    () => fx.asSystem(B, (tx) => tx.execute(fx.sqlTag`insert into public.hi_authorization_alerts (clinic_id, authorization_id, kind, alert_key)
        values (${B.clinicId}::uuid, ${expiringB}::uuid, 'password_expiring', ${`teste:${randomUUID()}`})`)),
    '55000',
    'módulo desligado',
  );
  await sql`update public.hi_clinic_settings set enabled = true where clinic_id = ${B.clinicId}::uuid`;
  await sql`update public.subscriptions set billing_status = 'trial', trial_ends_at = now() + interval '10 days', enforce_trial_deadline = true
             where clinic_id = ${T.clinicId}::uuid`;
  const offT = await fx.asSystem(T, (tx) => alerts.syncAuthorizationAlertsTx(tx, T.clinicId));
  assert.deepEqual([offT.operable, offT.created], [false, 0]);
  assert.equal((await alertRows(B.clinicId)).length + (await alertRows(T.clinicId)).length, 0);
  pass('módulo desligado e clínica em avaliação (trial): nenhum aviso (e a inclusão direta com o módulo desligado é recusada pelo banco)');

  // 7. Entrega: só os abertos do lote; entregue = carimbo que não muda.
  const batch = String(a1[0]!.delivery_batch);
  const read = await delivery.readAlertDeliveryBatch(A.clinicId, batch);
  assert.equal(read.operable, true);
  assert.deepEqual(read.counts, { password_expiring: 1, password_expired: 0, sessions_ending: 0, operator_overdue: 0 }, 'visto e encerrado não vão');
  assert.equal(await delivery.recordAlertDeliveryOutcome(A.clinicId, batch, { delivered: false, error: 'TransactionalEmailError' }), 1);
  assert.equal(await delivery.recordAlertDeliveryOutcome(A.clinicId, batch, { delivered: true }), 1);
  assert.equal(await delivery.recordAlertDeliveryOutcome(A.clinicId, batch, { delivered: true }), 0, 'segunda confirmação não muda nada');
  const delivered = (await alertRows(A.clinicId)).find((r) => r.id === openA.id)!;
  assert.ok(delivered.delivered_at);
  assert.equal((await delivery.readAlertDeliveryBatch(A.clinicId, batch)).total, 0);
  await rejectsWith(
    () => fx.asSystem(A, (tx) => tx.execute(fx.sqlTag`update public.hi_authorization_alerts set delivered_at = now() - interval '1 day' where id = ${openA.id}::uuid`)),
    '23514',
    'entrega gravada não muda',
  );
  pass('a entrega lê o lote na hora (visto e encerrado não vão), registra a falha com o tipo do erro e o entregue com carimbo que não muda');

  // 8. Frequência: no máximo 3 lotes por clínica em 24 horas.
  for (let i = 0; i < 4; i += 1) {
    await fx.asSystem(A, (tx) => tx.execute(fx.sqlTag`insert into public.hi_authorization_alerts (clinic_id, authorization_id, kind, alert_key, detail)
        values (${A.clinicId}::uuid, ${expiringA}::uuid, 'sessions_ending', ${`teste:freq:${i}:${randomUUID()}`}, '{"remaining":1,"authorized":2}'::jsonb)`));
    await fx.asSystem(A, (tx) => alerts.requestAlertDeliveryTx(tx, A.clinicId));
  }
  const batches = await sql`select count(distinct delivery_batch)::int n from public.hi_authorization_alerts where clinic_id = ${A.clinicId}::uuid and delivery_batch is not null`;
  assert.equal(Number(batches[0]!.n), 3, 'três lotes em 24 horas');
  const unbatched = await sql`select count(*)::int n from public.hi_authorization_alerts where clinic_id = ${A.clinicId}::uuid and status = 'open' and delivery_batch is null`;
  // Lotes: o da execução 1, o da 3 (aviso novo) e o primeiro do laço; os outros 3 esperam.
  assert.equal(Number(unbatched[0]!.n), 3, 'o excedente espera a janela');
  pass('controle de frequência: no máximo 3 lotes por clínica em 24 horas; o excedente fica aberto, esperando');

  // 9. Nenhum dado pessoal no aviso nem no evento.
  const names = (await sql`select nome from public.patients where clinic_id = ${A.clinicId}::uuid`).map((r) => String(r.nome));
  const text = JSON.stringify([await alertRows(A.clinicId), await outboxRows(A.clinicId)]);
  for (const n of names) assert.ok(!text.includes(n), 'nome de paciente');
  assert.ok(!text.includes('SENHA-SINTETICA'), 'senha');
  assert.ok(!/numeroCarteira|card_number|cpf/iu.test(text), 'carteirinha ou CPF');
  pass('aviso e evento sem nome de paciente, senha, carteirinha ou CPF: só datas, contagens e ids');

  console.log(`\n${passed}/9 provas dos avisos de autorização (P6.6, 0166).`);
  assert.equal(passed, 9);
} finally {
  await cluster.stop();
}
