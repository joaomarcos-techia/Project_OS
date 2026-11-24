/**
 * Ensaio da APLICAÇÃO da candidata 0167 (P8.4, itens executados adicionais) num Postgres
 * DESCARTÁVEL equivalente ao DEV, com o MIGRADOR REAL (`drizzle-kit migrate`, o mesmo do
 * aplicador do DEV). Nada é escrito no DEV; dados 100% sintéticos (nenhum backup do DEV sai do
 * notebook). Prepara o pedido de GO da 0167 no DEV (docs/convenios/go-0167-dev.md).
 *
 *   1. cadeia na ordem do DEV até a 0166 (a 0159 do #53 com os bytes aplicados) e ledger
 *      sintetizado como o do DEV (167 linhas: sha256 do arquivo e `when`; 0136–0142 e 0159 pelo
 *      manifesto de composição); dados sintéticos ANTES da 0167 (clínica, guias emitidas);
 *   2. pacote do migrador = CÓPIA da pasta desta branch + a candidata promovida a 0167 (idx 167,
 *      `when` da 0166 + 1 dia), nunca o journal do repositório; o guarda de composição (com as
 *      exceções do #53, como no DEV) vê só a 0167 pendente;
 *   3. com outra sessão escrevendo em hi_appointment_coverages, o migrador desiste no lock_timeout
 *      e NADA muda (catálogo e ledger iguais);
 *   4. locks que o corpo da 0167 toma em tabelas EXISTENTES (transação desfeita): nenhum
 *      AccessExclusive; ShareRowExclusive só nas três referenciadas pelas FKs (clinics,
 *      hi_appointment_coverages, hi_procedure_contracts): escritas nelas esperam até o COMMIT;
 *   5. liberado, o migrador aplica só a 0167: ledger +1 com o sha256 do arquivo; catálogo anterior
 *      intacto (só acréscimos, todos da 0167); dados de TODAS as tabelas existentes com o mesmo md5
 *      (só `_schema_version` ganha a linha da 0167);
 *   6. segunda execução do migrador não aplica nada;
 *   7. reaplicação indevida (o SQL rodado de novo à mão) falha e não muda nada;
 *   8. compatibilidade: com a tabela, o serviço a vê; os objetos novos têm RLS forçada e o runtime
 *      não tem DELETE;
 *   9. reversão com item registrado: RECUSADA (o registro clínico não se perde), nada removido;
 *  10. reversão sem itens (+ linha do ledger): catálogo e dados EXATAMENTE como antes da 0167; o
 *      serviço volta a responder "não disponível" sem erro, e registrar dá NOT_AVAILABLE;
 *  11. depois da reversão, o migrador reaplica e o catálogo é o mesmo do passo 5.
 *
 *   SECURITY_PG_BIN=... PORT=55570 NODE_OPTIONS="--import ./scripts/security/server-only-hook.mjs" \
 *     ./node_modules/.bin/tsx --tsconfig tsconfig.scripts.json scripts/security/hi-0167-apply-rehearsal.ts
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { MIGRATION_COMPOSITION_MANIFEST as MANIFEST } from '../../src/lib/db/migration-composition.manifest';

import { readDevOrderChain } from './dev-order-chain';
import { allowExternalApplied, checkComposition } from './migration-composition-io';
import { connectScratch, startScratchSchema } from './scratch-schema';

const PORT = Number(process.env.PORT ?? 55570);
const TAG = '0167_hi_appointment_extra_items';
const CANDIDATE = path.resolve(`docs/convenios/migrations/${TAG}.candidate.sql`);
const ROLLBACK = readFileSync(path.resolve(`docs/convenios/migrations/${TAG}.rollback.sql`), 'utf8');
const body0167 = readFileSync(CANDIDATE);
const sha = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');

type JournalEntry = { idx: number; version: string; when: number; tag: string; breakpoints: boolean };
const journal = JSON.parse(readFileSync('drizzle/migrations/meta/_journal.json', 'utf8')) as {
  entries: JournalEntry[];
};
const last = journal.entries.at(-1)!;
assert.equal(last.tag, '0166_hi_authorization_alerts', 'o journal desta branch deveria terminar na 0166');
const WHEN_0166 = String(last.when);
const WHEN_0167 = String(last.when + 86_400_000);

const chain = await readDevOrderChain();
assert.equal(chain.at(-1)!.file, '0166_hi_authorization_alerts.sql');
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
process.env.LOG_LEVEL = 'error';

let passed = 0;
const pass = (m: string) => {
  passed += 1;
  console.log(`PASS ${passed}: ${m}`);
};

// Pacote do migrador: CÓPIA da pasta desta branch + a candidata promovida (o repositório não muda).
const pkg = mkdtempSync(path.join(os.tmpdir(), 'qoro-0167-rehearsal-'));
const folder = path.join(pkg, 'migrations');
cpSync('drizzle/migrations', folder, { recursive: true });
writeFileSync(path.join(folder, `${TAG}.sql`), body0167);
writeFileSync(
  path.join(folder, 'meta', '_journal.json'),
  JSON.stringify(
    { ...journal, entries: [...journal.entries, { ...last, idx: 167, when: Number(WHEN_0167), tag: TAG }] },
    null,
    2,
  ),
);
const config = path.join(pkg, 'drizzle.config.cjs');
writeFileSync(
  config,
  `module.exports = { dialect: 'postgresql', out: ${JSON.stringify(folder.replace(/\\/g, '/'))}, dbCredentials: { url: process.env.DATABASE_URL, ssl: 'require' } };\n`,
);
const migrate = () =>
  spawnSync(process.execPath, [path.resolve('node_modules/drizzle-kit/bin.cjs'), 'migrate', `--config=${config}`], {
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, DATABASE_URL: cluster.url, NODE_ENV: 'development' },
  });

/** Ledger como o DEV: sha256 do arquivo e `when` do journal desta branch; 0136–0142 e 0159 pelo manifesto. */
function ledgerRows(): { hash: string; when: string }[] {
  const local = new Set(journal.entries.map((e) => e.tag));
  const rows = journal.entries.map((e) => ({
    hash: sha(readFileSync(`drizzle/migrations/${e.tag}.sql`)),
    when: String(e.when),
  }));
  for (const p of MANIFEST.pinned.filter((x) => !local.has(x.tag))) rows.push({ hash: p.sha256, when: String(p.when) });
  return rows.sort((a, b) => Number(a.when) - Number(b.when));
}
const ledger = async () => {
  const [r] = await sql<{ n: number; last: string; hash: string }[]>`
    select count(*)::int n, max(created_at)::text last,
      (select hash from drizzle.__drizzle_migrations order by created_at desc limit 1) hash
    from drizzle.__drizzle_migrations`;
  return r!;
};

/** Catálogo do schema public: chave (tipo:nome) → md5 da definição. */
async function catalog(): Promise<Map<string, string>> {
  const rows = await sql<{ k: string; h: string }[]>`
    select kind || ':' || name k, md5(def) h from (
      select 'rel' kind, c.relname::text name,
             c.relkind::text || c.relrowsecurity::text || c.relforcerowsecurity::text || coalesce(c.relacl::text, '') def
        from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p','v','m','S','f')
      union all
      select 'col', c.relname || '.' || a.attname,
             format_type(a.atttypid, a.atttypmod) || a.attnotnull::text || coalesce(pg_get_expr(d.adbin, d.adrelid), '')
        from pg_attribute a join pg_class c on c.oid = a.attrelid
        left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
       where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p','v','m','f') and a.attnum > 0 and not a.attisdropped
      union all
      select 'con', conrelid::regclass::text || '.' || conname, pg_get_constraintdef(oid)
        from pg_constraint where connamespace = 'public'::regnamespace
      union all
      select 'idx', i.indexrelid::regclass::text, pg_get_indexdef(i.indexrelid)
        from pg_index i join pg_class c on c.oid = i.indexrelid where c.relnamespace = 'public'::regnamespace
      union all
      select 'trg', t.tgrelid::regclass::text || '.' || t.tgname, pg_get_triggerdef(t.oid)
        from pg_trigger t join pg_class c on c.oid = t.tgrelid
       where not t.tgisinternal and c.relnamespace = 'public'::regnamespace
      union all
      select 'fn', p.oid::regprocedure::text, pg_get_functiondef(p.oid) || coalesce(p.proacl::text, '')
        from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind in ('f','p')
      union all
      select 'pol', tablename || '.' || policyname,
             permissive || array_to_string(roles, ',') || cmd || coalesce(qual, '') || coalesce(with_check, '')
        from pg_policies where schemaname = 'public'
    ) x`;
  return new Map(rows.map((r) => [r.k, r.h]));
}
/** Contagem e md5 das linhas de TODAS as tabelas do public. */
async function data(): Promise<Map<string, string>> {
  const tables = await sql<{ t: string }[]>`
    select c.relname::text t from pg_class c
     where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p') order by 1`;
  const out = new Map<string, string>();
  for (const { t } of tables) {
    const [r] = await sql.unsafe<{ n: number; h: string }[]>(
      `select count(*)::int n, md5(coalesce(string_agg(md5(x::text), ',' order by md5(x::text)), '')) h from public."${t}" x`,
    );
    out.set(t, `${r!.n}:${r!.h}`);
  }
  return out;
}
const diff = (a: Map<string, string>, b: Map<string, string>) => ({
  added: [...b.keys()].filter((k) => !a.has(k)),
  removed: [...a.keys()].filter((k) => !b.has(k)),
  changed: [...a.keys()].filter((k) => b.has(k) && a.get(k) !== b.get(k)),
});
const NEW_OBJECT = /hi_appointment_extra_items|hi_extra_items_|hi_extra_item_(guide_state|authorization_problem|insert_guard|update_guard)/u;
const statements = (body: string) =>
  body
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter((s) => s.replace(/--.*$/gmu, '').trim().length > 0);
type PgErr = { code?: string; message?: string };

/** Reversão numa conexão própria (o arquivo tem BEGIN/COMMIT; numa falha, a conexão é descartada). */
async function runRollback(): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  const c = connectScratch(cluster.url, 1);
  try {
    await c.unsafe(ROLLBACK);
    return { ok: true };
  } catch (e) {
    await c.unsafe('ROLLBACK').catch(() => undefined);
    return { ok: false, code: String((e as PgErr).code), message: String((e as PgErr).message) };
  } finally {
    await c.end();
  }
}

try {
  // ── 1. Ledger do DEV e dados sintéticos antes da 0167 ─────────────────
  await sql`create schema if not exists drizzle`;
  await sql`create table if not exists drizzle.__drizzle_migrations (id serial primary key, hash text not null, created_at bigint)`;
  for (const r of ledgerRows()) await sql`insert into drizzle.__drizzle_migrations (hash, created_at) values (${r.hash}, ${r.when})`;
  const led0 = await ledger();
  assert.deepEqual([led0.n, led0.last], [167, WHEN_0166]);

  // Privilégio padrão do Supabase ausente no cluster local (antes da fotografia do catálogo).
  await sql`GRANT SELECT ON public.clinics, public.profiles TO authenticated`;
  const { loadHiFixtures } = await import('./hi-fixtures');
  const fx = await loadHiFixtures(sql, {
    store: { async put() {}, async get() { return new Uint8Array(); }, async remove() {} },
    validateXsd: null,
  });
  await fx.seedTerminology();
  const clinic = await fx.setupClinic('Ensaio 0167');
  const g1 = await clinic.approvedGuide();
  const g2 = await clinic.approvedGuide();
  const [counts] = await sql<{ guides: number; appts: number }[]>`
    select (select count(*)::int from public.hi_guides) guides, (select count(*)::int from public.appointments) appts`;
  const { guides, appts } = counts!;
  assert.ok(guides >= 2 && appts >= 2);
  const cat0 = await catalog();
  const data0 = await data();
  pass(
    `cadeia do DEV até a 0166 e ledger como o DEV (${led0.n} linhas, última a 0166); dados sintéticos antes da 0167: ${guides} guias emitidas, ${appts} atendimentos, ${data0.size} tabelas com md5; catálogo de ${cat0.size} objetos`,
  );

  // ── 2. Guarda de composição: só a 0167 pendente ───────────────────────
  const allowances = await allowExternalApplied(sql, MANIFEST, folder);
  const planBefore = await checkComposition({ folder, manifest: MANIFEST, sql, allowances });
  assert.deepEqual(planBefore.pending, [TAG]);
  pass(
    `pacote do migrador com a candidata promovida (idx 167, when ${WHEN_0167}, sha256 ${sha(body0167).slice(0, 12)}…); guarda de composição com as exceções do #53 (${allowances.length}): pendente só a 0167`,
  );

  // Limites da sessão do migrador, como o aplicador do DEV (2 s de lock, 60 s de comando).
  await sql.unsafe(`ALTER DATABASE postgres SET lock_timeout = '2s'`);
  await sql.unsafe(`ALTER DATABASE postgres SET statement_timeout = '60s'`);

  // ── 3. Lock ocupado: o migrador desiste e nada muda ───────────────────
  const blocker = connectScratch(cluster.url, 1);
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  let locked!: () => void;
  const isLocked = new Promise<void>((r) => (locked = r));
  const holding = blocker.begin(async (tx) => {
    await tx`lock table public.hi_appointment_coverages in row exclusive mode`;
    locked();
    await held;
  });
  await isLocked;
  const t3 = performance.now();
  const blocked = migrate();
  const blockedMs = Math.round(performance.now() - t3);
  release();
  await holding;
  await blocker.end();
  assert.notEqual(blocked.status, 0, 'o migrador deveria desistir com o lock ocupado');
  assert.match(`${blocked.stdout}${blocked.stderr}`, /lock timeout|55P03/iu);
  const led1 = await ledger();
  assert.deepEqual([led1.n, led1.last], [led0.n, WHEN_0166]);
  assert.deepEqual(diff(cat0, await catalog()), { added: [], removed: [], changed: [] });
  pass(
    `com outra sessão escrevendo em hi_appointment_coverages, o migrador desiste no lock_timeout (${blockedMs} ms com a partida da CLI) e nada muda: catálogo igual, ledger com ${led1.n} linhas`,
  );

  // ── 4. Locks do corpo da 0167 em tabelas existentes (transação desfeita) ─
  const UNDO = Symbol('undo');
  const locks = await sql
    .begin(async (tx) => {
      for (const s of statements(body0167.toString('utf8'))) await tx.unsafe(s);
      const rows = await tx<{ rel: string; mode: string }[]>`
        select c.relname::text rel, l.mode from pg_locks l join pg_class c on c.oid = l.relation
         where l.pid = pg_backend_pid() and l.locktype = 'relation' and c.relnamespace = 'public'::regnamespace`;
      throw Object.assign(new Error('desfaz'), { [UNDO]: rows });
    })
    .catch((e: Record<symbol, unknown>) => {
      if (!e[UNDO]) throw e;
      return e[UNDO] as { rel: string; mode: string }[];
    });
  const existing = locks.filter((l) => cat0.has(`rel:${l.rel}`));
  assert.ok(existing.every((l) => l.mode !== 'AccessExclusiveLock'), JSON.stringify(existing));
  const shareRow = [...new Set(existing.filter((l) => l.mode === 'ShareRowExclusiveLock').map((l) => l.rel))].sort();
  // P8.4-r (24/11): as FKs novas, da autorização e da linha da guia, entram na lista.
  assert.deepEqual(shareRow, ['clinics', 'hi_appointment_coverages', 'hi_authorization_items', 'hi_guide_items', 'hi_procedure_contracts']);
  assert.deepEqual(diff(cat0, await catalog()), { added: [], removed: [], changed: [] });
  const byRel = [...new Set(existing.map((l) => `${l.rel}=${l.mode.replace('Lock', '')}`))].sort();
  pass(
    `locks do corpo da 0167 em tabelas existentes: nenhum AccessExclusive; ShareRowExclusive só nas cinco referenciadas pelas FKs (clinics, hi_appointment_coverages, hi_authorization_items, hi_guide_items, hi_procedure_contracts), que seguram escritas nelas até o COMMIT; todos: ${byRel.join(', ')}`,
  );

  // ── 5. Liberado: aplica só a 0167 ─────────────────────────────────────
  const t5 = performance.now();
  const applied = migrate();
  const appliedMs = Math.round(performance.now() - t5);
  assert.equal(applied.status, 0, `drizzle-kit migrate: ${applied.stdout}\n${applied.stderr}`);
  const led2 = await ledger();
  assert.deepEqual([led2.n, led2.last, led2.hash], [led0.n + 1, WHEN_0167, sha(body0167)]);
  const cat1 = await catalog();
  const d1 = diff(cat0, cat1);
  assert.deepEqual([d1.removed, d1.changed], [[], []], `catálogo anterior mudou: ${JSON.stringify(d1)}`);
  assert.ok(d1.added.length > 0 && d1.added.every((k) => NEW_OBJECT.test(k)), JSON.stringify(d1.added));
  const data1 = await data();
  const dd1 = diff(data0, data1);
  assert.deepEqual(dd1.removed, []);
  assert.deepEqual(dd1.added, ['hi_appointment_extra_items']);
  assert.deepEqual(dd1.changed, ['_schema_version']);
  assert.equal(data1.get('hi_appointment_extra_items')!.split(':')[0], '0');
  const [ver] = await sql<{ n: number }[]>`select count(*)::int n from public._schema_version where version = '0167-hi-appointment-extra-items'`;
  assert.equal(ver!.n, 1);
  const planAfter = await checkComposition({ folder, manifest: MANIFEST, sql, allowances });
  assert.equal(planAfter.pending.length, 0);
  const kinds = d1.added.reduce<Record<string, number>>((acc, k) => ({ ...acc, [k.split(':')[0]!]: (acc[k.split(':')[0]!] ?? 0) + 1 }), {});
  pass(
    `o migrador real aplica só a 0167 (${appliedMs} ms com a partida da CLI): ledger ${led2.n} linhas com o sha256 do arquivo; catálogo anterior intacto, ${d1.added.length} objetos novos, todos da 0167 (${Object.entries(kinds).map(([k, n]) => `${k} ${n}`).join(', ')}); dados das ${data0.size} tabelas existentes com o mesmo md5, só _schema_version ganhou a linha da 0167; nada pendente`,
  );

  // ── 6. Segunda execução: nada a fazer ─────────────────────────────────
  const again = migrate();
  assert.equal(again.status, 0, `${again.stdout}\n${again.stderr}`);
  assert.equal((await ledger()).n, led2.n);
  assert.deepEqual(diff(cat1, await catalog()), { added: [], removed: [], changed: [] });
  pass('segunda execução do migrador não aplica nada (ledger e catálogo iguais)');

  // ── 7. Reaplicação indevida à mão: falha e não muda nada ──────────────
  let reapplyCode = '';
  try {
    await sql.begin(async (tx) => {
      for (const s of statements(body0167.toString('utf8'))) await tx.unsafe(s);
    });
  } catch (e) {
    reapplyCode = String((e as PgErr).code);
  }
  assert.equal(reapplyCode, '42P07', 'a reaplicação deveria falhar por objeto existente');
  assert.deepEqual(diff(cat1, await catalog()), { added: [], removed: [], changed: [] });
  assert.deepEqual(diff(data1, await data()), { added: [], removed: [], changed: [] });
  assert.equal((await ledger()).n, led2.n);
  pass('reaplicação indevida do SQL à mão falha na primeira instrução (42P07, tabela existente) e a transação desfaz: catálogo, dados e ledger iguais');

  // ── 8. Compatibilidade: o serviço vê a tabela; RLS forçada; sem DELETE no runtime ─
  const extra = await import('../../src/contexts/health-insurance/internal/extra-executed-items');
  const [appt] = await sql<{ id: string }[]>`select appointment_id::text id from public.hi_guide_items where guide_id = ${g1}::uuid limit 1`;
  const seen = await fx.withTenant(clinic.clinicId, async (tx) => ({
    available: await extra.extraItemsAvailableTx(tx),
    items: await extra.listExtraItemsTx(tx, { clinicId: clinic.clinicId, appointmentId: appt!.id }),
  }));
  assert.deepEqual(seen, { available: true, items: [] });
  const [rls] = await sql<{ rls: boolean; force: boolean; del: boolean }[]>`
    select relrowsecurity rls, relforcerowsecurity force,
           has_table_privilege('authenticated', 'public.hi_appointment_extra_items', 'DELETE') del
      from pg_class where oid = 'public.hi_appointment_extra_items'::regclass`;
  assert.deepEqual(rls, { rls: true, force: true, del: false });
  pass('com a 0167, o serviço vê a tabela (disponível, lista vazia na guia emitida); RLS ligada e forçada; o papel do runtime não tem DELETE');

  // ── 9. Reversão com item registrado: recusada ─────────────────────────
  // Linha posta pelo superusuário sem gatilhos (só neste descartável) para provar a guarda da reversão.
  await sql.begin(async (tx) => {
    await tx`set local session_replication_role = replica`;
    await tx`insert into public.hi_appointment_extra_items
      (id, clinic_id, appointment_id, contract_line_id, table_code, procedure_code, description, quantity,
       requires_authorization, source, status, recorded_by)
      select ${randomUUID()}::uuid, ${clinic.clinicId}::uuid, ${appt!.id}::uuid, pc.id, '22', '10101012', 'Ensaio', 1,
             false, 'conferencia', 'recorded', ${clinic.doctorId}::uuid
        from public.hi_procedure_contracts pc where pc.clinic_id = ${clinic.clinicId}::uuid limit 1`;
  });
  const refused = await runRollback();
  assert.equal(refused.ok, false);
  assert.ok(!refused.ok && refused.code === 'P0001' && refused.message.includes('reversão da 0167 recusada'), JSON.stringify(refused));
  const [still] = await sql<{ n: number }[]>`select count(*)::int n from public.hi_appointment_extra_items`;
  assert.equal(still!.n, 1);
  assert.deepEqual(diff(cat1, await catalog()), { added: [], removed: [], changed: [] });
  await sql`delete from public.hi_appointment_extra_items`;
  pass('reversão com um item registrado é RECUSADA (P0001, "há itens executados registrados"): tabela, item, funções e versão continuam lá');

  // ── 10. Reversão sem itens (+ linha do ledger): exatamente o estado anterior ─
  const rolled = await runRollback();
  assert.deepEqual(rolled, { ok: true });
  await sql`delete from drizzle.__drizzle_migrations where created_at = ${WHEN_0167}::bigint`;
  assert.deepEqual(diff(cat0, await catalog()), { added: [], removed: [], changed: [] });
  assert.deepEqual(diff(data0, await data()), { added: [], removed: [], changed: [] });
  assert.deepEqual([(await ledger()).n, (await ledger()).last], [led0.n, WHEN_0166]);
  const after = await fx.withTenant(clinic.clinicId, async (tx) => ({
    available: await extra.extraItemsAvailableTx(tx),
    items: await extra.listExtraItemsTx(tx, { clinicId: clinic.clinicId, appointmentId: appt!.id }),
  }));
  assert.deepEqual(after, { available: false, items: [] });
  let recordCode = '';
  try {
    await fx.withTenant(
      clinic.clinicId,
      (tx) =>
        extra.recordExtraItemTx(tx, {
          clinicId: clinic.clinicId,
          appointmentId: appt!.id,
          contractLineId: randomUUID(),
          quantity: 1,
          source: 'conferencia',
        }),
      clinic.doctorId,
    );
  } catch (e) {
    recordCode = String((e as { code?: string }).code);
  }
  assert.equal(recordCode, 'NOT_AVAILABLE');
  pass(
    `reversão sem itens (arquivo de reversão + linha do ledger): catálogo dos ${cat0.size} objetos e dados das ${data0.size} tabelas EXATAMENTE como antes da 0167 (as quatro funções saem: estado da guia, problema da autorização e as duas guardas); ledger de volta a ${led0.n}; o serviço responde "não disponível" sem erro e registrar dá NOT_AVAILABLE`,
  );

  // ── 11. Reaplicação depois da reversão ────────────────────────────────
  const reapplied = migrate();
  assert.equal(reapplied.status, 0, `${reapplied.stdout}\n${reapplied.stderr}`);
  assert.deepEqual([(await ledger()).n, (await ledger()).hash], [led2.n, sha(body0167)]);
  assert.deepEqual(diff(cat1, await catalog()), { added: [], removed: [], changed: [] });
  assert.ok(g2);
  pass('depois da reversão, o migrador reaplica a 0167 e o catálogo é idêntico ao da primeira aplicação');

  console.log(`\n${passed}/11 provas do ensaio da 0167 passaram (descartável, dados sintéticos, migrador real).`);
} finally {
  rmSync(pkg, { recursive: true, force: true });
  await cluster.stop();
}
process.exit(0);
