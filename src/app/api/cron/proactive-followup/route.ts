/**
 * GET /api/cron/proactive-followup (C14). Roda a cada ~15min na janela 8-20h
 * local. Despacha tanto retorno clínico (`followup`) quanto recuperação após
 * falta (`no_show_followup`) pela mesma infraestrutura. Auth idêntica aos demais
 * crons.
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

    const followup = await processProactiveBatch('followup');
    const noShowFollowup = await processProactiveBatch('no_show_followup');
    const totals = {
      scanned: followup.scanned + noShowFollowup.scanned,
      sent: followup.sent + noShowFollowup.sent,
      cancelled: followup.cancelled + noShowFollowup.cancelled,
      retried: followup.retried + noShowFollowup.retried,
      failed: followup.failed + noShowFollowup.failed,
    };
    await recordHeartbeat('proactive-followup', 'success', totals);
    return Response.json(
      { ok: true, ...totals, batches: { followup, noShowFollowup } },
      { status: 200 },
    );
  },
);
