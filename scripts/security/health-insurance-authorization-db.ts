/**
 * P6.1 — autorização da operadora em Postgres DESCARTÁVEL (cadeia na ordem do DEV), só dados
 * sintéticos. Prova o que o serviço acrescenta à solicitação SP/SADT (P6.2):
 *
 *   1. vencimento: só concedidas com a senha vencida (data da CLÍNICA) vencem; pedida, negada e
 *      a que vence hoje ficam; histórico com a data; segunda chamada não faz nada;
 *   2. depois de vencida, o banco recusa consumir (gatilho da 0146);
 *   3. outra clínica: o vencimento de uma não toca a outra;
 *   4. comprovante: cifrado no armazenamento (o objeto não tem o conteúdo em claro), banco com os
 *      SHA-256; leitura devolve os mesmos bytes e é auditada sem a referência do armazenamento;
 *   5. comprovante adulterado e ausente: nunca entregues, e a auditoria da falha fica gravada;
 *   6. compensação: transação que não confirma remove o objeto gravado;
 *   7. conteúdo que não bate com o tipo e autorização cancelada: recusados, nada gravado;
 *   8. outra clínica não lê nem anexa (RLS): "inexistente nesta clínica".
 *
 *   PORT=55548 NODE_OPTIONS="--import ./scripts/security/server-only-hook.mjs" npx tsx --tsconfig tsconfig.scripts.json \
 *     --conditions=react-server scripts/security/health-insurance-authorization-db.ts
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { readDevOrderChain } from './dev-order-chain';
import { startScratchSchema } from './scratch-schema';

const PORT = Number(process.env.PORT ?? 55548);
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

const { withTenant } = await import('../../src/lib/db/tenant');
const auth = await import('../../src/contexts/health-insurance/internal/authorizations');
const { TissStorageError } = await import('../../src/lib/storage/tiss-files');
const { loadHiFixtures, SYS_ACTOR } = await import('./hi-fixtures');

const objects = new Map<string, Uint8Array>();
const store = {
  async put(ref: string, bytes: Uint8Array) {
    if (objects.has(ref)) throw new Error('objeto já existe');
    objects.set(ref, bytes);
  },
  async get(ref: string) {
    const b = objects.get(ref);
    if (!b) throw new TissStorageError('get', 'ausente', 'not_found');
    return b;
  },
  async remove(ref: string) {
    objects.delete(ref);
  },
};
// Sem XSD: nada aqui gera XML (mesmo padrão do harness da troca de modalidade).
const fx = await loadHiFixtures(sql, { store, validateXsd: null as never });
type Clinic = Awaited<ReturnType<typeof fx.setupClinic>>;
const RC = { ip: null, userAgent: null, requestId: 'harness-p61' };

let passed = 0;
const pass = (msg: string) => {
  passed += 1;
  console.log(`PASS: ${msg}`);
};

async function membership(c: Clinic) {
  const [p] = await sql`insert into public.patients (clinic_id, nome, cpf_encrypted, cpf_hash)
    values (${c.clinicId}::uuid, 'Paciente Sintético P6.1', 'ciphertext-de-teste', ${`hash-${randomUUID()}`}) returning id`;
  const [m] = await sql`insert into public.hi_memberships (clinic_id, patient_id, insurer_id, card_number_encrypted, card_number_hash, card_last4, created_by)
    values (${c.clinicId}::uuid, ${p!.id}::uuid, ${c.insurerId}::uuid, 'AQAAAAAAAAAAAAAAAAAAAAAAAAAAAA==', ${randomUUID().replace(/-/g, '').padEnd(64, '0')}, '2345', ${SYS_ACTOR}::uuid) returning id`;
  return m!.id as string;
}

/** Autorização no estado pedido, com um item; as concedidas com evidência (o CHECK do banco exige). */
async function authorization(c: Clinic, m: string, status: string, validUntil: string | null, authorized = 4) {
  const granted = status === 'authorized' || status === 'partially_authorized';
  const [a] = await sql`insert into public.hi_authorizations (clinic_id, insurer_id, membership_id, guide_type, status, origin,
      requested_on, operator_guide_number, authorized_on, password_valid_until, denial_reason, recorded_by, created_by)
    values (${c.clinicId}::uuid, ${c.insurerId}::uuid, ${m}::uuid, 'sp_sadt', ${status}, 'manual', '2026-01-02',
      ${granted ? `OP${randomUUID().slice(0, 8)}` : null}, ${granted ? '2026-01-03' : null}, ${validUntil},
      ${status === 'denied' ? 'Negado pela operadora (sintético)' : null},
      ${granted || status === 'denied' ? c.doctorId : null}::uuid, ${c.doctorId}::uuid) returning id`;
  const [i] = await sql`insert into public.hi_authorization_items (clinic_id, authorization_id, table_code, procedure_code, quantity_requested, quantity_authorized)
    values (${c.clinicId}::uuid, ${a!.id}::uuid, '22', ${`5000${Math.floor(Math.random() * 9000 + 1000)}`}, 4, ${granted ? authorized : 0}) returning id`;
  return { id: a!.id as string, itemId: i!.id as string };
}
const statusOf = async (id: string) => (await sql`select status from public.hi_authorizations where id = ${id}::uuid`)[0]!.status as string;
const clinicToday = async (c: Clinic) =>
  (await sql`select (now() at time zone coalesce(timezone, 'America/Sao_Paulo'))::date::text as d from public.clinics where id = ${c.clinicId}::uuid`)[0]!.d as string;
const addDays = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const run = (c: Clinic) => <T>(fn: Parameters<typeof withTenant<T>>[1]) => withTenant(c.clinicId, fn, c.doctorId);

try {
  // O Supabase dá SELECT em `clinics` ao `authenticated` (a RLS restringe à própria clínica); o
  // cluster descartável não traz esse padrão (mesma linha do harness da SP/SADT).
  await sql`GRANT SELECT ON public.clinics, public.profiles TO authenticated`;
  const A = await fx.setupClinic('P6.1 A');
  const B = await fx.setupClinic('P6.1 B');
  const mA = await membership(A);
  const mB = await membership(B);
  const today = await clinicToday(A);

  // 1. Vencimento pela data da clínica.
  const past = await authorization(A, mA, 'authorized', addDays(today, -1));
  const partialPast = await authorization(A, mA, 'partially_authorized', addDays(today, -30), 2);
  const dueToday = await authorization(A, mA, 'authorized', today);
  const future = await authorization(A, mA, 'authorized', addDays(today, 10));
  const noDate = await authorization(A, mA, 'authorized', null);
  const requested = await authorization(A, mA, 'requested', null);
  const denied = await authorization(A, mA, 'denied', null);
  const otherClinicPast = await authorization(B, mB, 'authorized', addDays(today, -5));
  const expired = await run(A)((tx) => auth.expireAuthorizationsTx(tx, A.clinicId));
  assert.deepEqual(expired.map((r) => r.id).sort(), [past.id, partialPast.id].sort());
  for (const [x, s] of [
    [past, 'expired'],
    [partialPast, 'expired'],
    [dueToday, 'authorized'],
    [future, 'authorized'],
    [noDate, 'authorized'],
    [requested, 'requested'],
    [denied, 'denied'],
  ] as const)
    assert.equal(await statusOf(x.id), s);
  const ev = await sql`select from_status, to_status, actor_id, note from public.hi_authorization_events where authorization_id = ${past.id}::uuid`;
  assert.deepEqual(ev.map((e) => [e.from_status, e.to_status, e.actor_id, e.note]), [['authorized', 'expired', null, `senha vencida em ${addDays(today, -1)}`]]);
  assert.deepEqual(await run(A)((tx) => auth.expireAuthorizationsTx(tx, A.clinicId)), []);
  pass('vencimento: só concedidas com a senha vencida (data da clínica); a de hoje, sem validade, pedida e negada ficam; histórico; repetição sem efeito');

  // 2. Depois de vencida, o banco recusa consumir.
  await assert.rejects(
    run(A)((tx) => tx.execute(fx.sqlTag`insert into public.hi_authorization_consumptions (clinic_id, item_id, quantity, idempotency_key, created_by)
      values (${A.clinicId}::uuid, ${past.itemId}::uuid, 1, ${`consumo-${randomUUID()}`}, ${A.doctorId}::uuid)`)),
    (e: unknown) => /Só se consome autorização concedida/u.test(String((e as { cause?: { message?: string } }).cause?.message ?? (e as Error).message)),
  );
  const okConsume = await run(A)((tx) => tx.execute(fx.sqlTag`insert into public.hi_authorization_consumptions (clinic_id, item_id, quantity, idempotency_key, created_by)
      values (${A.clinicId}::uuid, ${future.itemId}::uuid, 1, ${`consumo-${randomUUID()}`}, ${A.doctorId}::uuid) returning id`));
  assert.equal((okConsume as unknown as unknown[]).length, 1);
  pass('vencida não se consome (gatilho da 0146); a vigente consome normalmente');

  // 3. Outra clínica intocada.
  assert.equal(await statusOf(otherClinicPast.id), 'authorized');
  const expiredB = await run(B)((tx) => auth.expireAuthorizationsTx(tx, B.clinicId));
  assert.deepEqual(expiredB.map((r) => r.id), [otherClinicPast.id]);
  pass('o vencimento de uma clínica não toca a outra');

  // 4. Comprovante cifrado; leitura auditada.
  const pdf = Buffer.from('%PDF-1.7\n% comprovante sintético da operadora P6.1\n');
  const { attachmentId, contentSha256 } = await auth.attachAuthorizationReceipt(store, run(A), {
    clinicId: A.clinicId,
    authorizationId: future.id,
    bytes: pdf,
    declaredType: 'application/pdf',
    actorUserId: A.doctorId,
  });
  const [row] = await sql`select storage_ref, size_bytes, media_type, content_sha256, ciphertext_sha256 from public.hi_authorization_attachments where id = ${attachmentId}::uuid`;
  const stored = objects.get(row!.storage_ref as string)!;
  assert.ok(stored);
  assert.equal(Buffer.from(stored).includes('comprovante sintético'), false, 'objeto em claro no armazenamento');
  assert.equal(row!.size_bytes, pdf.length);
  assert.equal(row!.media_type, 'application/pdf');
  assert.equal(row!.content_sha256, contentSha256);
  assert.notEqual(row!.ciphertext_sha256, contentSha256);
  const read = await auth.readAuthorizationReceipt(store, { clinicId: A.clinicId, attachmentId, userId: A.doctorId, requestContext: RC });
  assert.ok(read);
  assert.deepEqual(Buffer.from(read.bytes), pdf);
  assert.match(read.fileName, /^comprovante-autorizacao-[0-9a-f]{8}\.pdf$/u);
  const audits = await sql`select after from public.audit_events where resource_type = 'hi_authorization_attachment' and resource_id = ${attachmentId}`;
  assert.equal(audits.length, 1);
  assert.equal((audits[0]!.after as { outcome: string }).outcome, 'granted');
  assert.equal(JSON.stringify(audits[0]!.after).includes(row!.storage_ref as string), false);
  pass('comprovante cifrado no armazenamento, SHA-256 no banco; leitura devolve os mesmos bytes e é auditada sem a referência');

  // 5. Adulterado e ausente: nunca entregues; auditoria da falha gravada.
  const original = objects.get(row!.storage_ref as string)!;
  objects.set(row!.storage_ref as string, Buffer.concat([Buffer.from(original), Buffer.from('x')]));
  await assert.rejects(
    auth.readAuthorizationReceipt(store, { clinicId: A.clinicId, attachmentId, userId: A.doctorId, requestContext: RC }),
    (e: unknown) => (e as { outcome?: string }).outcome === 'integrity_failed',
  );
  objects.delete(row!.storage_ref as string);
  await assert.rejects(
    auth.readAuthorizationReceipt(store, { clinicId: A.clinicId, attachmentId, userId: A.doctorId, requestContext: RC }),
    (e: unknown) => (e as { outcome?: string }).outcome === 'missing',
  );
  const outcomes = (await sql`select after->>'outcome' as o from public.audit_events where resource_type = 'hi_authorization_attachment' and resource_id = ${attachmentId} order by created_at`).map((r) => r.o);
  assert.deepEqual(outcomes, ['granted', 'integrity_failed', 'missing']);
  pass('adulterado e ausente nunca são entregues; a auditoria de cada falha fica gravada');

  // 6. Compensação.
  const before = objects.size;
  await assert.rejects(
    auth.attachAuthorizationReceipt(
      store,
      <T>(fn: Parameters<typeof withTenant<T>>[1]) =>
        withTenant(A.clinicId, async (tx) => {
          await fn(tx);
          throw new Error('falha depois de gravar (simulada)');
        }, A.doctorId),
      { clinicId: A.clinicId, authorizationId: future.id, bytes: pdf, declaredType: 'application/pdf', actorUserId: A.doctorId },
    ),
    /falha depois de gravar/u,
  );
  assert.equal(objects.size, before);
  assert.equal(Number((await sql`select count(*)::int as n from public.hi_authorization_attachments where authorization_id = ${future.id}::uuid`)[0]!.n), 1);
  pass('compensação: a transação que não confirma remove o objeto gravado; nenhum registro novo');

  // 7. Conteúdo que não bate e estado que não aceita.
  await assert.rejects(
    auth.attachAuthorizationReceipt(store, run(A), {
      clinicId: A.clinicId, authorizationId: future.id, bytes: Buffer.from('MZ\x90\x00executavel'), declaredType: 'application/pdf', actorUserId: A.doctorId,
    }),
    (e: unknown) => (e as { kind?: string }).kind === 'invalid_receipt',
  );
  await sql`update public.hi_authorizations set status = 'cancelled' where id = ${requested.id}::uuid`;
  await assert.rejects(
    auth.attachAuthorizationReceipt(store, run(A), {
      clinicId: A.clinicId, authorizationId: requested.id, bytes: pdf, declaredType: 'application/pdf', actorUserId: A.doctorId,
    }),
    (e: unknown) => (e as { kind?: string }).kind === 'state',
  );
  assert.equal(objects.size, before);
  pass('conteúdo que não bate com o tipo e autorização cancelada: recusados, nada gravado');

  // 8. Outra clínica não lê nem anexa.
  const { attachmentId: second } = await auth.attachAuthorizationReceipt(store, run(A), {
    clinicId: A.clinicId, authorizationId: future.id, bytes: pdf, declaredType: 'application/pdf', actorUserId: A.doctorId,
  });
  assert.equal(await auth.readAuthorizationReceipt(store, { clinicId: B.clinicId, attachmentId: second, userId: B.doctorId, requestContext: RC }), null);
  await assert.rejects(
    auth.attachAuthorizationReceipt(store, run(B), {
      clinicId: B.clinicId, authorizationId: future.id, bytes: pdf, declaredType: 'application/pdf', actorUserId: B.doctorId,
    }),
    (e: unknown) => (e as { kind?: string }).kind === 'not_found',
  );
  pass('outra clínica não lê o comprovante nem anexa na autorização desta (RLS)');

  assert.equal(passed, 8);
  console.log(`\nOK: ${passed}/8 provas da P6.1 (autorização: vencimento, comprovante, isolamento)`);
} finally {
  await cluster.stop();
}
