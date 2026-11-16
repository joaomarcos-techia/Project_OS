/**
 * Trilha da plataforma append-only: PROVA da candidata
 * docs/security/migrations/0165_super_admin_actions_append_only.candidate.sql (fora do journal),
 * em Postgres DESCARTÁVEL com dados sintéticos. Nunca no DEV compartilhado nem em produção.
 *
 * Simula o que o Supabase tem e as migrations não criam:
 *   - o dono da tabela é um papel SEM superuser e COM BYPASSRLS, como o `postgres` do DATABASE_URL
 *     (dbAdmin, dbWorker, scripts e migrador);
 *   - o pior ACL herdado: ALL para PUBLIC, anon, authenticated, service_role e qoro_runtime.
 *
 * O que fica provado:
 *   1. contrafactual: antes da candidata, service_role e o dono alteram, apagam e esvaziam, e um
 *      token de super_admin grava linha forjada (outro ator, data retroativa) pelo papel da Data API;
 *   2. a candidata aplica depois de todas as migrations da branch e é reaplicável;
 *   3. catálogo: só o dono tem privilégio; dois gatilhos BEFORE em ENABLE ALWAYS com os eventos
 *      certos; função SECURITY INVOKER, search_path fixo, sem EXECUTE para PUBLIC e papéis da API;
 *   4. o dono continua lendo e gravando (INSERT, ON CONFLICT DO NOTHING, modo replica) e não altera,
 *      não apaga, não esvazia; upsert (ON CONFLICT DO UPDATE) também para na barreira;
 *   5. superuser e modo replica (`session_replication_role`) também param; contraprova: com o
 *      gatilho em ENABLE comum, o modo replica apagaria (por isso ALWAYS);
 *   6. service_role, authenticated com claim de super_admin, qoro_runtime e anon: 42501 em tudo;
 *   7. as linhas ficam idênticas depois de todas as tentativas (digest);
 *   8. o reset de pré-lançamento (scripts/reset-prod-data.ts) passa com a lista atual, que preserva
 *      a trilha; com a lista antiga (trilha incluída), abortaria inteiro;
 *   9. a reversão do cabeçalho volta ao estado das migrations 0010/0028 e a candidata reaplica.
 *
 *   SECURITY_PG_BIN=... npx tsx scripts/security/super-admin-actions-append-only-db.ts [porta]
 *
 * A porta vem do argv, não do ambiente: um `process.env` novo em scripts/security muda o
 * inventário de segurança sem necessidade.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { startScratchSchema } from './scratch-schema';

const CANDIDATE = 'docs/security/migrations/0165_super_admin_actions_append_only.candidate.sql';
const PORT = Number(process.argv[2] ?? 55561);
const TABLE = 'public.super_admin_actions';
const FN = 'public.super_admin_actions_append_only()';
const OWNER = 'qoro_owner_sim';
const API_ROLES = ['anon', 'authenticated', 'service_role', 'qoro_runtime'] as const;
const PRIVILEGES = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'];
const REVERSAL = /^--\s*reversão:\s*/u;

// Cópia de TRANSIENT_TABLES de scripts/reset-prod-data.ts, na mesma ordem. O harness não importa
// de scripts/: o security:build só copia scripts/security e src. A trilha saiu da lista no mesmo
// PR da candidata (ADR-075); a lista antiga só existe aqui, para provar por quê.
const RESET_TABLES = [
  'audit_events',
  'outbox',
  'idempotency_keys',
  'impersonation_sessions',
  'cron_heartbeats',
  'system_metrics_daily',
  'login_attempts',
  'inbound_messages_orphaned',
  'clinic_invites',
  'checkout_sessions',
  'tenant_provisioning',
  'processed_webhooks',
  'billing_reconciliation_runs',
  '_reserved_slugs',
  'platform_announcements',
] as const;

const body = await readFile(CANDIDATE, 'utf8');
const reversal = body
  .split(/\r?\n/u)
  .filter((line) => REVERSAL.test(line))
  .map((line) => line.replace(REVERSAL, ''));
assert.equal(
  reversal.length,
  6,
  'a reversão do cabeçalho tem 2 gatilhos, a função, 2 GRANTs e a versão',
);

const cluster = await startScratchSchema({ port: PORT });
const { sql } = cluster;
assert.match(cluster.url, new RegExp(`@127\\.0\\.0\\.1:${PORT}/`, 'u'), 'não é o cluster local');

let passed = 0;
const pass = (message: string) => {
  passed += 1;
  console.log(`PASS ${passed}: ${message}`);
};

/** Sinal para desfazer a transação de uma tentativa que o banco aceitou. */
class Rollback extends Error {
  readonly count: number;
  constructor(count: number) {
    super('rollback');
    this.count = count;
  }
}

type Outcome = string;
interface Ctx {
  role?: string;
  claims?: Record<string, unknown>;
  replica?: boolean;
}

/**
 * Executa UMA operação numa transação que sempre volta. Devolve 'aceitou:<linhas>', 'gatilho'
 * (42501 da barreira), 'privilégio' (42501 do ACL) ou 'erro:<SQLSTATE>'.
 */
async function attempt(ctx: Ctx, query: string, params: string[] = []): Promise<Outcome> {
  try {
    await sql.begin(async (tx) => {
      if (ctx.replica) await tx.unsafe('SET LOCAL session_replication_role = replica');
      if (ctx.claims) {
        await tx.unsafe("SELECT set_config('request.jwt.claims', $1, true)", [
          JSON.stringify(ctx.claims),
        ]);
      }
      if (ctx.role) await tx.unsafe(`SET LOCAL ROLE ${ctx.role}`);
      const result = await tx.unsafe(query, params);
      throw new Rollback(Number.isFinite(result.count) ? result.count : 0);
    });
  } catch (error) {
    return classify(error);
  }
  return 'erro:sem-rollback';
}

function classify(error: unknown): Outcome {
  if (error instanceof Rollback) return `aceitou:${error.count}`;
  const e = error as { code?: string; message?: string };
  if (e.code === '42501') return e.message?.includes('append-only') ? 'gatilho' : 'privilégio';
  return `erro:${e.code ?? String(error)}`;
}

// O `Result` do postgres.js estende Array: o assert estrito compara protótipos, então tudo que
// vai para deepEqual sai daqui como array e objeto simples.
async function privileges(role: string): Promise<string[]> {
  const rows = await sql.unsafe<{ p: string; ok: boolean }[]>(
    `SELECT u.p, has_table_privilege($1, '${TABLE}', u.p) AS ok
       FROM unnest($2::text[]) WITH ORDINALITY AS u(p, ord)
      ORDER BY u.ord`,
    [role, `{${PRIVILEGES.join(',')}}`],
  );
  return Array.from(rows, (row) => (row.ok ? row.p : null)).filter((p): p is string => p !== null);
}

async function publicGrants(): Promise<number> {
  const [row] = await sql.unsafe<{ n: number }[]>(
    `SELECT count(*)::int AS n
       FROM pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
      WHERE c.oid = '${TABLE}'::regclass AND a.grantee = 0`,
  );
  return row?.n ?? -1;
}

async function triggers(): Promise<{ name: string; enabled: string; type: number }[]> {
  const rows = await sql.unsafe<{ name: string; enabled: string; type: number }[]>(
    `SELECT tgname AS name, tgenabled::text AS enabled, tgtype::int AS type
       FROM pg_trigger
      WHERE tgrelid = '${TABLE}'::regclass AND NOT tgisinternal
      ORDER BY tgname`,
  );
  return Array.from(rows, (row) => ({ name: row.name, enabled: row.enabled, type: row.type }));
}

/** Digest das linhas por colunas explícitas (epoch, não texto de timestamptz: não depende de fuso). */
async function digest(): Promise<{ rows: number; md5: string }> {
  const [row] = await sql.unsafe<{ rows: number; md5: string }[]>(
    `SELECT count(*)::int AS rows,
            md5(coalesce(string_agg(concat_ws('|', id::text, super_admin_id::text, action,
              coalesce(target_clinic_id::text, '-'), coalesce(payload::text, '-'),
              coalesce(host(ip_address), '-'), coalesce(user_agent, '-'),
              extract(epoch FROM created_at)::text), E'\\n' ORDER BY id), '')) AS md5
       FROM ${TABLE}`,
  );
  assert.ok(row);
  return { rows: row.rows, md5: row.md5 };
}

async function schemaVersionPresent(): Promise<boolean> {
  const [row] = await sql.unsafe<{ n: number }[]>(
    "SELECT count(*)::int AS n FROM _schema_version WHERE version = 'super-admin-actions-append-only'",
  );
  return (row?.n ?? 0) === 1;
}

const ACTOR = randomUUID();
const OTHER_ACTOR = randomUUID();
const CLINIC = randomUUID();
const SESSION = randomUUID();
const SUPER_ADMIN_CLAIMS = { sub: ACTOR, role: 'authenticated', app_role: 'super_admin' };
const INSERT_ROW = `INSERT INTO ${TABLE} (super_admin_id, action, target_clinic_id, payload, ip_address, user_agent)
  VALUES ($1::uuid, 'ai_conversation.content_viewed', $2::uuid, '{"synthetic":true}'::jsonb, '203.0.113.9', 'synthetic-harness')`;
const FORGED_ROW = `INSERT INTO ${TABLE} (super_admin_id, action, target_clinic_id, payload, created_at)
  VALUES ($1::uuid, 'impersonate_stop', $2::uuid, '{"forjado":true}'::jsonb, '2026-01-01T00:00:00Z')`;
const UPDATE_ROW = `UPDATE ${TABLE} SET action = 'apagado', payload = NULL WHERE id = $1::uuid`;
const DELETE_ROW = `DELETE FROM ${TABLE} WHERE id = $1::uuid`;
const EMPTY_TABLE = `TRUNCATE ${TABLE}`;
const SELECT_ALL = `SELECT id FROM ${TABLE}`;

try {
  const [version] = await sql.unsafe<{ v: string }[]>(
    "SELECT current_setting('server_version') AS v",
  );
  console.log(
    `Postgres ${version?.v ?? '?'} descartável na porta ${PORT}; candidata: ${CANDIDATE}`,
  );

  // ── Cenário do Supabase: dono sem superuser com BYPASSRLS + pior ACL herdado ──
  await sql.unsafe(`CREATE ROLE ${OWNER} NOLOGIN NOSUPERUSER BYPASSRLS`);
  await sql.unsafe(`ALTER TABLE ${TABLE} OWNER TO ${OWNER}`);
  await sql.unsafe(`GRANT ALL ON ${TABLE} TO PUBLIC, ${API_ROLES.join(', ')}`);

  // Linhas sintéticas gravadas pelo dono, como o dbAdmin faz.
  await sql.begin(async (tx) => {
    await tx.unsafe(`SET LOCAL ROLE ${OWNER}`);
    for (const action of [
      'impersonate_start',
      'ai_conversation.content_viewed',
      'impersonate_mutation',
      'impersonate_stop',
      'audit_export',
    ]) {
      await tx.unsafe(
        `INSERT INTO ${TABLE} (super_admin_id, action, target_clinic_id, payload, ip_address, user_agent)
         VALUES ($1::uuid, $2, $3::uuid, $4::jsonb, '203.0.113.7', 'synthetic-harness')`,
        [ACTOR, action, CLINIC, JSON.stringify({ synthetic: true, impersonationId: SESSION })],
      );
    }
  });
  const [target] = await sql.unsafe<{ id: string }[]>(
    `SELECT id::text AS id FROM ${TABLE} WHERE action = 'ai_conversation.content_viewed'`,
  );
  assert.ok(target);
  const before = await digest();
  assert.equal(before.rows, 5);

  // ── 1. Contrafactual: o que a trilha aceita hoje ──
  assert.equal(await attempt({ role: 'service_role' }, UPDATE_ROW, [target.id]), 'aceitou:1');
  assert.equal(await attempt({ role: 'service_role' }, DELETE_ROW, [target.id]), 'aceitou:1');
  assert.equal(await attempt({ role: 'service_role' }, EMPTY_TABLE), 'aceitou:0');
  assert.equal(await attempt({ role: OWNER }, UPDATE_ROW, [target.id]), 'aceitou:1');
  assert.equal(await attempt({ role: OWNER }, DELETE_ROW, [target.id]), 'aceitou:1');
  assert.equal(await attempt({ role: OWNER }, EMPTY_TABLE), 'aceitou:0');
  assert.equal(
    await attempt({ role: 'authenticated', claims: SUPER_ADMIN_CLAIMS }, FORGED_ROW, [
      OTHER_ACTOR,
      CLINIC,
    ]),
    'aceitou:1',
  );
  pass(
    'contrafactual: service_role e o dono alteram, apagam e esvaziam; um token de super_admin grava linha forjada (outro ator, data retroativa)',
  );

  // ── 2. A candidata aplica depois da cadeia inteira e é reaplicável ──
  await sql.unsafe(body);
  await sql.unsafe(body);
  assert.equal(await schemaVersionPresent(), true);
  pass('candidata aplica depois de todas as migrations da branch e reaplica sem erro');

  // ── 3. Catálogo ──
  for (const role of API_ROLES) {
    assert.deepEqual(await privileges(role), [], `${role} não pode ter privilégio na trilha`);
  }
  assert.equal(await publicGrants(), 0, 'PUBLIC sem privilégio');
  const ownerPrivileges = await privileges(OWNER);
  assert.ok(ownerPrivileges.includes('SELECT') && ownerPrivileges.includes('INSERT'));
  pass(
    'só o dono tem privilégio na trilha (PUBLIC, anon, authenticated, service_role, qoro_runtime: nada)',
  );

  assert.deepEqual(await triggers(), [
    // linha (1) + BEFORE (2) + DELETE (8) + UPDATE (16)
    { name: 'super_admin_actions_append_only_row', enabled: 'A', type: 27 },
    // comando + BEFORE (2) + esvaziamento (32)
    { name: 'super_admin_actions_append_only_stmt', enabled: 'A', type: 34 },
  ]);
  const [fn] = await sql.unsafe<
    { secdef: boolean; config: string[] | null; public_exec: number }[]
  >(
    `SELECT p.prosecdef AS secdef, p.proconfig AS config,
            (SELECT count(*)::int FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
              WHERE a.grantee = 0) AS public_exec
       FROM pg_proc p WHERE p.oid = '${FN}'::regprocedure`,
  );
  assert.ok(fn);
  assert.equal(fn.secdef, false, 'SECURITY INVOKER');
  assert.ok(
    fn.config?.some((entry) => entry.startsWith('search_path=')),
    'search_path fixo',
  );
  assert.equal(fn.public_exec, 0, 'sem EXECUTE para PUBLIC');
  for (const role of ['anon', 'authenticated', 'service_role']) {
    const [exec] = await sql.unsafe<{ ok: boolean }[]>(
      `SELECT has_function_privilege($1, '${FN}', 'EXECUTE') AS ok`,
      [role],
    );
    assert.equal(exec?.ok, false, `${role} sem EXECUTE na função do gatilho`);
  }
  pass(
    'gatilhos BEFORE de linha (UPDATE/DELETE) e de comando (esvaziamento) em ENABLE ALWAYS; função INVOKER, search_path fixo, sem EXECUTE público',
  );

  // ── 4. O dono (dbAdmin) continua lendo e gravando, e para na barreira ──
  assert.equal(await attempt({ role: OWNER }, SELECT_ALL), 'aceitou:5');
  assert.equal(await attempt({ role: OWNER }, INSERT_ROW, [ACTOR, CLINIC]), 'aceitou:1');
  assert.equal(
    await attempt({ role: OWNER, replica: true }, INSERT_ROW, [ACTOR, CLINIC]),
    'aceitou:1',
  );
  assert.equal(
    await attempt(
      { role: OWNER },
      `INSERT INTO ${TABLE} (id, super_admin_id, action) VALUES ($1::uuid, $2::uuid, 'x') ON CONFLICT (id) DO NOTHING`,
      [target.id, ACTOR],
    ),
    'aceitou:0',
  );
  assert.equal(
    await attempt(
      { role: OWNER },
      `INSERT INTO ${TABLE} (id, super_admin_id, action) VALUES ($1::uuid, $2::uuid, 'x')
       ON CONFLICT (id) DO UPDATE SET action = excluded.action`,
      [target.id, ACTOR],
    ),
    'gatilho',
  );
  assert.equal(await attempt({ role: OWNER }, UPDATE_ROW, [target.id]), 'gatilho');
  assert.equal(await attempt({ role: OWNER }, DELETE_ROW, [target.id]), 'gatilho');
  assert.equal(await attempt({ role: OWNER }, EMPTY_TABLE), 'gatilho');
  pass(
    'o dono lê e grava (INSERT, ON CONFLICT DO NOTHING, modo replica) e não altera, não apaga, não esvazia; upsert também para',
  );

  // ── 5. Superuser e modo replica ──
  const privilegedContexts: Ctx[] = [{}, { replica: true }, { role: OWNER, replica: true }];
  for (const ctx of privilegedContexts) {
    assert.equal(await attempt(ctx, UPDATE_ROW, [target.id]), 'gatilho');
    assert.equal(await attempt(ctx, DELETE_ROW, [target.id]), 'gatilho');
    assert.equal(await attempt(ctx, EMPTY_TABLE), 'gatilho');
  }
  // Contraprova: ENABLE comum (origem) em vez de ALWAYS deixaria o modo replica apagar.
  let deletedInReplica = -1;
  try {
    await sql.begin(async (tx) => {
      await tx.unsafe(`ALTER TABLE ${TABLE} ENABLE TRIGGER super_admin_actions_append_only_row`);
      await tx.unsafe('SET LOCAL session_replication_role = replica');
      const result = await tx.unsafe(DELETE_ROW, [target.id]);
      throw new Rollback(result.count);
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
    deletedInReplica = error.count;
  }
  assert.equal(deletedInReplica, 1, 'sem ALWAYS, o modo replica apagaria a linha');
  assert.equal(
    (await triggers()).every((t) => t.enabled === 'A'),
    true,
    'ALWAYS de volta após o rollback',
  );
  pass(
    'superuser e session_replication_role = replica também param na barreira; contraprova: com ENABLE comum, o modo replica apagaria',
  );

  // ── 6. Papéis da API e do runtime: privilégio negado ──
  const apiCases: { ctx: Ctx; label: string }[] = [
    { ctx: { role: 'service_role' }, label: 'service_role' },
    {
      ctx: { role: 'authenticated', claims: SUPER_ADMIN_CLAIMS },
      label: 'authenticated (super_admin)',
    },
    { ctx: { role: 'qoro_runtime' }, label: 'qoro_runtime' },
    { ctx: { role: 'anon' }, label: 'anon' },
  ];
  for (const { ctx, label } of apiCases) {
    assert.equal(await attempt(ctx, SELECT_ALL), 'privilégio', `${label} SELECT`);
    assert.equal(
      await attempt(ctx, FORGED_ROW, [OTHER_ACTOR, CLINIC]),
      'privilégio',
      `${label} INSERT`,
    );
    assert.equal(await attempt(ctx, UPDATE_ROW, [target.id]), 'privilégio', `${label} UPDATE`);
    assert.equal(await attempt(ctx, DELETE_ROW, [target.id]), 'privilégio', `${label} DELETE`);
    assert.equal(await attempt(ctx, EMPTY_TABLE), 'privilégio', `${label} esvaziamento`);
  }
  pass(
    'service_role, authenticated com claim de super_admin, qoro_runtime e anon: 42501 em leitura, gravação forjada, alteração, remoção e esvaziamento',
  );

  // ── 7. Nada mudou ──
  assert.deepEqual(await digest(), before);
  pass(
    `linhas idênticas depois de todas as tentativas (${before.rows} linhas, md5 ${before.md5.slice(0, 12)}…)`,
  );

  // ── 8. Reset de pré-lançamento ──
  const existing: string[] = [];
  for (const table of RESET_TABLES) {
    const [row] = await sql.unsafe<{ ok: boolean }[]>('SELECT to_regclass($1) IS NOT NULL AS ok', [
      `public."${table}"`,
    ]);
    if (row?.ok) existing.push(table);
  }
  assert.ok(!existing.includes('super_admin_actions'), 'a lista atual preserva a trilha');
  // A lista de antes do ADR-075: a trilha logo depois de idempotency_keys.
  const listBefore075 = existing.flatMap((table) =>
    table === 'idempotency_keys' ? [table, 'super_admin_actions'] : [table],
  );
  assert.ok(listBefore075.includes('super_admin_actions'));
  if (existing.length !== RESET_TABLES.length) {
    console.log(
      `  (reset: ${RESET_TABLES.length - existing.length} tabela(s) da lista não existem nesta branch)`,
    );
  }
  const resetLike = async (tables: readonly string[]): Promise<Outcome> => {
    try {
      await sql.begin(async (tx) => {
        for (const table of tables) await tx.unsafe(`DELETE FROM public."${table}"`);
        await tx.unsafe('DELETE FROM public.clinics');
        await tx.unsafe('DELETE FROM public.profiles WHERE id <> $1::uuid', [randomUUID()]);
        throw new Rollback(0);
      });
    } catch (error) {
      return classify(error);
    }
    return 'erro:sem-rollback';
  };
  assert.equal(await resetLike(existing), 'aceitou:0');
  assert.equal(await resetLike(listBefore075), 'gatilho');
  assert.deepEqual(await digest(), before);
  pass(
    'reset:prod com a lista atual passa e preserva a trilha; com a lista antiga (trilha incluída) abortaria inteiro, sem apagar nada',
  );

  // ── 9. Reversão do cabeçalho e reaplicação ──
  for (const statement of reversal) await sql.unsafe(statement);
  assert.deepEqual(await triggers(), []);
  const [gone] = await sql.unsafe<{ ok: boolean }[]>(
    `SELECT to_regprocedure('${FN}') IS NULL AS ok`,
  );
  assert.equal(gone?.ok, true);
  assert.equal(await schemaVersionPresent(), false);
  assert.deepEqual(await privileges('service_role'), ['SELECT', 'INSERT', 'UPDATE', 'DELETE']);
  assert.deepEqual(await privileges('authenticated'), ['SELECT', 'INSERT']);
  assert.equal(await attempt({ role: OWNER }, DELETE_ROW, [target.id]), 'aceitou:1');
  assert.equal(await attempt({ role: 'service_role' }, DELETE_ROW, [target.id]), 'aceitou:1');
  await sql.unsafe(body);
  assert.equal(await attempt({ role: OWNER }, DELETE_ROW, [target.id]), 'gatilho');
  assert.equal(await attempt({ role: 'service_role' }, DELETE_ROW, [target.id]), 'privilégio');
  assert.equal(await schemaVersionPresent(), true);
  assert.deepEqual(await digest(), before);
  pass(
    'reversão do cabeçalho volta ao estado das migrations 0010/0028; a candidata reaplica e a barreira volta',
  );

  assert.equal(passed, 10, 'todas as provas rodaram');
  console.log(`\n${passed}/10 provas PASS — candidata NÃO aplicada em banco persistente.`);
} finally {
  await cluster.stop();
}
