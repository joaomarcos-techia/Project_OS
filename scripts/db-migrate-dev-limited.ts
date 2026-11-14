/**
 * Aplica as migrations pendentes no DEV com o MIGRADOR DO DRIZZLE — o mesmo código que o
 * `drizzle-kit migrate` executa (`drizzle-orm/postgres-js/migrator`), mesma pasta, mesmo ledger
 * `drizzle.__drizzle_migrations` — acrescentando o que a CLI não deixa configurar pelo pooler de
 * SESSÃO do Supabase: `lock_timeout` e `statement_timeout` da sessão (o Supavisor ignora
 * parâmetros de inicialização na URL; medido em 12/11: `lock_timeout` ficava 0) e o `RESET` no
 * fim, antes de devolver a conexão ao pooler.
 *
 * Garantias:
 *  - só DEV: `assertDevContext()` + `--expected-ref` no host/usuário da URL; recusa o pooler de
 *    TRANSAÇÃO (6543), onde `SET` de sessão vaza para outros clientes;
 *  - conexão única (`max: 1`): os limites valem para a transação do migrador;
 *  - antes de abrir a transação, confere a última linha do ledger (`--expect-from`) e a lista
 *    exata de pendentes (até `--expect-to`); qualquer diferença recusa sem escrever nada;
 *  - o migrador aplica TODAS as pendentes numa transação só: ou entram todas, ou nenhuma;
 *  - depois, confere que a última linha do ledger é `--expect-to` e que entraram só as esperadas.
 *  - guarda de composição (src/lib/db/migration-composition.ts) antes e depois: journal contíguo,
 *    fronteira 0158 → 0159 (#53) → 0160 (#55) com os hashes fixados, nada que o Drizzle pularia em
 *    silêncio, ledger sem linha desconhecida e sentinelas coerentes. Exceções só com
 *    `--expect-from-external` ou `--allow-external-applied`, e só para migrations FIXADAS de outra
 *    branch (0136–0142 e 0159 do #53) que o ledger tem com o hash fixado;
 *  - `--dry-run`: só lê o ledger e lista as pendentes.
 *
 * Por que conexão própria e não `dbAdmin`: o mesmo motivo do `scripts/tiss/terminology/load.ts`
 * (pooler do DEV em outra região, conexão lenta) e porque o migrador precisa de UMA conexão com
 * estado de sessão controlado. Na lista de exceções do lint e do `arch-db-check`.
 *
 * Uso (procedimento em docs/convenios/aplicacao-0153.md):
 *   DATABASE_URL=<URL 5432 do DEV> npx tsx scripts/db-migrate-dev-limited.ts \
 *     --expected-ref <ref do DEV> --expect-from 0143_tiss_catalog --expect-to 0158_hi_copay_charge
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

import { MIGRATION_COMPOSITION_MANIFEST } from '@/lib/db/migration-composition.manifest';

import { assertDevContext, redact } from './_env';
import { allowExternalApplied, checkComposition } from './security/migration-composition-io';

const MIGRATIONS = path.resolve('drizzle/migrations');
const LOCK_TIMEOUT = process.env.MIGRATE_LOCK_TIMEOUT ?? '2s';
const STATEMENT_TIMEOUT = process.env.MIGRATE_STATEMENT_TIMEOUT ?? '60s';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function log(message: string): void {
  console.log(`[migrate:dev-limited] ${new Date().toISOString()} ${message}`);
}

interface JournalEntry {
  idx: number;
  tag: string;
  when: number;
}

async function main(): Promise<void> {
  const expectedRef = arg('expected-ref');
  const expectFrom = arg('expect-from');
  const expectTo = arg('expect-to');
  const dryRun = process.argv.includes('--dry-run');
  if (!expectedRef || !expectFrom || !expectTo) {
    throw new Error('--expected-ref, --expect-from e --expect-to são obrigatórios');
  }
  const { databaseUrl } = assertDevContext();
  const url = new URL(databaseUrl);
  const identity = `${url.hostname} ${decodeURIComponent(url.username)}`;
  if (!identity.includes(expectedRef)) throw new Error('a URL não é do projeto esperado');
  if (url.port === '6543') {
    throw new Error('pooler de transação (6543) recusado: SET de sessão vaza; use a porta 5432');
  }
  log(`alvo: ${redact(databaseUrl)}`);

  const journal = JSON.parse(readFileSync(path.join(MIGRATIONS, 'meta/_journal.json'), 'utf8')) as {
    entries: JournalEntry[];
  };
  const byWhen = new Map(journal.entries.map((e) => [String(e.when), e.tag]));
  // A 0159 do #53 está aplicada no DEV fora do journal desta branch (coordenacao-migrations §11-12).
  // Só é aceita como ponto de partida se o `created_at` E o nome informados baterem, explicitamente.
  const external = arg('expect-from-external');
  let externalTag: string | undefined;
  if (external) {
    const m = /^(\d{13}):(\d{4}_[a-z0-9_]+)$/u.exec(external);
    if (!m) throw new Error('--expect-from-external precisa de <when>:<tag>');
    if (m[2] !== expectFrom)
      throw new Error('--expect-from-external deve nomear a mesma --expect-from');
    if (byWhen.has(m[1]!))
      throw new Error('--expect-from-external aponta para uma migration que está no journal');
    byWhen.set(m[1]!, m[2]!);
    externalTag = m[2]!;
  }

  const sql = postgres(databaseUrl, {
    max: 1,
    prepare: false,
    connect_timeout: 45,
    idle_timeout: 5,
    onnotice: () => undefined,
  });
  try {
    // Exceções só com pedido explícito, e só para fixadas de outra branch aplicadas com o hash fixado.
    const allowances =
      externalTag || process.argv.includes('--allow-external-applied')
        ? await allowExternalApplied(sql, MIGRATION_COMPOSITION_MANIFEST, MIGRATIONS)
        : [];
    if (allowances.length > 0) log(`exceções externas: ${allowances.map((a) => a.tag).join(', ')}`);
    const composition = async (moment: string) => {
      const plan = await checkComposition({
        folder: MIGRATIONS,
        manifest: MIGRATION_COMPOSITION_MANIFEST,
        sql,
        allowances,
      });
      log(`composição ${moment}: ok, pendentes ${plan.pending.length}`);
      for (const w of plan.warnings) log(`aviso ${w.code} ${w.subject}: ${w.detail}`);
      return plan;
    };
    await composition('antes');
    const ledger = async () =>
      sql<{ n: number; last: string | null }[]>`
        select count(*)::int n, max(created_at)::text last from drizzle.__drizzle_migrations`;
    const [before] = await ledger();
    const lastTag = before?.last ? byWhen.get(before.last) : undefined;
    log(
      `ledger antes: ${before?.n} linhas, última ${before?.last} (${lastTag ?? 'fora do journal'})`,
    );
    if (lastTag !== expectFrom) throw new Error(`a última linha do ledger não é ${expectFrom}`);
    const pending = journal.entries.filter((e) => e.when > Number(before!.last));
    log(`pendentes (${pending.length}): ${pending.map((e) => e.tag).join(', ')}`);
    if (pending.at(-1)?.tag !== expectTo) throw new Error(`a última pendente não é ${expectTo}`);
    if (dryRun) {
      log('dry-run: nada aplicado');
      return;
    }

    await sql`select set_config('lock_timeout', ${LOCK_TIMEOUT}, false),
                     set_config('statement_timeout', ${STATEMENT_TIMEOUT}, false),
                     set_config('application_name', 'qoro-migrate-dev-limited', false)`;
    const [limits] = await sql<{ lt: string; st: string }[]>`
      select current_setting('lock_timeout') lt, current_setting('statement_timeout') st`;
    log(`sessão: lock_timeout=${limits?.lt} statement_timeout=${limits?.st}`);

    const started = performance.now();
    try {
      await migrate(drizzle(sql), { migrationsFolder: MIGRATIONS });
    } finally {
      // Devolve a conexão ao pooler sem estado de sessão (mesmo se a migração falhou).
      for (const setting of ['lock_timeout', 'statement_timeout', 'application_name']) {
        await sql.unsafe(`RESET ${setting}`).catch(() => undefined);
      }
    }
    const elapsed = Math.round(performance.now() - started);

    const [after] = await ledger();
    const afterTag = after?.last ? byWhen.get(after.last) : undefined;
    log(`ledger depois: ${after?.n} linhas, última ${after?.last} (${afterTag}) em ${elapsed} ms`);
    if (afterTag !== expectTo || after!.n - before!.n !== pending.length) {
      throw new Error('o ledger depois da migração não é o esperado');
    }
    if ((await composition('depois')).pending.length > 0) {
      throw new Error('sobrou migration pendente depois da aplicação');
    }
    log('ok');
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error: unknown) => {
  console.error('[migrate:dev-limited] FALHOU:', error instanceof Error ? error.message : error);
  process.exit(1);
});
