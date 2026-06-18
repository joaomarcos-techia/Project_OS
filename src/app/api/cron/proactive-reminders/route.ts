/**
 * GET /api/cron/proactive-reminders (C14). Roda a cada ~15min na janela 8-20h
 * local (o processor aplica a janela por clínica). Materializa lembretes D-1 a
 * partir do read-model do Scheduling (regra de "quem" mora lá) e despacha os
 * jobs vencidos. Auth idêntica aos demais crons (Bearer CRON_SECRET + header
 * Vercel não-fatal).
 */
import { assertCronRuntimeReady, env } from '@/lib/env';
import { metrics } from '@/lib/observability/metrics';

import { enqueueRemindersDue } from '@/contexts/ai-agent/proactive-jobs/application/enqueue';
import { processProactiveBatch } from '@/contexts/ai-agent/proactive-jobs/application/process';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function isAuthorized(req: Request): boolean {
  if (req.headers.get('authorization') !== `Bearer ${env.CRON_SECRET}`) return false;
  const hasOriginHeader =
    req.headers.get('x-vercel-cron') !== null || req.headers.get('x-vercel-cron-schedule') !== null;
  const allowNonVercel =
    process.env.OUTBOX_CRON_ALLOW_NON_VERCEL === 'true' || env.NODE_ENV !== 'production';
  if (!hasOriginHeader && !allowNonVercel) {
    metrics.emit('cron.origin_header_missing', { route: 'proactive-reminders' });
  }
  return true;
}

export async function GET(req: Request): Promise<Response> {
  assertCronRuntimeReady();
  if (!isAuthorized(req)) {
    metrics.emit('cron.unauthorized', { route: 'proactive-reminders' });
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const enq = await enqueueRemindersDue();
    const batch = await processProactiveBatch('reminder');
    return Response.json({ ok: true, enqueued: enq.enqueued, ...batch }, { status: 200 });
  } catch (err) {
    metrics.emit('proactive.reminders.error', { error: err });
    return Response.json({ ok: false, error: 'internal' }, { status: 500 });
  }
}
