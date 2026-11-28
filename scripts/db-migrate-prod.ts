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
 *   - pg_dump and gpg available on PATH; BACKUP_PASSPHRASE configured
 *   - MIGRATION_FAILED.md absent from repo root
 *   - migration composition guard (src/lib/db/migration-composition.ts): the journal is
 *     contiguous, the cross-branch boundary 0158 → 0159 (#53) → 0160 (#55) is present with the
 *     pinned hashes, and — against the target ledger — nothing would be SILENTLY SKIPPED by the
 *     Drizzle migrator (it only applies entries whose `when` is greater than the last applied
 *     row). Checked before the backup (journal only), again inside the advisory lock right before
 *     migrating (journal + ledger + sentinels) and once more after (nothing pending).
 *     `--check-composition` runs only the read-only guard (no backup, no lock, no DDL) — the
 *     preflight of a coordinated release (docs/convenios/coordenacao-migrations.md §13 and §16).
 *     Every guard read runs inside `BEGIN READ ONLY` with `SET LOCAL` statement/lock/idle timeouts
 *     on a single labelled connection (`application_name`), so Postgres itself refuses any write.
 */
import { execSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';

import postgres from 'postgres';

import { MIGRATION_COMPOSITION_MANIFEST } from '@/lib/db/migration-composition.manifest';

import { assertMigrationsSafe } from './check-migration-safety';
import { assertProdContext, gitUserEmail, redact } from './_env';
import { localBinCommand } from './_local-bin';
import { takeEncryptedProdBackup } from './prod-encrypted-backup';
import {
  READ_ONLY_CHECK_APPLICATION_NAME,
  checkComposition,
  checkCompositionInReadOnlyTx,
} from './security/migration-composition-io';

const REPO_ROOT = process.cwd();
const BACKUPS_DIR = resolve(REPO_ROOT, 'backups');
const MIGRATION_FAILED_FILE = resolve(REPO_ROOT, 'MIGRATION_FAILED.md');
const MIGRATIONS_LOG = resolve(BACKUPS_DIR, 'migrations.log');
const MIGRATIONS_DIR = resolve(REPO_ROOT, 'drizzle/migrations');
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

/**
 * Guarda de composição contra o ledger do banco-alvo (só leitura, conexão própria de 1 socket).
 * `before`: recusa se o Drizzle fosse pular alguma migration, se o ledger tiver linha fora do
 * journal, hash divergente ou sentinela incoerente. `after`: o mesmo, e nada pode sobrar pendente.
 */
async function guardComposition(
  databaseUrl: string,
  moment: 'before' | 'after' | 'check-only',
  folder: string = MIGRATIONS_DIR,
): Promise<void> {
  const client = postgres(databaseUrl, {
    ssl: 'require',
    prepare: false,
    max: 1,
    connect_timeout: 15,
    idle_timeout: 5,
    connection: { application_name: READ_ONLY_CHECK_APPLICATION_NAME },
  });
  try {
    const plan = await client.begin('READ ONLY', (tx) =>
      checkCompositionInReadOnlyTx(tx, {
        folder,
        manifest: MIGRATION_COMPOSITION_MANIFEST,
      }),
    );
    console.log(
      `[migrate:prod] composition ${moment}: ok, pending=${plan.pending.length} (${plan.pending.join(', ') || 'none'})`,
    );
    for (const w of plan.warnings)
      console.log(`[migrate:prod] warning ${w.code} ${w.subject}: ${w.detail}`);
    if (moment === 'after' && plan.pending.length > 0) {
      throw new Error(`migrations still pending after migrate: ${plan.pending.join(', ')}`);
    }
  } finally {
    await client.end({ timeout: 5 });
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
  // Pré-voo de lançamento coordenado: `--migrations-dir` aponta o pacote COMPOSTO
  // (scripts/security/compose-release-migrations.ts). Só vale com `--check-composition`: migrar de
  // uma pasta fora do repositório nunca é aceito.
  const checkOnly = process.argv.includes('--check-composition');
  const dirFlag = process.argv.indexOf('--migrations-dir');
  if (dirFlag >= 0 && !checkOnly) {
    throw new Error('--migrations-dir só é aceito com --check-composition (nunca para migrar)');
  }
  const folder = dirFlag >= 0 ? resolve(process.argv[dirFlag + 1] ?? '') : MIGRATIONS_DIR;
  // Composição entre branches: sem banco ainda — recusa um journal sem a 0159 do #53 antes de
  // qualquer conexão ou backup.
  await checkComposition({ folder, manifest: MIGRATION_COMPOSITION_MANIFEST });
  const { databaseUrl: rawUrl } = assertProdContext();
  const migrateUrl = migrationUrl(rawUrl);
  console.log(`[migrate:prod] target (session pooler): ${redact(migrateUrl)}`);
  if (checkOnly) {
    // Só lê o ledger e as sentinelas (BEGIN READ ONLY); sem backup, sem lock, sem DDL, sem arquivo.
    await guardComposition(migrateUrl, 'check-only', folder);
    console.log('[migrate:prod] --check-composition: nothing applied.');
    return;
  }
  assertPgDump();

  let backupPath: string | null = null;
  try {
    backupPath = await takeEncryptedProdBackup(migrateUrl, BACKUPS_DIR, 'prod-pre-migration');
    console.log(`[migrate:prod] encrypted backup OK -> ${backupPath}`);

    await withAdvisoryLock(migrateUrl, async () => {
      await guardComposition(migrateUrl, 'before');
      // drizzle-kit reads DATABASE_URL from env; override for this child only.
      // Use the session-pooler URL so the lock and the migrator share session.
      execSync(`${localBinCommand('drizzle-kit')} migrate --config=drizzle.config.ts`, {
        stdio: 'inherit',
        env: { ...process.env, DATABASE_URL: migrateUrl, NODE_ENV: 'production' },
      });
      await guardComposition(migrateUrl, 'after');
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
