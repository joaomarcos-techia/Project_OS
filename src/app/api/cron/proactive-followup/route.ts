/**
 * GET /api/cron/proactive-followup (C14). Roda a cada ~15min na janela 8-20h
 * local. Os jobs followup já foram agendados pelo handler de
 * `clinical.prontuario.signed` (return_date − 2 dias); aqui só despacha os
 * vencidos. Auth idêntica aos demais crons.
 */
import { recordHeartbeat } from '@/lib/cron-heartbeat';
import { withCron } from '@/lib/http/cron';
import { metrics } from '@/lib/observability/metrics';
import { isProactiveEnabled } from '@/lib/platform-settings';

import { processProactiveBatch } from '@/contexts/ai-agent/proactive-jobs/application/process';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export const GET = withCron(
  {
    job: 'proactive-followup',
    route: 'proactive-followup',
    errorEvent: 'proactive.followup.error',
  },
  async () => {
    // Kill-switch global (platform_settings): pula ANTES de reivindicar jobs.
    if (!(await isProactiveEnabled())) {
      metrics.emit('proactive.followup.skipped_disabled', {});
      await recordHeartbeat('proactive-followup', 'skipped', { reason: 'disabled' });
      return Response.json({ ok: true, skipped: 'disabled' }, { status: 200 });
    }

    const batch = await processProactiveBatch('followup');
    await recordHeartbeat('proactive-followup', 'success', { sent: batch.sent });
    return Response.json({ ok: true, ...batch }, { status: 200 });
  },
);
