/**
 * GET /api/cron/outbox
 *
 * Vercel Cron entrypoint. Runs every minute (vercel.json crons[]).
 *
 * Auth — HIGH-08, dual factor:
 *   1. `Authorization: Bearer ${CRON_SECRET}` — shared secret (rotating).
 *   2. Vercel cron-originated requests carry `x-vercel-cron` header (Vercel
 *      adds it automatically). If header missing, even with valid bearer, we
 *      reject — protege contra atacante que vazou o secret mas não consegue
 *      forjar headers que Vercel injeta no Edge Network.
 *      Em DEV, smoke pode bypass via `OUTBOX_CRON_ALLOW_NON_VERCEL=true`.
 *
 * Side effects:
 *   - `import './handlers'` populates the handler registry (consumer-side).
 *   - `import '@/lib/db/schema'` populates the event catalog (producer-side).
 *
 * Response shape mirrors `runOutboxOnce` summary; consumed by smoke-c4.
 */
import './handlers';
import '@/lib/db/schema';

import { env, assertCronRuntimeReady } from '@/lib/env';
import { metrics } from '@/lib/observability/metrics';
import { runOutboxOnce } from '@/lib/outbox/worker';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Vercel Pro plan caps at 60s per cron invocation.
export const maxDuration = 60;

function isAuthorized(req: Request): boolean {
  // 1. Bearer check
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${env.CRON_SECRET}`) return false;

  // 2. Vercel cron-origin check (defense in depth)
  // Vercel atualmente injeta `x-vercel-cron: 1` em requests originadas pelo
  // Cron service. Em DEV / smoke, permitimos override explícito via env.
  const isVercelCron = req.headers.get('x-vercel-cron') !== null;
  const allowNonVercel =
    process.env.OUTBOX_CRON_ALLOW_NON_VERCEL === 'true' ||
    env.NODE_ENV !== 'production';
  if (!isVercelCron && !allowNonVercel) return false;

  return true;
}

export async function GET(req: Request): Promise<Response> {
  assertCronRuntimeReady();

  if (!isAuthorized(req)) {
    metrics.emit('cron.unauthorized', {
      hasBearer: req.headers.get('authorization') !== null,
      hasVercelHeader: req.headers.get('x-vercel-cron') !== null,
    });
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    const summary = await runOutboxOnce();
    return Response.json({ ok: true, ...summary }, { status: 200 });
  } catch (err) {
    metrics.emit('worker.error', { error: err });
    return Response.json(
      { ok: false, error: 'internal' },
      { status: 500 },
    );
  }
}
