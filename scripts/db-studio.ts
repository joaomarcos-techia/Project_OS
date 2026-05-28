/**
 * `pnpm db:studio`
 *
 * Opens Drizzle Studio (web UI). DEV ONLY — Studio is a "GUI write access"
 * surface with no audit trail; running it against prod = data tampering risk
 * + LGPD violation.
 */
import { execSync } from 'node:child_process';

import { assertDevContext, redact } from './_env';

function main(): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('[studio] NODE_ENV=production — refusing to open Studio against prod.');
  }

  const { databaseUrl } = assertDevContext();
  console.log(`[studio] target: ${redact(databaseUrl)}`);
  console.log('[studio] tip: ctrl+c to stop.');

  execSync('drizzle-kit studio --config=drizzle.config.ts', {
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'development' },
  });
}

try {
  main();
} catch (err) {
  console.error('[studio] FAILED:', err instanceof Error ? err.message : err);
  process.exit(1);
}
