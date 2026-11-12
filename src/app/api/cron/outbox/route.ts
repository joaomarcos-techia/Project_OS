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
import { withCron } from '@/lib/http/cron';
import { runOutboxOnce } from '@/lib/outbox/worker';
import { reconcileAbacatePayRecoveryTick } from '@/contexts/billing/internal/abacatepay-processing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Vercel Pro plan caps at 60s per cron invocation.
export const maxDuration = 60;

// `errorEvent: 'worker.error'` foge do padrão `<domínio>.error` das outras
// rotas, e é DE PROPÓSITO: é o nome que as saved searches e o runbook já usam
// para "a fila parou". Renomear para `cron.outbox.error` deixaria o alerta mais
// bonito e cego.
export const GET = withCron(
  { job: 'outbox', route: 'outbox', errorEvent: 'worker.error' },
  async () => {
    // Reuse the existing minute tick without changing vercel.json. This branch
    // still refuses Production. Independent work runs beside the outbox rather
    // than consuming the daily Asaas reconciler's remaining time budget.
    const [summary] = await Promise.all([
      runOutboxOnce(),
      reconcileAbacatePayRecoveryTick(Date.now() + 35_000),
    ]);
    await recordHeartbeat('outbox', 'success', summary);
    return Response.json({ ok: true, ...summary }, { status: 200 });
  },
);
