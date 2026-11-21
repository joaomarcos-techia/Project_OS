/**
 * `pnpm db:migrate:dev`
 *
 * Applies pending migrations against the DEV Supabase project. Guarded
 * against accidentally running against prod (hostname heuristic + explicit
 * SUPABASE_PROJECT_ENV check).
 *
 * Composition guard (journal only, no extra connection): refuses a journal that the Drizzle
 * migrator could apply out of order across branches (gap, missing pinned 0159 of #53, divergent
 * hash). The DB-aware check (ledger + sentinels, with the explicit external-0159 exception) lives
 * in scripts/db-migrate-dev-limited.ts, which is the applier for the shared DEV.
 */
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

import { MIGRATION_COMPOSITION_MANIFEST } from '@/lib/db/migration-composition.manifest';

import { assertDevContext, redact } from './_env';
import { localBinCommand } from './_local-bin';
import { checkComposition } from './security/migration-composition-io';

async function main(): Promise<void> {
  const { databaseUrl } = assertDevContext();
  await checkComposition({
    folder: resolve(process.cwd(), 'drizzle/migrations'),
    manifest: MIGRATION_COMPOSITION_MANIFEST,
  });
  console.log(`[migrate:dev] target: ${redact(databaseUrl)}`);

  // Drizzle-kit reads DATABASE_URL from process.env via drizzle.config.ts.
  // We pass the env through explicitly so the child shell sees it (this also
  // matters on Windows where spawn behavior differs from POSIX).
  execSync(`${localBinCommand('drizzle-kit')} migrate --config=drizzle.config.ts`, {
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'development' },
  });

  console.log('[migrate:dev] done.');
}

main().catch((err: unknown) => {
  console.error('[migrate:dev] FAILED:', err instanceof Error ? err.message : err);
  process.exit(1);
});
