/**
 * GET /api/cron/outbox
 *
 * Vercel Cron entrypoint. Runs every minute (vercel.json crons[]).
 *
 * Auth — SINGLE-FACTOR: Bearer `CRON_SECRET`, em [cron-auth.ts]. O header
 * `x-vercel-cron` NÃO é gate (só anomalia observável) — ver F-09 lá.
 *
 * Side effects:
 *   - `import './handlers'` populates the handler registry (consumer-side).
 *   - `import '@/lib/db/schema'` populates the event catalog (producer-side).
 *
 * Response shape mirrors `runOutboxOnce` summary; consumed by smoke-c4.
 */
import './handlers';
import '@/lib/db/schema';

import { recordHeartbeat } from '@/lib/cron-heartbeat';
import { assertCronRuntimeReady } from '@/lib/env';
import { assertCronAuth } from '@/lib/http/cron-auth';
import { metrics } from '@/lib/observability/metrics';
import { runOutboxOnce } from '@/lib/outbox/worker';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Vercel Pro plan caps at 60s per cron invocation.
export const maxDuration = 60;

export async function GET(req: Request): Promise<Response> {
  assertCronRuntimeReady();

  const denied = assertCronAuth(req, { route: 'outbox' });
  if (denied) return denied;

  try {
    const summary = await runOutboxOnce();
    await recordHeartbeat('outbox', 'success', summary);
    return Response.json({ ok: true, ...summary }, { status: 200 });
  } catch (err) {
    metrics.emit('worker.error', { error: err });
    return Response.json(
      { ok: false, error: 'internal' },
      { status: 500 },
    );
  }
}
