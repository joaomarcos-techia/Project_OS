/**
 * Ensaio da APLICAÇÃO NO DEV com o MIGRADOR REAL do Drizzle, num Postgres DESCARTÁVEL equivalente
 * ao DEV (nunca no DEV): cadeia na ordem do DEV até a 0143 (main → #53 0136–0142 → 0143), ledger
 * `drizzle.__drizzle_migrations` com as linhas do DEV (`LEDGER_DUMP`, dump só de metadados) ou
 * sintetizado dos journals, e — com `DATA_DUMP` — os dados das três tabelas compartilhadas que a
 * cauda altera, para o VALIDATE dos CHECKs rodar contra eles.
 *
 * Prova, em ordem:
 *  1. a CLI oficial (`drizzle-kit migrate`) aplica EXATAMENTE 0144–0158 (e nada da 0143 para trás);
 *  2. a segunda execução não aplica nada e o catálogo fica byte a byte igual;
 *  3. os dados existentes não mudam (md5 das linhas com as colunas originais) e o particular
 *     continua particular;
 *  4. a reversão executável (`docs/convenios/reversao-cauda-0144-0158.sql`) devolve o schema
 *     byte a byte ao estado anterior (dump de estrutura idêntico) e o ledger a 144 linhas;
 *  5. depois da reversão, o aplicador do DEV (`scripts/db-migrate-dev-limited.ts`, com
 *     lock_timeout/statement_timeout de sessão) aplica a cauda e dá o MESMO catálogo da CLI;
 *  6. com `COMPOSE_PR53=1`: a candidata financeira do #53 como 0159 num pacote DESCARTÁVEL
 *     (cópia da pasta de migrations, nunca o journal do repositório), pelo migrador real, e a
 *     segunda execução sem reaplicar.
 *
 *   PR53_REF=<sha do #53> LEDGER_DUMP=<arq> DATA_DUMP=<arq> DEV_PRE_JSON=<pré-voo do DEV> \
 *     COMPOSE_PR53=1 OUT_DIR=<dir> npx tsx scripts/security/hi-dev-migrator-rehearsal.ts
 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { readDevOrderChain, readPr53FinancialCandidate } from './dev-order-chain';
import { startScratchSchema } from './scratch-schema';

const bin =
  process.env.SECURITY_PG_BIN ??
  (process.platform === 'win32'
    ? 'C:/Program Files/PostgreSQL/17/bin'
    : '/usr/lib/postgresql/17/bin');
const exe = (name: string) =>
  path.join(bin, `${name}${process.platform === 'win32' ? '.exe' : ''}`);
const PR53_REF = process.env.PR53_REF ?? 'origin/feat/billing-abacatepay-20261107';
const OUT = process.env.OUT_DIR ?? mkdtempSync(path.join(os.tmpdir(), 'qoro-dev-migrator-'));
const REVERSAL = path.resolve('docs/convenios/reversao-cauda-0144-0158.sql');
const SHARED = ['appointments', 'lancamentos', 'payment_transactions'] as const;
const TAIL_FROM = '0143_tiss_catalog';
const TAIL_TO = '0158_hi_copay_charge';
mkdirSync(OUT, { recursive: true });

const results: string[] = [];
const pass = (msg: string) => {
  results.push(msg);
  console.log(`PASS: ${msg}`);
};
const git = (...a: string[]) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 64 << 20 });
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

function psqlFile(url: string, file: string): void {
  const r = spawnSync(exe('psql'), ['-v', 'ON_ERROR_STOP=1', '-q', '-d', url, '-f', file], {
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, PGGSSENCMODE: 'disable' },
  });
  assert.equal(r.status, 0, `psql ${path.basename(file)}: ${r.stderr}`);
}

/** Estrutura dos schemas public e drizzle; sem as linhas `\restrict` (chave aleatória do pg_dump 17.6+). */
function schemaDump(url: string, name: string): string {
  const r = spawnSync(
    exe('pg_dump'),
    ['--schema-only', '--schema=public', '--schema=drizzle', '--no-owner', '-d', url],
    {
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 256 << 20,
      env: { ...process.env, PGGSSENCMODE: 'disable' },
    },
  );
  assert.equal(r.status, 0, `pg_dump: ${r.stderr}`);
  const text = r.stdout
    .split('\n')
    .filter((l) => !/^\\(un)?restrict /u.test(l))
    .join('\n');
  writeFileSync(path.join(OUT, `${name}.sql`), text);
  return text;
}

function assertSameSchema(a: string, b: string, aName: string, bName: string): void {
  if (a === b) return;
  const d = spawnSync(
    'git',
    [
      'diff',
      '--no-index',
      '--stat',
      path.join(OUT, `${aName}.sql`),
      path.join(OUT, `${bName}.sql`),
    ],
    { encoding: 'utf8' },
  );
  assert.fail(`estrutura ${aName} ≠ ${bName} (${OUT}):\n${d.stdout.slice(0, 2_000)}`);
}

/** Ledger como o DEV o tem: do dump, ou sintetizado dos journals (sha256 do arquivo, `when`). */
function ledgerRows(): { hash: string; when: string }[] {
  const rows: { hash: string; when: string }[] = [];
  const add = (ref: string, filter: (tag: string) => boolean) => {
    const journal = JSON.parse(git('show', `${ref}:drizzle/migrations/meta/_journal.json`)) as {
      entries: { tag: string; when: number }[];
    };
    for (const e of journal.entries.filter((x) => filter(x.tag))) {
      rows.push({
        hash: sha(git('show', `${ref}:drizzle/migrations/${e.tag}.sql`)),
        when: String(e.when),
      });
    }
  };
  add('HEAD', (t) => Number(t.slice(0, 4)) <= 135);
  add(PR53_REF, (t) => Number(t.slice(0, 4)) >= 136 && Number(t.slice(0, 4)) <= 142);
  add('HEAD', (t) => t === TAIL_FROM);
  return rows.sort((x, y) => Number(x.when) - Number(y.when));
}

const devPre = process.env.DEV_PRE_JSON
  ? (JSON.parse(readFileSync(process.env.DEV_PRE_JSON, 'utf8')) as {
      fingerprint: Record<string, string>;
      fingerprint_columns: Record<string, string[]>;
      counts: Record<string, number>;
    })
  : null;

const chain = await readDevOrderChain(PR53_REF);
const i0144 = chain.findIndex((m) => m.file.startsWith('0144_'));
assert.ok(i0144 > 0 && chain[i0144 - 1]!.file.startsWith('0143_'), 'cadeia sem 0143 → 0144');
const cluster = await startScratchSchema({
  port: Number(process.env.PORT ?? 55526),
  maxConnections: 2,
  migrations: chain.slice(0, i0144),
});
const { sql, url } = cluster;

async function ledger(): Promise<{ n: number; last: string }> {
  const [r] = await sql<
    { n: number; last: string }[]
  >`select count(*)::int n, max(created_at)::text last from drizzle.__drizzle_migrations`;
  return r!;
}

/** md5 das linhas com as colunas originais, na mesma representação textual do pré-voo do DEV (UTC, ISO). */
async function fingerprint(columns: Record<string, string[]>): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  await sql.begin(async (tx) => {
    await tx`set local timezone = 'UTC'`;
    await tx`set local datestyle = 'ISO, MDY'`;
    for (const t of SHARED) {
      const cs = columns[t]!.map((c) => `"${c}"`).join(',');
      const [r] = await tx.unsafe<{ h: string }[]>(
        `select md5(coalesce(string_agg(md5(row(${cs})::text), ',' order by id::text), '')) h from public.${t}`,
      );
      out[t] = r!.h;
    }
  });
  return out;
}

function runCli(): number {
  const t = performance.now();
  const r = spawnSync(
    process.execPath,
    [path.resolve('node_modules/drizzle-kit/bin.cjs'), 'migrate', '--config=drizzle.config.ts'],
    {
      encoding: 'utf8',
      windowsHide: true,
      env: { ...process.env, DATABASE_URL: url, NODE_ENV: 'development' },
    },
  );
  assert.equal(r.status, 0, `drizzle-kit migrate: ${r.stdout}\n${r.stderr}`);
  return Math.round(performance.now() - t);
}

try {
  // Ledger do DEV.
  await sql`create schema if not exists drizzle`;
  await sql`create table if not exists drizzle.__drizzle_migrations (id serial primary key, hash text not null, created_at bigint)`;
  if (process.env.LEDGER_DUMP) {
    psqlFile(url, process.env.LEDGER_DUMP);
  } else {
    for (const r of ledgerRows())
      await sql`insert into drizzle.__drizzle_migrations (hash, created_at) values (${r.hash}, ${r.when})`;
  }
  const l0 = await ledger();
  assert.equal(l0.n, 144);
  assert.equal(l0.last, '1794330000000');
  pass(
    `ledger como o DEV: 144 linhas, última 0143 (${process.env.LEDGER_DUMP ? 'dump do DEV' : 'sintetizado dos journals'})`,
  );

  // Dados do DEV (só as três tabelas compartilhadas que a cauda altera).
  const columns =
    devPre?.fingerprint_columns ??
    Object.fromEntries(
      await Promise.all(
        SHARED.map(async (t) => [
          t,
          (
            await sql<
              { c: string }[]
            >`select column_name c from information_schema.columns where table_schema='public' and table_name=${t} order by ordinal_position`
          ).map((r) => r.c),
        ]),
      ),
    );
  if (process.env.DATA_DUMP) {
    psqlFile(url, process.env.DATA_DUMP);
    const counts = Object.fromEntries(
      await Promise.all(
        SHARED.map(async (t) => [
          t,
          (await sql.unsafe<{ n: number }[]>(`select count(*)::int n from public.${t}`))[0]!.n,
        ]),
      ),
    );
    const f = await fingerprint(columns);
    if (devPre) {
      assert.deepEqual(counts, devPre.counts);
      assert.deepEqual(f, devPre.fingerprint, 'o backup não reproduz as linhas do DEV');
      pass(
        `backup dos dados restaurado e IDÊNTICO ao DEV (md5 das linhas): ${JSON.stringify(counts)}`,
      );
    } else {
      pass(`dados restaurados: ${JSON.stringify(counts)}`);
    }
  }
  const f0 = await fingerprint(columns);
  const p0 = schemaDump(url, 'P0-antes');

  // 1. CLI oficial.
  const ms1 = runCli();
  const l1 = await ledger();
  assert.equal(l1.n, 159);
  const tail = await sql<
    { version: string }[]
  >`select version from public._schema_version where version ~ '^01(4[4-9]|5[0-8])' order by 1`;
  assert.equal(tail.length, 15);
  const journal = JSON.parse(readFileSync('drizzle/migrations/meta/_journal.json', 'utf8')) as {
    entries: { tag: string; when: number }[];
  };
  assert.equal(l1.last, String(journal.entries.find((e) => e.tag === TAIL_TO)!.when));
  const q1 = schemaDump(url, 'Q1-depois-cli');
  pass(
    `drizzle-kit migrate aplicou exatamente 0144–0158 (15 versões, ledger 144 → 159) em ${ms1} ms`,
  );

  // 2. Segunda execução.
  runCli();
  assert.equal((await ledger()).n, 159);
  assertSameSchema(
    q1,
    schemaDump(url, 'Q2-segunda-execucao'),
    'Q1-depois-cli',
    'Q2-segunda-execucao',
  );
  pass('segunda execução: nada aplicado, estrutura byte a byte igual');

  // 3. Dados existentes.
  assert.deepEqual(await fingerprint(columns), f0, 'dados existentes mudaram');
  const [part] = await sql<{ a: number; l: number; nv: number }[]>`
    select (select count(*)::int from appointments where billing_mode <> 'particular') a,
           (select count(*)::int from lancamentos where source_hi_guide_id is not null or valor_glosado <> 0) l,
           (select count(*)::int from pg_constraint where conrelid in ('public.lancamentos'::regclass, 'public.appointments'::regclass, 'public.payment_transactions'::regclass) and not convalidated) nv`;
  assert.deepEqual(part, { a: 0, l: 0, nv: 0 });
  pass(
    'dados existentes intocados (md5 igual); particular continua particular; todos os CHECKs validados',
  );

  // 4. Reversão executável.
  if (existsSync(REVERSAL)) {
    psqlFile(url, REVERSAL);
    const l4 = await ledger();
    assert.equal(l4.n, 144);
    assert.equal(l4.last, '1794330000000');
    assertSameSchema(p0, schemaDump(url, 'R-depois-reversao'), 'P0-antes', 'R-depois-reversao');
    assert.deepEqual(await fingerprint(columns), f0);
    pass(
      'reversão: estrutura byte a byte igual à de antes, ledger 144 linhas (0143), dados intocados',
    );

    // 5. Aplicador do DEV (limites de sessão) depois da reversão = mesmo catálogo da CLI.
    const r = spawnSync(
      process.execPath,
      [
        path.resolve('node_modules/tsx/dist/cli.mjs'),
        'scripts/db-migrate-dev-limited.ts',
        '--expected-ref',
        '127.0.0.1',
        '--expect-from',
        TAIL_FROM,
        '--expect-to',
        TAIL_TO,
      ],
      {
        encoding: 'utf8',
        windowsHide: true,
        env: { ...process.env, DATABASE_URL: url, NODE_ENV: 'development' },
      },
    );
    assert.equal(r.status, 0, `db-migrate-dev-limited: ${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /lock_timeout=2s statement_timeout=1min/);
    assertSameSchema(q1, schemaDump(url, 'Q3-aplicador-dev'), 'Q1-depois-cli', 'Q3-aplicador-dev');
    assert.equal((await ledger()).n, 159);
    const [sess] = await sql<
      { n: number }[]
    >`select count(*)::int n from pg_stat_activity where application_name = 'qoro-migrate-dev-limited'`;
    assert.equal(sess!.n, 0);
    pass(
      'aplicador do DEV (lock_timeout 2s, statement_timeout 60s): mesmo catálogo da CLI, ledger 159, sessão encerrada',
    );
  } else {
    console.log(`(sem ${path.relative(process.cwd(), REVERSAL)}: passos 4 e 5 pulados)`);
  }

  // 6. Composição descartável com a candidata do #53 como 0159.
  if (process.env.COMPOSE_PR53 === '1') {
    const pkg = mkdtempSync(path.join(os.tmpdir(), 'qoro-pkg-0159-'));
    try {
      cpSync('drizzle/migrations', path.join(pkg, 'migrations'), { recursive: true });
      const j = JSON.parse(
        readFileSync(path.join(pkg, 'migrations/meta/_journal.json'), 'utf8'),
      ) as {
        entries: {
          idx: number;
          version: string;
          when: number;
          tag: string;
          breakpoints: boolean;
        }[];
      };
      const last = j.entries.at(-1)!;
      assert.equal(last.tag, TAIL_TO);
      j.entries.push({
        idx: 159,
        version: last.version,
        when: last.when + 86_400_000,
        tag: '0159_pr53_saas_period_snapshot_candidate',
        breakpoints: true,
      });
      writeFileSync(path.join(pkg, 'migrations/meta/_journal.json'), JSON.stringify(j, null, 2));
      writeFileSync(
        path.join(pkg, 'migrations/0159_pr53_saas_period_snapshot_candidate.sql'),
        readPr53FinancialCandidate(PR53_REF),
      );
      const cfg = path.join(pkg, 'drizzle.config.cjs');
      writeFileSync(
        cfg,
        `module.exports = { dialect: 'postgresql', out: ${JSON.stringify(path.join(pkg, 'migrations').replace(/\\/g, '/'))}, dbCredentials: { url: process.env.DATABASE_URL, ssl: 'require' } };\n`,
      );
      const run = () => {
        const r = spawnSync(
          process.execPath,
          [path.resolve('node_modules/drizzle-kit/bin.cjs'), 'migrate', `--config=${cfg}`],
          {
            encoding: 'utf8',
            windowsHide: true,
            env: { ...process.env, DATABASE_URL: url, NODE_ENV: 'development' },
          },
        );
        assert.equal(r.status, 0, `migrate 0159: ${r.stdout}\n${r.stderr}`);
      };
      const t = performance.now();
      run();
      const ms = Math.round(performance.now() - t);
      assert.equal((await ledger()).n, 160);
      const [objs] = await sql<
        { n: number }[]
      >`select count(*)::int n from information_schema.tables where table_schema='billing_gateway' and table_name in ('statement_scans','statement_scan_items')`;
      assert.equal(objs!.n, 2);
      const before = schemaDump(url, 'C1-com-0159');
      run();
      assert.equal((await ledger()).n, 160);
      assertSameSchema(
        before,
        schemaDump(url, 'C2-com-0159-segunda'),
        'C1-com-0159',
        'C2-com-0159-segunda',
      );
      assert.deepEqual(await fingerprint(columns), f0);
      pass(
        `composição descartável: candidata do #53 (${git('rev-parse', '--short', PR53_REF).trim()}) como 0159 pelo migrador real em ${ms} ms; segunda execução sem reaplicar; dados intocados`,
      );
    } finally {
      rmSync(pkg, { recursive: true, force: true });
    }
  }
  console.log(`\n${results.length} provas do ensaio do migrador passaram. Dumps em ${OUT}`);
} finally {
  await cluster.stop();
}
