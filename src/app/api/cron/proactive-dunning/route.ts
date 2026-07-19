/**
 * GET /api/cron/proactive-dunning (C14). Roda a cada ~15min na janela 8-20h
 * local. Materializa cobranças D+3/D+7 a partir do read-model do Financial
 * (regra "o que é cobrável e vencido" mora lá; `pending ≠ inadimplente`) e
 * despacha os jobs vencidos — sempre com opt-in de cobrança (LGPD) checado no
 * processor. Auth idêntica aos demais crons.
 */
import { recordHeartbeat } from '@/lib/cron-heartbeat';
import { withCron } from '@/lib/http/cron';
import { metrics } from '@/lib/observability/metrics';
import { isProactiveEnabled } from '@/lib/platform-settings';

import { enqueueDunningDue } from '@/contexts/ai-agent/proactive-jobs/application/enqueue';
import { processProactiveBatch } from '@/contexts/ai-agent/proactive-jobs/application/process';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export const GET = withCron(
  { job: 'proactive-dunning', route: 'proactive-dunning', errorEvent: 'proactive.dunning.error' },
  async () => {
    // Kill-switch global (platform_settings): pula ANTES de varrer recebíveis.
    if (!(await isProactiveEnabled())) {
      metrics.emit('proactive.dunning.skipped_disabled', {});
      await recordHeartbeat('proactive-dunning', 'skipped', { reason: 'disabled' });
      return Response.json({ ok: true, skipped: 'disabled' }, { status: 200 });
    }

    const enq = await enqueueDunningDue();
    const batch = await processProactiveBatch('dunning');
    await recordHeartbeat('proactive-dunning', 'success', {
      enqueued: enq.enqueued,
      sent: batch.sent,
    });
    return Response.json({ ok: true, enqueued: enq.enqueued, ...batch }, { status: 200 });
  },
);
