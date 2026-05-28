/**
 * `pnpm db:migrate:dev`
 *
 * Applies pending migrations against the DEV Supabase project. Guarded
 * against accidentally running against prod (hostname heuristic + explicit
 * SUPABASE_PROJECT_ENV check).
 */
import { execSync } from 'node:child_process';

import { assertDevContext, redact } from './_env';

function main(): void {
  const { databaseUrl } = assertDevContext();
  console.log(`[migrate:dev] target: ${redact(databaseUrl)}`);

  // Drizzle-kit reads DATABASE_URL from process.env via drizzle.config.ts.
  // We pass the env through explicitly so the child shell sees it (this also
  // matters on Windows where spawn behavior differs from POSIX).
  execSync('drizzle-kit migrate --config=drizzle.config.ts', {
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'development' },
  });

  console.log('[migrate:dev] done.');
}

try {
  main();
} catch (err) {
  console.error('[migrate:dev] FAILED:', err instanceof Error ? err.message : err);
  process.exit(1);
}
