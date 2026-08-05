/**
 * Cleanup operacional de `idempotency_keys` — CRITICAL-02.
 *
 * Roda sob env do operador. Deleta APENAS rows completadas (response IS NOT NULL)
 * cujo expires_at venceu. Imprime contadores de in-flight órfãs (response IS NULL,
 * created_at > 1h) para investigação manual.
 *
 * Pattern: invocar semanal via cron de operador (cron tab pessoal, GitHub Action
 * scheduled, ou Vercel Cron dedicado em C16).
 *
 * Execução:
 *   pnpm idempotency:cleanup            # roda e imprime resultado
 *   pnpm idempotency:cleanup --dry-run  # só inspecion
 */
import './_env';

import { cleanupExpiredIdempotencyKeys, diagnoseInFlightOrphans } from '@/lib/idempotency/cleanup';

const dryRun = process.argv.includes('--dry-run');

(async () => {
  const orphans = await diagnoseInFlightOrphans();
  if (orphans.length > 0) {
    console.warn(
      `[WARN] ${orphans.length} in-flight idempotency_keys órfãs (response IS NULL, criadas > 1h atrás).`,
    );
    console.warn('       NÃO serão deletadas. Investigar antes:');
    for (const o of orphans.slice(0, 10)) {
      console.warn(
        `         - ${o.key} (clinic=${o.clinic_id}, age=${Math.round(o.age_minutes)}min)`,
      );
    }
    if (orphans.length > 10) console.warn(`         ... (+${orphans.length - 10} more)`);
    console.warn(
      '       Possíveis causas: crash de Server Action, lambda matada mid-TX, bug em mutation.ts.',
    );
  } else {
    console.log('[OK] zero in-flight orphans');
  }

  if (dryRun) {
    console.log('[dry-run] no DELETE executed');
    process.exit(0);
  }

  const deleted = await cleanupExpiredIdempotencyKeys();
  console.log(`[OK] deleted ${deleted} expired+completed idempotency_keys rows`);
  process.exit(0);
})();
