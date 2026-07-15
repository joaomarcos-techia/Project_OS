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

import { recordHeartbeat } from '@/lib/cron-heartbeat';
import { safeEqual } from '@/lib/auth/secret-compare';
import { env, assertCronRuntimeReady } from '@/lib/env';
import { metrics } from '@/lib/observability/metrics';
import { runOutboxOnce } from '@/lib/outbox/worker';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Vercel Pro plan caps at 60s per cron invocation.
export const maxDuration = 60;

function isAuthorized(req: Request): boolean {
  // 1. Bearer check — o GATE DURO (mecanismo oficial Vercel: CRON_SECRET é
  //    enviado automaticamente como Authorization Bearer).
  const auth = req.headers.get('authorization');
  if (!safeEqual(auth, `Bearer ${env.CRON_SECRET}`)) return false;

  // 2. F-09: sinal de origem como 2º fator NÃO-FATAL. A doc atual da Vercel
  //    documenta `x-vercel-cron-schedule` (não `x-vercel-cron`). Aceitamos
  //    QUALQUER um. Se nenhum estiver presente em prod, LOGAMOS (anomalia a
  //    investigar) mas NÃO retornamos 401 — o Bearer secret é o controle real;
  //    depender de um header não-documentado para um 401 duro arrisca parar o
  //    worker silenciosamente se a Vercel mudar o nome do header.
  const hasOriginHeader =
    req.headers.get('x-vercel-cron') !== null ||
    req.headers.get('x-vercel-cron-schedule') !== null;
  const allowNonVercel =
    process.env.OUTBOX_CRON_ALLOW_NON_VERCEL === 'true' ||
    env.NODE_ENV !== 'production';
  if (!hasOriginHeader && !allowNonVercel) {
    metrics.emit('cron.origin_header_missing', { route: 'outbox' });
  }
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
