/**
 * P0 — retenção do registro de acesso (`login_attempts`) diante do Marco Civil da Internet (Lei 12.965/2014,
 * art. 15: 6 meses) e do requisito 84 do componente de segurança da ANS (180 dias), em Postgres DESCARTÁVEL local
 * com as migrations reais. Dados sintéticos; nenhum banco compartilhado; nada de produção é lido ou escrito.
 *
 *   1. registros com 1, 30, 90, 179, 180, 184, 185, 186, 187 e 200 dias;
 *   2. purga com a regra PUBLICADA em produção (`cf712ab4`: 90 dias, mesmo predicado do registro) numa transação
 *      desfeita → quais registros ainda dentro dos 6 meses seriam apagados;
 *   3. purga com a regra CORRIGIDA (`RETENTION_POLICIES` deste código) → nenhum registro dentro dos 6 meses de
 *      calendário nem dos 180 dias apagado;
 *   4. a ROTA REAL `GET /api/cron/data-retention` (registro corrigido) contra o banco descartável: só os vencidos
 *      saem, e as outras limpezas continuam (outbox processado antigo sai, pendente e recente ficam; chave de
 *      idempotência vencida sai, válida fica).
 *
 *   SECURITY_PG_BIN=... PORT=55607 NODE_OPTIONS=--conditions=react-server npx tsx scripts/security/login-attempts-retention-db.ts
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { startScratchSchema } from './scratch-schema';

const PORT = Number(process.env.PORT ?? 55607);
const cluster = await startScratchSchema({ port: PORT, maxConnections: 8 });
const { sql } = cluster;
if (!new RegExp(`@(?:127\\.0\\.0\\.1|localhost):${PORT}/`, 'u').test(cluster.url))
  throw new Error('não é o cluster local');
process.env.DATABASE_URL = cluster.url;
delete process.env.DATABASE_URL_RUNTIME;
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://ci.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_ci';
process.env.CRON_SECRET = 'segredo-sintetico-do-cron-com-mais-de-32-caracteres';
process.env.OUTBOX_CRON_ALLOW_NON_VERCEL = 'true';
delete process.env.CRON_SECRET_DESTRUCTIVE;

const { RETENTION_POLICIES, buildPurgeStatement, LOGIN_ATTEMPTS_DAYS } =
  await import('../../src/lib/db/retention-policy');
const { sql: dsql } = await import('drizzle-orm');
const { PgDialect } = await import('drizzle-orm/pg-core');
const dialect = new PgDialect();

const AGES = [1, 30, 90, 179, 180, 184, 185, 186, 187, 200];
let passed = 0;
const pass = (msg: string) => {
  passed += 1;
  console.log(`PASS ${passed}: ${msg}`);
};
const uniq = (xs: number[]) => [...new Set(xs)].sort((a, b) => a - b);

interface Row {
  id: string;
  age: number;
  mc: boolean;
  ans: boolean;
}
/** Idade em dias e as duas obrigações: 6 meses de calendário (Marco Civil) e 180 dias (ANS). */
const rows = async (): Promise<Row[]> =>
  (await sql`select id::text, floor(extract(epoch from now() - attempted_at) / 86400)::int as age,
      (attempted_at + interval '6 months' > now()) as mc,
      (attempted_at > now() - interval '180 days') as ans
    from public.login_attempts`) as unknown as Row[];

class Rollback extends Error {}
/** Roda a purga numa transação DESFEITA; devolve as idades apagadas e as violações legais. */
async function dryPurge(p: (typeof RETENTION_POLICIES)[number]) {
  const all = new Map((await rows()).map((r) => [r.id, r]));
  const q = dialect.sqlToQuery(buildPurgeStatement(p, 5000));
  let deleted: string[] = [];
  await sql
    .begin(async (tx) => {
      const del = (await tx.unsafe(q.sql, q.params as never[])) as unknown as Array<{ id: string }>;
      deleted = del.map((r) => String(r.id));
      throw new Rollback();
    })
    .catch((e: unknown) => {
      if (!(e instanceof Rollback)) throw e;
    });
  assert.equal((await rows()).length, all.size, 'a transação desfeita não apagou nada');
  const hit = deleted.map((id) => all.get(id)!);
  return {
    ages: uniq(hit.map((r) => r.age)),
    marcoCivil: hit.filter((r) => r.mc).length,
    ans: hit.filter((r) => r.ans).length,
  };
}

try {
  for (const d of AGES)
    for (const success of [true, false])
      await sql`insert into public.login_attempts (email_hash, ip, success, attempted_at)
        values (${`hmac-sintetico-${d}`}, '203.0.113.10'::inet, ${success}, now() - make_interval(days => ${d}))`;
  const s0 = await rows();
  assert.equal(s0.length, AGES.length * 2);
  pass(
    `semente: ${s0.length} registros com ${AGES.join(', ')} dias; o Marco Civil (6 meses de calendário) manda guardar os de ${uniq(s0.filter((r) => r.mc).map((r) => r.age)).join(', ')} dias; a ANS, os de ${uniq(s0.filter((r) => r.ans).map((r) => r.age)).join(', ')}`,
  );

  // ── Regra publicada em produção (cf712ab4): o mesmo predicado, com 90 ──
  const policy = RETENTION_POLICIES.find((x) => x.table === 'login_attempts')!;
  const production = {
    ...policy,
    days: 90,
    expired: () => dsql`attempted_at < now() - make_interval(days => ${90})`,
  };
  const prod = await dryPurge(production);
  assert.ok(prod.marcoCivil > 0);
  pass(
    `regra de PRODUÇÃO (90 dias): apagaria os de ${prod.ages.join(', ')} dias — ${prod.marcoCivil} registros dentro dos 6 meses do Marco Civil e ${prod.ans} dentro dos 180 dias da ANS (risco reproduzido; transação desfeita)`,
  );

  // ── Regra corrigida ───────────────────────────────────────────────
  assert.equal(LOGIN_ATTEMPTS_DAYS, 186);
  const fixed = await dryPurge(policy);
  assert.equal(fixed.marcoCivil, 0);
  assert.equal(fixed.ans, 0);
  assert.deepEqual(
    fixed.ages,
    [186, 187, 200].filter((a) => fixed.ages.includes(a)),
  );
  assert.ok(
    fixed.ages.includes(187) &&
      fixed.ages.includes(200) &&
      !fixed.ages.includes(185) &&
      !fixed.ages.includes(184),
  );
  pass(
    `regra CORRIGIDA (186 dias): apaga só os de ${fixed.ages.join(', ')} dias; 0 dentro dos 6 meses e 0 dentro dos 180 dias; os de 184 e 185 dias (maior semestre) ficam`,
  );

  // ── Rota real do cron, com as outras limpezas ─────────────────────
  const clinic = randomUUID();
  await sql`insert into public.clinics (id, slug, nome, status) values (${clinic}::uuid, ${`ret-${clinic.slice(0, 12)}`}, 'Clínica Retenção', 'active')`;
  const ob = async (status: string, days: number) =>
    String(
      (
        await sql`insert into public.outbox (clinic_id, event_type, payload, payload_hash, idempotency_key, status, processed_at, created_at)
      values (${clinic}::uuid, 'teste.retencao.evento', '{}'::jsonb, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', ${`ret-${randomUUID()}`}, ${status}::outbox_status,
        ${status === 'processed' ? sql`now() - make_interval(days => ${days})` : null}, now() - make_interval(days => ${days})) returning id`
      )[0]!.id,
    );
  const obOld = await ob('processed', 40);
  const obRecent = await ob('processed', 10);
  const obPending = await ob('pending', 40);
  // Chave vencida e concluída (criada há 2 dias, TTL de 24 h) sai; válida fica. O gatilho 0010 só protege chave
  // em andamento criada na última hora.
  await sql`insert into public.idempotency_keys (key, clinic_id, payload_hash, response, status_code, created_at, expires_at) values
    ('teste_ret:vencida:deadbeef01', ${clinic}::uuid, 'h', '{}'::jsonb, 200, now() - interval '2 days', now() - interval '1 day'),
    ('teste_ret:valida:deadbeef02', ${clinic}::uuid, 'h', null, null, now(), now() + interval '1 hour')`;

  const { GET } = await import('../../src/app/api/cron/data-retention/route');
  const res = await GET(
    new Request('http://localhost/api/cron/data-retention', {
      headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
    }),
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as { ok: boolean; purged: Record<string, number> };
  const left = await rows();
  assert.equal(
    left.filter((r) => r.mc).length,
    s0.filter((r) => r.mc).length,
    'nenhum registro dentro dos 6 meses saiu',
  );
  assert.equal(left.filter((r) => r.ans).length, s0.filter((r) => r.ans).length);
  assert.ok(left.every((r) => r.age < 186));
  assert.equal(body.purged.login_attempts, s0.length - left.length);
  const outboxLeft = new Set(
    (
      (await sql`select id::text from public.outbox where clinic_id = ${clinic}::uuid`) as unknown as Array<{
        id: string;
      }>
    ).map((r) => r.id),
  );
  assert.deepEqual(
    [outboxLeft.has(obOld), outboxLeft.has(obRecent), outboxLeft.has(obPending)],
    [false, true, true],
  );
  const keys = (
    (await sql`select key from public.idempotency_keys where clinic_id = ${clinic}::uuid`) as unknown as Array<{
      key: string;
    }>
  ).map((r) => r.key);
  assert.deepEqual(keys, ['teste_ret:valida:deadbeef02']);
  assert.equal(Object.keys(body.purged).length, RETENTION_POLICIES.length);
  pass(
    `rota real GET /api/cron/data-retention: 200; login_attempts apagou ${body.purged.login_attempts} (só ≥ 186 dias); ficaram os de ${uniq(left.map((r) => r.age)).join(', ')} dias; as ${RETENTION_POLICIES.length} políticas rodaram; outbox processado de 40 dias saiu, recente e pendente ficaram; chave de idempotência vencida saiu, válida ficou`,
  );

  // ── R42: resumo do último acesso, lido antes de registrar o login atual ──
  const { readLastAccessSummary } = await import('../../src/lib/auth/login-audit');
  await sql`insert into public.login_attempts (email_hash, ip, success, attempted_at) values
    ('hmac-r42', '203.0.113.20'::inet, true, now() - interval '5 days'),
    ('hmac-r42', '203.0.113.20'::inet, true, now() - interval '3 days'),
    ('hmac-r42', '203.0.113.21'::inet, false, now() - interval '2 days'),
    ('hmac-r42', '203.0.113.21'::inet, false, now() - interval '1 hour'),
    ('hmac-outra-conta', '203.0.113.22'::inet, false, now() - interval '1 hour')`;
  const r42 = await readLastAccessSummary('hmac-r42');
  const days = Math.round((Date.now() - r42.previousSuccessAt!.getTime()) / 86_400_000);
  assert.deepEqual([days, r42.failuresSince], [3, 2]);
  assert.deepEqual(await readLastAccessSummary('hmac-primeiro-acesso'), {
    previousSuccessAt: null,
    failuresSince: 0,
  });
  pass(
    'R42: último acesso = o sucesso anterior (há 3 dias); 2 falhas desde então; falha de outra conta não conta; primeiro acesso sem registro',
  );

  console.log(`\n${passed}/5 provas da retenção do registro de acesso (e do R42) passaram.`);
  assert.equal(passed, 5);
} finally {
  await cluster.stop();
}
