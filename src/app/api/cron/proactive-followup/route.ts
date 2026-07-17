/**
 * GET /api/cron/proactive-followup (C14). Roda a cada ~15min na janela 8-20h
 * local. Os jobs followup já foram agendados pelo handler de
 * `clinical.prontuario.signed` (return_date − 2 dias); aqui só despacha os
 * vencidos. Auth idêntica aos demais crons.
 */
import { recordHeartbeat } from '@/lib/cron-heartbeat';
import { assertCronRuntimeReady } from '@/lib/env';
import { assertCronAuth } from '@/lib/http/cron-auth';
import { metrics } from '@/lib/observability/metrics';
import { isProactiveEnabled } from '@/lib/platform-settings';

import { processProactiveBatch } from '@/contexts/ai-agent/proactive-jobs/application/process';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: Request): Promise<Response> {
  assertCronRuntimeReady();
  const denied = assertCronAuth(req, { route: 'proactive-followup' });
  if (denied) return denied;

  // Kill-switch global (platform_settings): pula ANTES de reivindicar jobs.
  if (!(await isProactiveEnabled())) {
    metrics.emit('proactive.followup.skipped_disabled', {});
    await recordHeartbeat('proactive-followup', 'skipped', { reason: 'disabled' });
    return Response.json({ ok: true, skipped: 'disabled' }, { status: 200 });
  }

  try {
    const batch = await processProactiveBatch('followup');
    await recordHeartbeat('proactive-followup', 'success', { sent: batch.sent });
    return Response.json({ ok: true, ...batch }, { status: 200 });
  } catch (err) {
    metrics.emit('proactive.followup.error', { error: err });
    return Response.json({ ok: false, error: 'internal' }, { status: 500 });
  }
}
