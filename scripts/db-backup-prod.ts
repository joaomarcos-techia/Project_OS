/**
 * `pnpm db:backup:prod`
 *
 * Manual backup of the prod DB. Same prod-context guard as the migrate script.
 * Use cases:
 *   - Pre-deploy smoke test ("does my key still work?") before db:migrate:prod.
 *   - Quarterly disaster-recovery drill: take a dump and verify it restores
 *     into a scratch DB (per docs/runbooks/migrations.md).
 */
import { execSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

import { assertProdContext, fsTimestamp, redact } from './_env';

const BACKUPS_DIR = resolve(process.cwd(), 'backups');

function assertPgDump(): void {
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['pg_dump']);
  if (r.status !== 0) {
    throw new Error(
      'pg_dump not found on PATH. Install Postgres CLI tools.',
    );
  }
}

function main(): void {
  const { databaseUrl: rawUrl } = assertProdContext();
  // Session Pooler (5432) preferred for pg_dump too — Transaction Pooler can
  // drop the backend mid-dump on long-running schemas. See db-migrate-prod.ts
  // for the full rationale.
  const dumpUrl = rawUrl.replace(':6543/', ':5432/');
  assertPgDump();
  console.log(`[backup:prod] target (session pooler): ${redact(dumpUrl)}`);

  if (!existsSync(BACKUPS_DIR)) mkdirSync(BACKUPS_DIR, { recursive: true });
  const path = resolve(BACKUPS_DIR, `manual-${fsTimestamp()}.sql`);

  // Mirror db-migrate-prod.ts dump flags. See that file for the rationale
  // on each (and the known caveat about `rls_auto_enable`).
  const excludeSchemas = [
    'auth',
    'storage',
    'realtime',
    'extensions',
    'graphql',
    'graphql_public',
    'vault',
    'supabase_functions',
    '_realtime',
    '_analytics',
    'pgsodium',
    'pgsodium_masks',
    'pgbouncer',
  ]
    .map((s) => `--exclude-schema=${s}`)
    .join(' ');
  execSync(
    `pg_dump --no-owner --no-acl --clean --if-exists ${excludeSchemas} --format=plain --file="${path}" "${dumpUrl}"`,
    { stdio: 'inherit' },
  );

  const size = statSync(path).size;
  if (size === 0) throw new Error(`Backup file ${path} is 0 bytes. Aborting.`);
  console.log(`[backup:prod] OK (${size} bytes) -> ${path}`);
}

try {
  main();
} catch (err) {
  console.error('[backup:prod] FAILED:', err instanceof Error ? err.message : err);
  process.exit(1);
}
