/**
 * `pnpm restore:test`
 *
 * DR drill em 1 comando (C16 / restore-test.md): restaura o dump de prod mais
 * recente (`backups/*.sql`) num banco **SCRATCH** e valida as contagens.
 *
 * Recusa URL remota e nome de banco fora de qoro_restore_*. O alvo é você quem provê:
 *   RESTORE_TARGET_URL="postgresql://localhost:5432/qoro_restore_drill" pnpm restore:test
 *   # opcional: apontar um dump específico
 *   RESTORE_TARGET_URL="..." pnpm restore:test backups/manual-XXX.sql
 *
 * Alvo: PostgreSQL local com banco dedicado chamado qoro_restore_*.
 * O scratch precisa das dependências de schema/extensões exigidas pelo dump.
 * Qualquer erro SQL aborta: tabelas-âncora preexistentes não provam restauração.
 * As contagens ainda devem ser comparadas manualmente à origem.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

import { looksLikeProd, redact } from './_env';
import { assertLocalScratchTarget, assertRestoreExit } from './restore-test-result';

const BACKUPS_DIR = resolve(process.cwd(), 'backups');

function latestDump(): string {
  if (!existsSync(BACKUPS_DIR)) {
    throw new Error('backups/ não existe. Rode `pnpm db:backup:prod` antes.');
  }
  const files = readdirSync(BACKUPS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .map((f) => resolve(BACKUPS_DIR, f))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  if (files.length === 0) throw new Error('nenhum .sql em backups/. Rode `pnpm db:backup:prod`.');
  return files[0]!;
}

function assertPsql(): void {
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['psql']);
  if (r.status !== 0) {
    throw new Error('psql não encontrado no PATH. Instale o Postgres CLI (client).');
  }
}

function main(): void {
  const target = process.env.RESTORE_TARGET_URL;
  if (!target) {
    throw new Error(
      'RESTORE_TARGET_URL não setado. Aponte para um banco local qoro_restore_* (NUNCA prod):\n' +
        '  RESTORE_TARGET_URL="postgresql://localhost:5432/qoro_restore_drill" pnpm restore:test',
    );
  }

  // --- guardas anti-prod (fail-closed) ---
  if (process.env.SUPABASE_PROJECT_ENV === 'prod') {
    throw new Error(
      '[guard] SUPABASE_PROJECT_ENV=prod — restore test NUNCA roda contra prod. Abortando.',
    );
  }
  if (process.env.DATABASE_URL_PROD && target === process.env.DATABASE_URL_PROD) {
    throw new Error('[guard] RESTORE_TARGET_URL == DATABASE_URL_PROD. Abortando.');
  }
  if (looksLikeProd(target)) {
    throw new Error(
      '[guard] RESTORE_TARGET_URL parece prod (hostname/env). Use um scratch. Abortando.',
    );
  }
  assertLocalScratchTarget(target);

  assertPsql();
  const dump = process.argv[2] ? resolve(process.argv[2]) : latestDump();
  if (!existsSync(dump)) throw new Error(`dump não encontrado: ${dump}`);

  console.log(`[restore:test] dump:   ${dump}`);
  console.log(`[restore:test] target: ${redact(target)}`);
  console.log('[restore:test] restaurando... qualquer erro SQL interrompe a prova\n');

  const restore = spawnSync('psql', [target, '-X', '-v', 'ON_ERROR_STOP=1', '-q', '-f', dump], {
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  assertRestoreExit(restore.status, restore.error);

  // O SELECT de âncoras confirma apenas leitura; paridade exige comparação à origem.
  const validation = `
    SELECT
      (SELECT count(*) FROM information_schema.tables WHERE table_schema='public') AS public_tables,
      (SELECT count(*) FROM pg_policies WHERE schemaname='public')                 AS rls_policies,
      (SELECT count(*) FROM clinics)                                               AS clinics,
      (SELECT count(*) FROM patients)                                              AS patients,
      (SELECT count(*) FROM appointments)                                          AS appointments,
      (SELECT count(*) FROM audit_events)                                          AS audit_events;`;

  try {
    const out = execFileSync('psql', [target, '-X', '-v', 'ON_ERROR_STOP=1', '-c', validation], {
      encoding: 'utf8',
    });
    console.log('\n[restore:test] SQL restaurado sem erro; contagens no scratch:\n');
    console.log(out);
  } catch {
    throw new Error(
      'validação falhou — alguma tabela-âncora não existe no scratch (restore incompleto). Isso é FALHA do drill.',
    );
  }

  console.log('[restore:test] Confira se os números batem com a ordem de grandeza de prod.');
  console.log('[restore:test] Paridade com a origem PENDENTE de comparação humana.');
  console.log('[restore:test] ⚠️  DERRUBE o scratch quando terminar (contém PII de prod).');
}

try {
  main();
} catch (err) {
  console.error('[restore:test] FAILED:', err instanceof Error ? err.message : err);
  process.exit(1);
}
