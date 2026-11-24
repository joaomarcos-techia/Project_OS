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
import { recordHeartbeat } from '@/lib/cron-heartbeat';
import { metrics } from '@/lib/observability/metrics';
import { GatewayReadError } from '@/lib/payments/saas/contracts';
import { withCron } from '@/lib/http/cron';
import { runOutboxOnce } from '@/lib/outbox/worker';
import {
  reconcileAbacatePayRecoveryTick,
  reconcileAbacatePayInboxTick,
  reconcileAbacatePayCheckoutClosuresTick,
  reconcileAbacatePayRenewalWatchTick,
} from '@/contexts/billing/internal/abacatepay-processing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Application budget. Verify the platform plan separately; this is not its quota.
export const maxDuration = 60;

// R61 (shared minute tick): the outbox stops RESERVING new events this long after the
// invocation starts. Handlers already started are never abandoned; they finish through
// their own timeouts. 60 s maxDuration − up to 5 s of function start − 20 s for a
// started handler (largest single external timeout) − 5 s margin = 30 s. Deferred events
// stay `pending` for the next minute. Unreleased exports are not valid in a route file,
// so the window lives here and the worker contract stays in `runOutboxOnce`.
const OUTBOX_RESERVATION_WINDOW_MS = 30_000;

async function runRegisteredOutbox(invocationStartedAt: number) {
  // Handler boot belongs to the shared event worker, not to SaaS reconciliation.
  // A module import failure must remain observable without preventing the other
  // financial jobs from starting and finishing their independent transactions.
  await import('@/lib/db/schema');
  await import('./handlers');
  return runOutboxOnce({
    reserveUntil: invocationStartedAt + OUTBOX_RESERVATION_WINDOW_MS,
    // Catalog types without a consumer (F-14 "producer ahead") end `skipped` in one
    // UPDATE, with the same terminal fields as the per-event path, instead of
    // taking batch slots from events that do have a consumer.
    skipUnhandledInBulk: true,
  });
}

// `errorEvent: 'worker.error'` foge do padrão `<domínio>.error` das outras
// rotas, e é DE PROPÓSITO: é o nome que as saved searches e o runbook já usam
// para "a fila parou". Renomear para `cron.outbox.error` deixaria o alerta mais
// bonito e cego.
export const GET = withCron(
  { job: 'outbox', route: 'outbox', errorEvent: 'worker.error' },
  async () => {
    // Reuse the existing minute tick without changing vercel.json. This branch
    // selects its explicit environment. Independent work runs beside the outbox
    // rather than consuming the daily Asaas reconciler's remaining time budget.
    // One clock for the whole invocation: every job derives its budget from it.
    const invocationStartedAt = Date.now();
    const [outbox, recovery, inbox, closures, watch] = await Promise.allSettled([
      runRegisteredOutbox(invocationStartedAt),
      reconcileAbacatePayRecoveryTick(invocationStartedAt + 35_000),
      reconcileAbacatePayInboxTick(),
      reconcileAbacatePayCheckoutClosuresTick(invocationStartedAt + 20_000),
      reconcileAbacatePayRenewalWatchTick(),
    ]);
    for (const [job, result] of [
      ['outbox', outbox],
      ['abacatepay_recovery', recovery],
      ['abacatepay_inbox', inbox],
      ['abacatepay_closures', closures],
      ['abacatepay_renewal_watch', watch],
    ] as const) {
      if (result.status === 'rejected') {
        metrics.emit('worker.job_failed', {
          job,
          code: result.reason instanceof GatewayReadError ? result.reason.code : 'unexpected',
          httpStatus: result.reason instanceof GatewayReadError ? result.reason.httpStatus : null,
        });
      }
    }
    // Await all independent jobs before reporting failure. An early financial
    // rejection must not abandon an independent outbox write at HTTP teardown.
    if (outbox.status === 'rejected') throw outbox.reason;
    if (recovery.status === 'rejected') throw recovery.reason;
    if (inbox.status === 'rejected') throw inbox.reason;
    if (closures.status === 'rejected') throw closures.reason;
    if (watch.status === 'rejected') throw watch.reason;
    const summary = outbox.value;
    await recordHeartbeat('outbox', 'success', summary);
    return Response.json({ ok: true, ...summary }, { status: 200 });
  },
);
