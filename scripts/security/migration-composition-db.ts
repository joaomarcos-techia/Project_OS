/**
 * Prova do GUARDA DE COMPOSIÇÃO (src/lib/db/migration-composition.ts) com o MIGRADOR REAL do
 * Drizzle (`drizzle-kit migrate`) em Postgres DESCARTÁVEL — nunca no DEV nem em produção.
 *
 * Estado inicial de cada cluster: a cadeia na ordem do DEV até a 0158 (main 0000–0135 → #53
 * 0136–0142 lidas por `git show` → #55 0143–0158) com o ledger `drizzle.__drizzle_migrations`
 * sintetizado (sha256 do arquivo + `when` do journal), exatamente como um banco que recebeu tudo
 * até a cauda TISS.
 *
 * Prova, em ordem:
 *  1. composição INCORRETA (o #55 sem a 0159 do #53): o guarda recusa ANTES de qualquer DDL —
 *     lacuna 0159 e dependência ausente — e o ledger não muda;
 *  2. o perigo que o guarda evita: sem ele, o migrador aplica a 0160; quando a 0159 chega depois,
 *     o MESMO migrador sai com sucesso e não a aplica (pulada em silêncio, tabela ausente); o
 *     guarda acusa WOULD_SKIP nesse banco;
 *  3. estado de schema inesperado: a tabela da 0159 criada por fora → SCHEMA_STATE; linha do ledger
 *     desconhecida → APPLIED_UNKNOWN; hash aplicado alterado na 0160 → APPLIED_HASH_MISMATCH;
 *  4. composição CORRETA (outro cluster): o guarda aceita, pendentes = [0159, 0160, e as do #55
 *     depois da fronteira, como a 0161]; o migrador aplica todas, o guarda depois não vê pendência
 *     e as sentinelas existem; segunda execução não reaplica nada;
 *  5. sem banco: hash divergente da 0159 (PINNED_HASH_MISMATCH) e manifesto incompatível
 *     (PINNED_WHEN_MISMATCH) recusados;
 *  6. o pré-voo de produção (`--check-composition`) é só leitura: papel sem privilégio de escrita,
 *     `BEGIN READ ONLY`, toda consulta registrada (só SELECT e SET LOCAL), ledger idêntico antes e
 *     depois; fora de READ ONLY recusa; escrita em READ ONLY recusada pelo próprio Postgres (25006).
 *
 *   PR53_REF=<ref do #53> npx tsx scripts/security/migration-composition-db.ts
 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { MigrationCompositionError } from '@/lib/db/migration-composition';
import { MIGRATION_COMPOSITION_MANIFEST as MANIFEST } from '@/lib/db/migration-composition.manifest';

import {
  PR53_CANDIDATE_REF,
  PR53_CANDIDATE_SHA256,
  readDevOrderChain,
  readPr53FinancialCandidate,
} from './dev-order-chain';
import {
  type ReadOnlySql,
  checkComposition,
  checkCompositionInReadOnlyTx,
} from './migration-composition-io';
import { composeReleaseMigrations } from './compose-release-migrations';
import { type ScratchCluster, connectScratch, startScratchSchema } from './scratch-schema';

const PR53_REF = process.env.PR53_REF ?? 'origin/feat/billing-abacatepay-20261107';
const PORT = Number(process.env.PORT ?? 55536);
const T0159 = '0159_saas_period_snapshot';
const T0160 = '0160_patient_external_refunds';

const results: string[] = [];
const pass = (msg: string) => {
  results.push(msg);
  console.log(`PASS: ${msg}`);
};
const git = (...a: string[]) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 64 << 20 });
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

interface JournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}

const localJournal = JSON.parse(readFileSync('drizzle/migrations/meta/_journal.json', 'utf8')) as {
  version: string;
  dialect: string;
  entries: JournalEntry[];
};
/**
 * Migrations do #55 DEPOIS da 0160 (fora da fronteira com o #53; a 0161 da P4.6 é a primeira). Elas
 * entram nas contagens e nas pendências exatas abaixo: o pacote composto as leva junto.
 */
const afterFrontier = localJournal.entries.filter((e) => e.idx > 160).map((e) => e.tag);
const lastTag = afterFrontier.at(-1) ?? T0160;
const lastWhen = String(localJournal.entries.find((e) => e.tag === lastTag)!.when);
const pr53Entries = (
  JSON.parse(git('show', `${PR53_REF}:drizzle/migrations/meta/_journal.json`)) as {
    entries: JournalEntry[];
  }
).entries.filter((e) => e.idx >= 136 && e.idx <= 142);
assert.equal(pr53Entries.length, 7, 'o #53 deve ter 0136–0142 no journal');
const candidate0159 = readPr53FinancialCandidate(PR53_CANDIDATE_REF);
assert.equal(sha(candidate0159), PR53_CANDIDATE_SHA256, 'a 0159 candidata não é a aplicada no DEV');

const packages: string[] = [];
/** Pacote de migrations DESCARTÁVEL (cópia; nunca o journal do repositório). */
function buildPackage(opts: { with0159: boolean; mutate0159?: boolean }): {
  dir: string;
  folder: string;
  config: string;
} {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'qoro-composition-'));
  packages.push(dir);
  const folder = path.join(dir, 'migrations');
  cpSync('drizzle/migrations', folder, { recursive: true });
  for (const e of pr53Entries) {
    writeFileSync(
      path.join(folder, `${e.tag}.sql`),
      git('show', `${PR53_REF}:drizzle/migrations/${e.tag}.sql`),
    );
  }
  const entries = [...localJournal.entries, ...pr53Entries];
  if (opts.with0159) {
    const pinned = MANIFEST.pinned.find((p) => p.tag === T0159)!;
    writeFileSync(
      path.join(folder, `${T0159}.sql`),
      opts.mutate0159 ? `${candidate0159}\n-- alterada depois de fixada\n` : candidate0159,
    );
    entries.push({ idx: 159, version: '7', when: pinned.when, tag: T0159, breakpoints: true });
  }
  entries.sort((a, b) => a.idx - b.idx);
  writeFileSync(
    path.join(folder, 'meta/_journal.json'),
    JSON.stringify({ ...localJournal, entries }, null, 2),
  );
  const config = path.join(dir, 'drizzle.config.cjs');
  writeFileSync(
    config,
    `module.exports = { dialect: 'postgresql', out: ${JSON.stringify(folder.replace(/\\/g, '/'))}, dbCredentials: { url: process.env.DATABASE_URL, ssl: 'require' } };\n`,
  );
  return { dir, folder, config };
}

function drizzleMigrate(url: string, config: string): string {
  const r = spawnSync(
    process.execPath,
    [path.resolve('node_modules/drizzle-kit/bin.cjs'), 'migrate', `--config=${config}`],
    {
      encoding: 'utf8',
      windowsHide: true,
      env: { ...process.env, DATABASE_URL: url, NODE_ENV: 'development' },
    },
  );
  assert.equal(r.status, 0, `drizzle-kit migrate: ${r.stdout}\n${r.stderr}`);
  return `${r.stdout}${r.stderr}`;
}

async function startAt0158(port: number): Promise<ScratchCluster> {
  const chain = await readDevOrderChain(PR53_REF);
  const i0159 = chain.findIndex((m) => m.file.startsWith('0159_'));
  assert.ok(i0159 > 0 && chain[i0159 - 1]!.file.startsWith('0158_'));
  const cluster = await startScratchSchema({
    port,
    maxConnections: 2,
    migrations: chain.slice(0, i0159),
  });
  // Ledger como o de um banco que recebeu tudo até a 0158 pelo migrador.
  const whenOf = new Map([...localJournal.entries, ...pr53Entries].map((e) => [e.tag, e.when]));
  await cluster.sql`create schema if not exists drizzle`;
  await cluster.sql`create table if not exists drizzle.__drizzle_migrations (id serial primary key, hash text not null, created_at bigint)`;
  for (const m of chain.slice(0, i0159)) {
    const when = whenOf.get(m.file.replace(/\.sql$/u, ''));
    assert.ok(when, `sem when para ${m.file}`);
    await cluster.sql`insert into drizzle.__drizzle_migrations (hash, created_at) values (${sha(m.body)}, ${when})`;
  }
  return cluster;
}

async function ledgerCount(cluster: ScratchCluster): Promise<{ n: number; last: string }> {
  const [r] = await cluster.sql<{ n: number; last: string }[]>`
    select count(*)::int n, max(created_at)::text last from drizzle.__drizzle_migrations`;
  return r!;
}

async function relationExists(cluster: ScratchCluster, name: string): Promise<boolean> {
  const [r] = await cluster.sql<{ ok: boolean }[]>`select to_regclass(${name}) is not null as ok`;
  return r!.ok;
}

async function refused(check: Parameters<typeof checkComposition>[0]): Promise<string[]> {
  try {
    await checkComposition(check);
  } catch (error) {
    assert.ok(error instanceof MigrationCompositionError, String(error));
    return error.problems.map((p) => `${p.code}:${p.subject}`);
  }
  assert.fail('o guarda deveria ter recusado');
}

const asSql = (c: ScratchCluster) => c.sql as unknown as ReadOnlySql;
const clusters: ScratchCluster[] = [];
try {
  const wrong = buildPackage({ with0159: false });
  const right = buildPackage({ with0159: true });

  // ---------------------------------------------------------------- 1. composição incorreta
  const c1 = await startAt0158(PORT);
  clusters.push(c1);
  const before = await ledgerCount(c1);
  assert.equal(before.n, 159);
  assert.equal(
    before.last,
    String(MANIFEST.pinned.find((p) => p.tag === '0158_hi_copay_charge')!.when),
  );
  const p1 = await refused({ folder: wrong.folder, manifest: MANIFEST, sql: asSql(c1) });
  assert.deepEqual(p1, [`JOURNAL_IDX_GAP:${T0159}`, `REQUIRED_MISSING:${T0159}`]);
  assert.deepEqual(await ledgerCount(c1), before);
  assert.equal(await relationExists(c1, 'public.patient_external_refunds'), false);
  pass(
    'composição incorreta (#55 sem a 0159): recusada antes de qualquer DDL, ledger intacto (159 linhas)',
  );

  // ---------------------------------------------------------------- 2. o perigo sem guarda
  drizzleMigrate(c1.url, wrong.config);
  const afterWrong = await ledgerCount(c1);
  assert.equal(afterWrong.n, 160 + afterFrontier.length);
  assert.equal(afterWrong.last, lastWhen);
  assert.equal(await relationExists(c1, 'public.patient_external_refunds'), true);
  drizzleMigrate(c1.url, right.config); // a 0159 chega depois: o migrador "passa"…
  assert.deepEqual(await ledgerCount(c1), afterWrong); // …e não aplica nada
  assert.equal(await relationExists(c1, 'billing_gateway.renewal_api_readbacks'), false);
  pass(
    'sem o guarda: o migrador real aplica a 0160 e depois PULA a 0159 em silêncio (sai 0, tabela ausente)',
  );
  const p2 = await refused({ folder: right.folder, manifest: MANIFEST, sql: asSql(c1) });
  assert.deepEqual(p2, [`WOULD_SKIP:${T0159}`]);
  pass('nesse banco o guarda acusa WOULD_SKIP da 0159 (explícito, antes de drift)');

  // ---------------------------------------------------------------- 3. estado inesperado
  await c1.sql.unsafe(`create table billing_gateway.renewal_api_readbacks (id uuid primary key)`);
  const p3 = await refused({ folder: right.folder, manifest: MANIFEST, sql: asSql(c1) });
  assert.deepEqual(p3, [`WOULD_SKIP:${T0159}`, `SCHEMA_STATE:${T0159}`]);
  await c1.sql.unsafe(`drop table billing_gateway.renewal_api_readbacks`);
  pass('sentinela da 0159 existindo sem a linha no ledger → SCHEMA_STATE');
  await c1.sql`insert into drizzle.__drizzle_migrations (hash, created_at) values ('deadbeef', 1795300000000)`;
  const p4 = await refused({ folder: right.folder, manifest: MANIFEST, sql: asSql(c1) });
  assert.ok(p4.includes('APPLIED_UNKNOWN:1795300000000'), p4.join(','));
  await c1.sql`delete from drizzle.__drizzle_migrations where created_at = 1795300000000`;
  pass('linha do ledger fora do journal → APPLIED_UNKNOWN');
  await c1.sql`update drizzle.__drizzle_migrations set hash = 'alterado' where created_at = ${MANIFEST.pinned.find((p) => p.tag === T0160)!.when}`;
  const p5 = await refused({ folder: right.folder, manifest: MANIFEST, sql: asSql(c1) });
  assert.ok(p5.includes(`APPLIED_HASH_MISMATCH:${T0160}`), p5.join(','));
  pass('hash aplicado da 0160 diferente do arquivo → APPLIED_HASH_MISMATCH (estrito na fronteira)');

  // ---------------------------------------------------------------- 4. composição correta
  const c2 = await startAt0158(PORT + 1);
  clusters.push(c2);
  const plan = await checkComposition({ folder: right.folder, manifest: MANIFEST, sql: asSql(c2) });
  assert.deepEqual(plan.pending, [T0159, T0160, ...afterFrontier]);
  assert.deepEqual(plan.problems, []);
  pass(
    `composição correta: guarda aceita, pendentes = ${[T0159, T0160, ...afterFrontier].map((t) => t.slice(0, 4)).join(' → ')}`,
  );
  drizzleMigrate(c2.url, right.config);
  const after = await ledgerCount(c2);
  assert.equal(after.n, 161 + afterFrontier.length);
  assert.equal(await relationExists(c2, 'billing_gateway.renewal_api_readbacks'), true);
  assert.equal(await relationExists(c2, 'public.patient_external_refunds'), true);
  const planAfter = await checkComposition({
    folder: right.folder,
    manifest: MANIFEST,
    sql: asSql(c2),
  });
  assert.deepEqual(planAfter.pending, []);
  pass(
    `migrador real aplica 0159, 0160${afterFrontier.length ? ` e ${afterFrontier.map((t) => t.slice(0, 4)).join(', ')}` : ''} (${after.n} linhas), sentinelas presentes, guarda depois sem pendência`,
  );
  drizzleMigrate(c2.url, right.config);
  assert.deepEqual(await ledgerCount(c2), after);
  pass('segunda execução não reaplica nada');

  // ---------------------------------------------------------------- 6. pré-voo só leitura
  // O mesmo caminho do `db-migrate-prod.ts --check-composition`: conexão única rotulada,
  // `BEGIN READ ONLY` e `checkCompositionInReadOnlyTx`, aqui com um papel SEM privilégio de escrita
  // (só USAGE nos esquemas e SELECT no ledger). Toda consulta enviada é registrada.
  // O pacote do pré-voo vem do módulo de composição do lançamento: tem de ser byte a byte o
  // pacote correto deste harness (mesmo journal, mesmos arquivos).
  const releaseDir = mkdtempSync(path.join(os.tmpdir(), 'qoro-compose-release-'));
  packages.push(releaseDir);
  const release = await composeReleaseMigrations({ outDir: releaseDir, pr53Ref: PR53_REF });
  assert.equal(release.entries, 161 + afterFrontier.length);
  assert.equal(release.last, lastTag);
  const filesOf = (dir: string) =>
    readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .sort()
      .map((f) => `${f}:${sha(readFileSync(path.join(dir, f), 'utf8'))}`);
  assert.deepEqual(filesOf(release.folder), filesOf(right.folder));
  assert.equal(
    readFileSync(path.join(release.folder, 'meta/_journal.json'), 'utf8'),
    readFileSync(path.join(right.folder, 'meta/_journal.json'), 'utf8'),
  );
  pass(
    'compose-release-migrations gera o pacote composto idêntico ao correto (journal e arquivos)',
  );
  const fingerprint = async () => {
    const [r] = await c2.sql<{ f: string }[]>`
      select md5(string_agg(id || ':' || hash || ':' || created_at, ',' order by id)) as f
        from drizzle.__drizzle_migrations`;
    return r!.f;
  };
  await c2.sql.unsafe(`create role qoro_check_ro login password 'scratch-only'`);
  await c2.sql.unsafe(
    `grant usage on schema drizzle, public, billing_gateway to qoro_check_ro;
     grant select on drizzle.__drizzle_migrations to qoro_check_ro`,
  );
  const roUrl = new URL(c2.url);
  roUrl.username = 'qoro_check_ro';
  roUrl.password = 'scratch-only';
  const ro = connectScratch(roUrl.toString());

  try {
    const before = await fingerprint();
    const sent: string[] = [];
    const roPlan = await ro.begin('READ ONLY', (tx) =>
      checkCompositionInReadOnlyTx(
        {
          unsafe: (q: string, params?: unknown[]) => {
            sent.push(q);
            return tx.unsafe(q, params as never[]);
          },
        },
        { folder: release.folder, manifest: MANIFEST },
      ),
    );
    assert.deepEqual(roPlan.pending, []);
    assert.deepEqual(roPlan.problems, []);
    const kinds = sent.map((q) => q.trim().split(/\s+/u).slice(0, 2).join(' ').toLowerCase());
    assert.ok(
      kinds.every((k) => k.startsWith('select') || k.startsWith('set local')),
      `consulta fora de SELECT/SET LOCAL: ${kinds.join(' | ')}`,
    );
    assert.equal(await fingerprint(), before);
    pass(
      `pré-voo só leitura (papel sem escrita, BEGIN READ ONLY): ${sent.length} consultas, todas SELECT ou SET LOCAL; ledger idêntico antes e depois`,
    );
    // Fail-closed: fora de transação READ ONLY o helper recusa antes de ler.
    await assert.rejects(
      checkCompositionInReadOnlyTx(ro, { folder: release.folder, manifest: MANIFEST }),
      /fora de transação READ ONLY/u,
    );
    // O Postgres recusa escrita na transação READ ONLY mesmo para o superusuário (25006), e o papel
    // do pré-voo não escreve nem fora dela (42501).
    await assert.rejects(
      c2.sql.begin('READ ONLY', (tx) =>
        tx.unsafe(`insert into drizzle.__drizzle_migrations (hash, created_at) values ('x', 1)`),
      ),
      (e: { code?: string }) => e.code === '25006',
    );
    await assert.rejects(
      ro.unsafe(`insert into drizzle.__drizzle_migrations (hash, created_at) values ('x', 1)`),
      (e: { code?: string }) => e.code === '42501',
    );
    assert.equal(await fingerprint(), before);
    pass(
      'fora de READ ONLY o pré-voo recusa; escrita em READ ONLY recusada pelo Postgres (25006) e o papel do pré-voo sem privilégio (42501)',
    );
  } finally {
    await ro.end({ timeout: 5 });
  }

  // ---------------------------------------------------------------- 5. sem banco
  const mutated = buildPackage({ with0159: true, mutate0159: true });
  assert.deepEqual(await refused({ folder: mutated.folder, manifest: MANIFEST }), [
    `PINNED_HASH_MISMATCH:${T0159}`,
  ]);
  pass('0159 com bytes diferentes do fixado → PINNED_HASH_MISMATCH (sem banco)');
  const badManifest = {
    ...MANIFEST,
    pinned: MANIFEST.pinned.map((p) => (p.tag === T0159 ? { ...p, when: p.when + 1 } : p)),
  };
  assert.deepEqual(await refused({ folder: right.folder, manifest: badManifest }), [
    `PINNED_WHEN_MISMATCH:${T0159}`,
  ]);
  pass('manifesto incompatível (when da 0159) → PINNED_WHEN_MISMATCH');

  console.log(`\nOK ${results.length}/${results.length}`);
} finally {
  for (const c of clusters) await c.stop().catch(() => undefined);
  for (const d of packages) rmSync(d, { recursive: true, force: true });
}
