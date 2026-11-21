/**
 * Ensaio da 0161 (P4.6) sobre os DADOS do DEV, num Postgres DESCARTÁVEL, com o MIGRADOR REAL
 * (`drizzle-kit migrate`, o mesmo do aplicador do DEV), e prova de que o backup restaura.
 * Nada é escrito no DEV.
 *
 *   1. cadeia do DEV até a 0160 (a 0159 do #53 com os bytes aplicados) no descartável; restaura
 *      o dump de dados (todas as hi_* + clinics) e o ledger tirados do DEV antes da janela:
 *      contagens e md5 iguais aos do pré-voo do DEV;
 *   2. o guarda de composição (com as exceções do #53, como no DEV) vê só a 0161 pendente;
 *   3. com outra sessão segurando hi_guides, o migrador desiste no lock_timeout e NADA muda
 *      (transação única: nem coluna, nem linha no ledger);
 *   4. liberado, o migrador aplica só a 0161; o ledger ganha 1 linha com o sha256 do arquivo;
 *   5. dados intocados (guias, revisões, eventos, itens) e o CHECK validado sobre as linhas reais;
 *   6. os gatilhos sobre as guias restauradas: na guia em edição o ajuste grava e o histórico
 *      registra só o NOME do campo; na guia já emitida o ajuste é recusado; forma inválida
 *      recusada (tudo numa transação desfeita);
 *   7. segunda execução do migrador não faz nada;
 *   8. a reversão documentada (+ a linha do ledger) desfaz sem tocar os dados, e o migrador
 *      reaplica igual depois dela.
 *
 *   BACKUP_DIR=<pasta do backup-0161> PRE_FLIGHT=<pre-0161.json> PORT=55547 \
 *   NODE_OPTIONS=--conditions=react-server npx tsx scripts/security/hi-0161-restore-rehearsal.ts
 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { MIGRATION_COMPOSITION_MANIFEST as MANIFEST } from '../../src/lib/db/migration-composition.manifest';

import { readDevOrderChain } from './dev-order-chain';
import { allowExternalApplied, checkComposition } from './migration-composition-io';
import { connectScratch, startScratchSchema } from './scratch-schema';

const PORT = Number(process.env.PORT ?? 55547);
const BACKUP = process.env.BACKUP_DIR;
const PRE = process.env.PRE_FLIGHT;
if (!BACKUP || !PRE) throw new Error('BACKUP_DIR e PRE_FLIGHT são obrigatórios');
type Digest = { n: number; digest: string };
const pre = JSON.parse(readFileSync(PRE, 'utf8')) as {
  raw: { led: { n: number; last: string }; g: Digest; snap: Digest; ev: Digest; items: Digest };
};
const T0161 = '0161_hi_guide_consulta_overrides';
const WHEN_0160 = '1795123373857';
const WHEN_0161 = '1795209773857';
const sha = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
const body0161 = readFileSync(path.resolve(`drizzle/migrations/${T0161}.sql`));

const chain = (await readDevOrderChain()).filter((m) => !m.file.startsWith('0161_'));
assert.equal(chain.at(-1)!.file, '0160_patient_external_refunds.sql');
const cluster = await startScratchSchema({ port: PORT, maxConnections: 4, migrations: chain });
const { sql } = cluster;
if (!new RegExp(`@(?:127\\.0\\.0\\.1|localhost):${PORT}/`, 'u').test(cluster.url))
  throw new Error('não é o cluster local');
let passed = 0;
const pass = (m: string) => {
  passed += 1;
  console.log(`PASS ${passed}: ${m}`);
};

// Pacote do migrador: CÓPIA da pasta desta branch (o journal do repositório não é tocado).
const pkg = mkdtempSync(path.join(os.tmpdir(), 'qoro-0161-rehearsal-'));
const folder = path.join(pkg, 'migrations');
cpSync('drizzle/migrations', folder, { recursive: true });
const config = path.join(pkg, 'drizzle.config.cjs');
writeFileSync(
  config,
  `module.exports = { dialect: 'postgresql', out: ${JSON.stringify(folder.replace(/\\/g, '/'))}, dbCredentials: { url: process.env.DATABASE_URL, ssl: 'require' } };\n`,
);
const migrate = () =>
  spawnSync(
    process.execPath,
    [path.resolve('node_modules/drizzle-kit/bin.cjs'), 'migrate', `--config=${config}`],
    {
      encoding: 'utf8',
      windowsHide: true,
      env: { ...process.env, DATABASE_URL: cluster.url, NODE_ENV: 'development' },
    },
  );

const digest = async () => {
  const [g] = await sql<Digest[]>`select count(*)::int n,
      md5(coalesce(string_agg(id::text || status::text || version::text || guide_type::text || extract(epoch from updated_at)::text, ',' order by id), '')) digest
    from public.hi_guides`;
  const [snap] = await sql<
    Digest[]
  >`select count(*)::int n, md5(coalesce(string_agg(id::text || guide_id::text || revision::text, ',' order by id), '')) digest from public.hi_guide_snapshots`;
  const [ev] = await sql<
    Digest[]
  >`select count(*)::int n, md5(coalesce(string_agg(id::text, ',' order by id), '')) digest from public.hi_guide_events`;
  const [items] = await sql<
    Digest[]
  >`select count(*)::int n, md5(coalesce(string_agg(id::text || guide_id::text || coalesce(total_value_cents::text, ''), ',' order by id), '')) digest from public.hi_guide_items`;
  return { g: g!, snap: snap!, ev: ev!, items: items! };
};
const same = (a: Awaited<ReturnType<typeof digest>>, b: typeof pre.raw) =>
  (['g', 'snap', 'ev', 'items'] as const).every(
    (k) => a[k].n === b[k].n && a[k].digest === b[k].digest,
  );
const ledger = async () => {
  const [r] = await sql<{ n: number; last: string; hash: string }[]>`
    select count(*)::int n, max(created_at)::text last,
      (select hash from drizzle.__drizzle_migrations order by created_at desc limit 1) hash
    from drizzle.__drizzle_migrations`;
  return r!;
};
const objects = async () => {
  const [o] = await sql<{ col: boolean; chk: boolean; trg: boolean; fn: boolean; ver: boolean }[]>`
    select
      exists (select 1 from information_schema.columns where table_schema='public' and table_name='hi_guides' and column_name='consulta_overrides') col,
      exists (select 1 from pg_constraint where conname='hi_guides_consulta_overrides_chk') chk,
      exists (select 1 from pg_trigger where tgname='hi_guides_ab_consulta_overrides') trg,
      to_regprocedure('public.hi_guide_guard_consulta_overrides()') is not null fn,
      exists (select 1 from public._schema_version where version='0161-hi-guide-consulta-overrides') ver`;
  return o!;
};
type PgErr = { code?: string; message?: string };

try {
  // ── 1. O backup restaura (dados e ledger) ─────────────────────────────
  const psql = 'C:/Program Files/PostgreSQL/17/bin/psql.exe';
  const load = (file: string) =>
    execFileSync(
      psql,
      [cluster.url, '-v', 'ON_ERROR_STOP=1', '-q', '-f', path.join(BACKUP, file)],
      {
        stdio: ['ignore', 'ignore', 'pipe'],
        windowsHide: true,
      },
    );
  load('data-hi-tables.sql');
  await sql`create schema if not exists drizzle`;
  await sql`create table if not exists drizzle.__drizzle_migrations (id serial primary key, hash text not null, created_at bigint)`;
  load('data-drizzle-ledger.sql');
  const restored = await digest();
  const led0 = await ledger();
  assert.ok(same(restored, pre.raw), 'md5 do restaurado difere do pré-voo do DEV');
  assert.deepEqual([led0.n, led0.last], [pre.raw.led.n, WHEN_0160]);
  pass(
    `o backup restaura: ${restored.g.n} guias, ${restored.snap.n} revisões emitidas, ${restored.ev.n} eventos e ${restored.items.n} itens com o MESMO md5 do pré-voo do DEV; ledger com ${led0.n} linhas, última a 0160`,
  );

  // ── 2. Guarda de composição: só a 0161 pendente ───────────────────────
  const allowances = await allowExternalApplied(sql, MANIFEST, folder);
  const planBefore = await checkComposition({ folder, manifest: MANIFEST, sql, allowances });
  assert.deepEqual(planBefore.pending, [T0161]);
  pass(
    `guarda de composição sobre o ledger restaurado (exceções do #53: ${allowances.length}): nenhum bloqueio, pendente só a 0161`,
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
    await tx`lock table public.hi_guides in row exclusive mode`;
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
  const o1 = await objects();
  assert.deepEqual([led1.n, led1.last], [led0.n, WHEN_0160]);
  assert.deepEqual(Object.values(o1), [false, false, false, false, false]);
  pass(
    `com outra sessão segurando hi_guides, o migrador desiste no lock_timeout (${blockedMs} ms no total) e nada muda: sem coluna, sem CHECK, sem gatilho, ledger com ${led1.n} linhas`,
  );

  // ── 4. Liberado: aplica só a 0161 ─────────────────────────────────────
  const t4 = performance.now();
  const applied = migrate();
  const appliedMs = Math.round(performance.now() - t4);
  assert.equal(applied.status, 0, `drizzle-kit migrate: ${applied.stdout}\n${applied.stderr}`);
  const led2 = await ledger();
  assert.deepEqual([led2.n, led2.last, led2.hash], [led0.n + 1, WHEN_0161, sha(body0161)]);
  assert.deepEqual(Object.values(await objects()), [true, true, true, true, true]);
  const planAfter = await checkComposition({ folder, manifest: MANIFEST, sql, allowances });
  assert.equal(planAfter.pending.length, 0);
  pass(
    `o migrador real aplica só a 0161 (${appliedMs} ms com a partida da CLI): ledger ${led2.n} linhas, última com o sha256 do arquivo (${led2.hash.slice(0, 12)}…); nada pendente depois`,
  );

  // ── 5. Dados intocados e CHECK validado sobre as linhas reais ─────────
  const after = await digest();
  const [chk] = await sql<{ convalidated: boolean; nonnull: number }[]>`
    select (select convalidated from pg_constraint where conname='hi_guides_consulta_overrides_chk') convalidated,
      (select count(*)::int from public.hi_guides where consulta_overrides is not null) nonnull`;
  assert.ok(same(after, pre.raw), 'dados mudaram com a migration');
  assert.deepEqual([chk!.convalidated, chk!.nonnull], [true, 0]);
  pass(
    'guias, revisões, eventos e itens com o mesmo md5 (nenhuma linha reescrita, nenhum evento novo); CHECK validado sobre as guias reais; nenhuma guia com ajuste',
  );

  // ── 6. Gatilhos sobre as guias restauradas (transação desfeita) ───────
  const guides = await sql<{ id: string; status: string; guide_type: string }[]>`
    select id, status, guide_type from public.hi_guides order by id`;
  const editable = guides.find(
    (g) => g.guide_type === 'consulta' && ['pending_data', 'ready_for_review'].includes(g.status),
  );
  const issued = guides.filter((g) => !['pending_data', 'ready_for_review'].includes(g.status));
  assert.ok(editable, 'o DEV deveria ter uma Consulta em edição');
  assert.ok(issued.length > 0, 'o DEV deveria ter guias já emitidas');
  const ROLLBACK = Symbol('rollback');
  const actor = '00000000-0000-4000-8000-0000000000a1';
  const outcome = await sql
    .begin(async (tx) => {
      await tx`select set_config('app.current_user', ${actor}, true)`;
      const [v] = await tx<{ version: number }[]>`
        update public.hi_guides set consulta_overrides = '{"tipoConsulta":"4","observacao":"Ensaio"}'::jsonb
         where id = ${editable!.id}::uuid returning version`;
      const [ev] = await tx<{ changed: string[] }[]>`
        select changed_fields::text[] changed from public.hi_guide_events
         where guide_id = ${editable!.id}::uuid order by created_at desc, id desc limit 1`;
      const refused: string[] = [];
      for (const g of issued) {
        await tx.unsafe('SAVEPOINT s');
        try {
          await tx`update public.hi_guides set consulta_overrides = '{"tipoConsulta":"4"}'::jsonb where id = ${g.id}::uuid`;
        } catch (e) {
          // A mensagem identifica QUEM recusou: o gatilho da 0161, não a transição da 0152.
          const byGuard = String((e as PgErr).message).includes('ajustar os dados da consulta');
          refused.push(`${g.status}:${(e as PgErr).code}${byGuard ? '' : ':outro'}`);
        }
        await tx.unsafe('ROLLBACK TO SAVEPOINT s');
      }
      await tx.unsafe('SAVEPOINT s');
      let invalid = '';
      try {
        await tx`update public.hi_guides set consulta_overrides = '{"tipoConsulta":"44"}'::jsonb where id = ${editable!.id}::uuid`;
      } catch (e) {
        invalid = String((e as PgErr).code);
      }
      await tx.unsafe('ROLLBACK TO SAVEPOINT s');
      throw Object.assign(new Error('desfaz'), {
        [ROLLBACK]: { v: v!.version, ev: ev!, refused, invalid },
      });
    })
    .catch((e: Record<symbol, unknown>) => {
      if (!e[ROLLBACK]) throw e;
      return e[ROLLBACK] as {
        v: number;
        ev: { changed: string[] };
        refused: string[];
        invalid: string;
      };
    });
  assert.deepEqual(outcome.ev.changed, ['consulta_overrides']);
  assert.equal(outcome.refused.length, issued.length);
  assert.ok(
    outcome.refused.every((r) => r.endsWith(':55000')),
    outcome.refused.join(','),
  );
  assert.equal(outcome.invalid, '23514');
  assert.ok(same(await digest(), pre.raw));
  pass(
    `gatilhos sobre as guias do DEV: na Consulta em edição o ajuste grava (versão ${outcome.v}) e o histórico registra só ["consulta_overrides"]; nas ${issued.length} já emitidas (${[...new Set(issued.map((g) => g.status))].join(', ')}) o ajuste é recusado (55000); código "44" recusado pelo CHECK (23514); tudo desfeito`,
  );

  // ── 7. Segunda execução: nada a fazer ─────────────────────────────────
  const again = migrate();
  assert.equal(again.status, 0, `${again.stdout}\n${again.stderr}`);
  assert.equal((await ledger()).n, led2.n);
  pass('segunda execução do migrador não aplica nada (ledger igual)');

  // ── 8. Reversão documentada (+ linha do ledger) e reaplicação ─────────
  await sql.begin(async (tx) => {
    await tx`DROP TRIGGER IF EXISTS hi_guides_ab_consulta_overrides ON public.hi_guides`;
    await tx`DROP FUNCTION IF EXISTS public.hi_guide_guard_consulta_overrides()`;
    await tx`ALTER TABLE public.hi_guides DROP COLUMN IF EXISTS consulta_overrides`;
    await tx`DELETE FROM public._schema_version WHERE version = '0161-hi-guide-consulta-overrides'`;
    await tx`DELETE FROM drizzle.__drizzle_migrations WHERE created_at = ${WHEN_0161}::bigint`;
  });
  assert.deepEqual(Object.values(await objects()), [false, false, false, false, false]);
  assert.ok(same(await digest(), pre.raw));
  assert.deepEqual([(await ledger()).n, (await ledger()).last], [led0.n, WHEN_0160]);
  const reapplied = migrate();
  assert.equal(reapplied.status, 0, `${reapplied.stdout}\n${reapplied.stderr}`);
  assert.deepEqual([(await ledger()).n, (await ledger()).hash], [led2.n, sha(body0161)]);
  assert.ok(same(await digest(), pre.raw));
  pass(
    'a reversão documentada (gatilho, função, coluna, versão e a linha do ledger) desfaz sem tocar os dados, e o migrador reaplica igual depois dela',
  );

  console.log(
    `\n${passed}/8 provas do ensaio da 0161 passaram (descartável, dados do backup do DEV).`,
  );
} finally {
  rmSync(pkg, { recursive: true, force: true });
  await cluster.stop();
}
process.exit(0);
