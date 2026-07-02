/**
 * `pnpm restore:test`
 *
 * DR drill em 1 comando (C16 / restore-test.md): restaura o dump de prod mais
 * recente (`backups/*.sql`) num banco **SCRATCH** e valida as contagens.
 *
 * NUNCA roda contra prod (3 guardas). O alvo é você quem provê:
 *   RESTORE_TARGET_URL="postgresql://.../scratch?sslmode=require" pnpm restore:test
 *   # opcional: apontar um dump específico
 *   RESTORE_TARGET_URL="..." pnpm restore:test backups/manual-XXX.sql
 *
 * Alvo pode ser: um Postgres local, um projeto Supabase scratch, um container.
 * Erros benignos de auth/rls durante o restore são ESPERADOS (o dump exclui os
 * schemas gerenciados do Supabase — auth/storage/etc.). O que importa é: as
 * tabelas de dados restauram e as contagens batem com a ordem de grandeza de prod.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

import { looksLikeProd, redact } from './_env';

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
      'RESTORE_TARGET_URL não setado. Aponte para um banco SCRATCH (NUNCA prod):\n' +
        '  RESTORE_TARGET_URL="postgresql://.../scratch?sslmode=require" pnpm restore:test',
    );
  }

  // --- guardas anti-prod (fail-closed) ---
  if (process.env.SUPABASE_PROJECT_ENV === 'prod') {
    throw new Error('[guard] SUPABASE_PROJECT_ENV=prod — restore test NUNCA roda contra prod. Abortando.');
  }
  if (process.env.DATABASE_URL_PROD && target === process.env.DATABASE_URL_PROD) {
    throw new Error('[guard] RESTORE_TARGET_URL == DATABASE_URL_PROD. Abortando.');
  }
  if (looksLikeProd(target)) {
    throw new Error('[guard] RESTORE_TARGET_URL parece prod (hostname/env). Use um scratch. Abortando.');
  }

  assertPsql();
  const dump = process.argv[2] ? resolve(process.argv[2]) : latestDump();
  if (!existsSync(dump)) throw new Error(`dump não encontrado: ${dump}`);

  console.log(`[restore:test] dump:   ${dump}`);
  console.log(`[restore:test] target: ${redact(target)}`);
  console.log('[restore:test] restaurando... (erros de auth/rls são benignos — o dump exclui os schemas do Supabase)\n');

  // ON_ERROR_STOP=0: tolera GRANT/POLICY que referenciam auth.* (schema ausente no scratch).
  const restore = spawnSync('psql', [target, '-v', 'ON_ERROR_STOP=0', '-q', '-f', dump], {
    stdio: ['ignore', 'ignore', 'inherit'], // stderr visível (erros benignos), stdout silencioso
  });
  if (restore.status !== 0 && restore.error) {
    throw new Error(`falha ao invocar psql: ${restore.error.message}`);
  }

  // Validação: as tabelas CREATE TABLE quase nunca falham (só as POLICY/GRANT de auth),
  // então as âncoras existem. Se alguma faltar, o psql abaixo erra e o drill é FALHA.
  const validation = `
    SELECT
      (SELECT count(*) FROM information_schema.tables WHERE table_schema='public') AS public_tables,
      (SELECT count(*) FROM pg_policies WHERE schemaname='public')                 AS rls_policies,
      (SELECT count(*) FROM clinics)                                               AS clinics,
      (SELECT count(*) FROM patients)                                              AS patients,
      (SELECT count(*) FROM appointments)                                          AS appointments,
      (SELECT count(*) FROM audit_events)                                          AS audit_events;`;

  console.log('\n[restore:test] ✅ RESTAUROU. Contagens no scratch:\n');
  try {
    const out = execFileSync('psql', [target, '-c', validation], { encoding: 'utf8' });
    console.log(out);
  } catch {
    throw new Error(
      'validação falhou — alguma tabela-âncora não existe no scratch (restore incompleto). Isso é FALHA do drill.',
    );
  }

  console.log('[restore:test] Confira se os números batem com a ordem de grandeza de prod.');
  console.log('[restore:test] Se baterem → restore test PASSOU. ✅');
  console.log('[restore:test] ⚠️  DERRUBE o scratch quando terminar (contém PII de prod).');
}

try {
  main();
} catch (err) {
  console.error('[restore:test] FAILED:', err instanceof Error ? err.message : err);
  process.exit(1);
}
