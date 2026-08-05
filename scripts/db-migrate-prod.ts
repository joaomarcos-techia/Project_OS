/**
 * `pnpm db:migrate:prod`
 *
 * THIS IS THE DANGEROUS ONE. Reads `DATABASE_URL_PROD` (NOT `DATABASE_URL`),
 * dumps the DB, acquires an advisory lock, applies migrations, releases the
 * lock, and appends to the migrations log. On any failure it writes
 * `MIGRATION_FAILED.md` to the repo root, which blocks all subsequent runs
 * until manually resolved.
 *
 * Hard prerequisites (see _env.assertProdContext):
 *   - SUPABASE_PROJECT_ENV=prod              (explicit opt-in)
 *   - DATABASE_URL_PROD                      (target connection)
 *   - URL contains sslmode=require
 *   - pg_dump available on PATH
 *   - MIGRATION_FAILED.md absent from repo root
 */
import { execSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync, writeFileSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';

import postgres from 'postgres';

import { assertMigrationsSafe } from './check-migration-safety';
import { assertProdContext, fsTimestamp, gitUserEmail, redact } from './_env';

const REPO_ROOT = process.cwd();
const BACKUPS_DIR = resolve(REPO_ROOT, 'backups');
const MIGRATION_FAILED_FILE = resolve(REPO_ROOT, 'MIGRATION_FAILED.md');
const MIGRATIONS_LOG = resolve(BACKUPS_DIR, 'migrations.log');
// Arbitrary 32-bit int; collisions only matter for OTHER advisory locks in the
// same DB, of which we have none. See `pg_advisory_lock` Postgres docs.
const ADVISORY_LOCK_KEY = 4242;

/**
 * Migrations use the Session Pooler (port 5432) — NOT the Transaction Pooler
 * (port 6543) the app runtime uses. Reason: Transaction Pooler releases the
 * backend per-transaction, so `SELECT pg_advisory_lock(K)` and the matching
 * `pg_advisory_unlock(K)` may hit DIFFERENT backends, breaking the lock.
 * Session Pooler keeps the backend sticky for the duration of the session.
 *
 * If DATABASE_URL_PROD already uses 5432, this is a no-op. If it uses 6543
 * (the Supabase default for app), we rewrite the port. Verified empirically
 * in C1 (test 1.6.11) — concurrent migrations did NOT serialize on 6543.
 */
function migrationUrl(transactionPoolerUrl: string): string {
  return transactionPoolerUrl.replace(':6543/', ':5432/');
}

function assertSentinelAbsent(): void {
  if (existsSync(MIGRATION_FAILED_FILE)) {
    throw new Error(
      `MIGRATION_FAILED.md exists at ${MIGRATION_FAILED_FILE}. ` +
        'A previous migration failed and must be investigated + resolved before re-run. ' +
        'See docs/runbooks/migrations.md.',
    );
  }
}

function assertPgDump(): void {
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['pg_dump']);
  if (r.status !== 0) {
    throw new Error(
      'pg_dump not found on PATH. Install Postgres CLI tools. ' +
        '(macOS: `brew install postgresql`. Windows: official installer. Linux: `apt install postgresql-client`.)',
    );
  }
}

function takeBackup(databaseUrl: string): string {
  if (!existsSync(BACKUPS_DIR)) mkdirSync(BACKUPS_DIR, { recursive: true });
  const path = resolve(BACKUPS_DIR, `prod-pre-migration-${fsTimestamp()}.sql`);
  console.log(`[migrate:prod] backup -> ${path}`);
  // Flags:
  //  --no-owner --no-acl  : portable dumps (no role-specific GRANTs that
  //                         would break on restore to a different role).
  //  --clean --if-exists  : prefix DROP IF EXISTS before each CREATE so
  //                         restore is idempotent against a populated target.
  //  --exclude-schema=... : skip every Supabase-managed schema. Restoring
  //                         these into a Supabase project fails (objects
  //                         already exist, or we lack permission). We only
  //                         care about OUR app schemas. Discovered in C1
  //                         audit: dumping `public` also pulled in
  //                         `rls_auto_enable()` (a Supabase event-trigger
  //                         function) which breaks restore due to a
  //                         dependent event trigger. The exclude list below
  //                         covers all known Supabase-prefixed schemas as
  //                         of 2026-05.
  //
  // NOTE: a Supabase-managed function (`public.rls_auto_enable`) lives
  // INSIDE `public` schema. The dump still includes it; on restore, the
  // DROP fails due to the dependent `ensure_rls` event trigger. The
  // restore handler must run with non-stop-on-error to tolerate this one
  // expected failure. See docs/runbooks/migrations.md for the restore
  // procedure (uses \set ON_ERROR_STOP off followed by application-table
  // verification).
  //
  // URL is passed as the final positional argument; pg_dump treats it as
  // the connection string. Credentials in argv are visible to local users
  // but acceptable: this script only runs on operator workstations (never CI).
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
    `pg_dump --no-owner --no-acl --clean --if-exists ${excludeSchemas} --format=plain --file="${path}" "${databaseUrl}"`,
    { stdio: 'inherit' },
  );
  const size = statSync(path).size;
  if (size === 0) {
    throw new Error(`Backup file ${path} is 0 bytes. Aborting.`);
  }
  console.log(`[migrate:prod] backup OK (${size} bytes)`);
  return path;
}

async function withAdvisoryLock<T>(databaseUrl: string, fn: () => Promise<T>): Promise<T> {
  // A tiny separate connection just for the lock — keep it independent of
  // whatever drizzle-kit opens. max:1 so we don't sprinkle extra sockets.
  const client = postgres(databaseUrl, { ssl: 'require', prepare: false, max: 1 });
  try {
    console.log(`[migrate:prod] acquiring pg_advisory_lock(${ADVISORY_LOCK_KEY})...`);
    await client`SELECT pg_advisory_lock(${ADVISORY_LOCK_KEY})`;
    console.log('[migrate:prod] lock acquired.');
    return await fn();
  } finally {
    try {
      await client`SELECT pg_advisory_unlock(${ADVISORY_LOCK_KEY})`;
      console.log('[migrate:prod] lock released.');
    } catch (e) {
      console.error('[migrate:prod] failed to release advisory lock:', e);
    } finally {
      await client.end({ timeout: 5 });
    }
  }
}

function writeFailureSentinel(
  databaseUrl: string,
  errorText: string,
  backupPath: string | null,
): void {
  let gitCommit = 'unknown';
  try {
    gitCommit = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  } catch {
    /* best-effort only */
  }
  const body = `# MIGRATION_FAILED

> This file blocks \`pnpm db:migrate:prod\` until manually removed.
> Before deleting, fill in EVERY field below. This is a mini postmortem.

**Timestamp**: ${new Date().toISOString()}
**Git commit**: ${gitCommit}
**Executor**: ${gitUserEmail()}
**DATABASE_URL_PROD host**: ${redact(databaseUrl)}

## Error (raw)

\`\`\`
${errorText}
\`\`\`

## Backup pre-migration

Path: ${backupPath ?? '(NOT TAKEN — migration failed before backup)'}
Restorable? [ ] yes [ ] not-tested [ ] FAILED restore

## Rollback executed?

- [ ] No rollback needed (migration aborted before applying)
- [ ] Partial rollback — describe: ...
- [ ] Full restore from dump executed at: ...

## Root cause (humans only)

<diagnosis>

## Action taken

<what was fixed / new migration / etc.>

## Confirmation

I (${gitUserEmail()}) confirm I understand the cause, fixed the issue, and am
authorized to delete this file and re-run the migration.
`;
  writeFileSync(MIGRATION_FAILED_FILE, body, 'utf8');
  console.error(`[migrate:prod] wrote ${MIGRATION_FAILED_FILE}`);
}

function appendLog(line: string): void {
  if (!existsSync(BACKUPS_DIR)) mkdirSync(BACKUPS_DIR, { recursive: true });
  appendFileSync(MIGRATIONS_LOG, line + '\n', 'utf8');
}

async function main(): Promise<void> {
  assertSentinelAbsent();
  // Gap 1.3: pré-flight fail-closed — bloqueia DROP/TRUNCATE não-aprovado ANTES
  // de tocar prod (mesmo com backup, evitar o erro humano é mais barato).
  assertMigrationsSafe();
  const { databaseUrl: rawUrl } = assertProdContext();
  const migrateUrl = migrationUrl(rawUrl);
  console.log(`[migrate:prod] target (session pooler): ${redact(migrateUrl)}`);
  assertPgDump();

  let backupPath: string | null = null;
  try {
    backupPath = takeBackup(migrateUrl);

    await withAdvisoryLock(migrateUrl, async () => {
      // drizzle-kit reads DATABASE_URL from env; override for this child only.
      // Use the session-pooler URL so the lock and the migrator share session.
      execSync('drizzle-kit migrate --config=drizzle.config.ts', {
        stdio: 'inherit',
        env: { ...process.env, DATABASE_URL: migrateUrl, NODE_ENV: 'production' },
      });
    });

    const stamp = new Date().toISOString();
    appendLog(`${stamp} | ${gitUserEmail()} | ${backupPath} | OK`);
    console.log('[migrate:prod] DONE.');
  } catch (err) {
    const msg = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err);
    appendLog(
      `${new Date().toISOString()} | ${gitUserEmail()} | ${backupPath ?? '(no-backup)'} | FAIL: ${msg.slice(0, 200)}`,
    );
    writeFailureSentinel(migrateUrl, msg, backupPath);
    throw err;
  }
}

main().catch((err) => {
  console.error('[migrate:prod] FAILED:', err instanceof Error ? err.message : err);
  process.exit(1);
});
