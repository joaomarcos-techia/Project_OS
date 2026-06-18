/**
 * GET /api/cron/proactive-followup (C14). Roda a cada ~15min na janela 8-20h
 * local. Os jobs followup já foram agendados pelo handler de
 * `clinical.prontuario.signed` (return_date − 2 dias); aqui só despacha os
 * vencidos. Auth idêntica aos demais crons.
 */
import { assertCronRuntimeReady, env } from '@/lib/env';
import { metrics } from '@/lib/observability/metrics';

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
    metrics.emit('cron.origin_header_missing', { route: 'proactive-followup' });
  }
  return true;
}

export async function GET(req: Request): Promise<Response> {
  assertCronRuntimeReady();
  if (!isAuthorized(req)) {
    metrics.emit('cron.unauthorized', { route: 'proactive-followup' });
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const batch = await processProactiveBatch('followup');
    return Response.json({ ok: true, ...batch }, { status: 200 });
  } catch (err) {
    metrics.emit('proactive.followup.error', { error: err });
    return Response.json({ ok: false, error: 'internal' }, { status: 500 });
  }
}
