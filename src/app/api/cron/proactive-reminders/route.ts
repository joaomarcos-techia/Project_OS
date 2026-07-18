/**
 * GET /api/cron/proactive-reminders (C14). Roda a cada ~15min na janela 8-20h
 * local (o processor aplica a janela por clínica). Materializa lembretes D-1 a
 * partir do read-model do Scheduling (regra de "quem" mora lá) e despacha os
 * jobs vencidos. Auth idêntica aos demais crons (Bearer CRON_SECRET + header
 * Vercel não-fatal).
 */
import { recordHeartbeat } from '@/lib/cron-heartbeat';
import { withCron } from '@/lib/http/cron';
import { metrics } from '@/lib/observability/metrics';
import { isProactiveEnabled } from '@/lib/platform-settings';

import { enqueueRemindersDue } from '@/contexts/ai-agent/proactive-jobs/application/enqueue';
import { processProactiveBatch } from '@/contexts/ai-agent/proactive-jobs/application/process';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export const GET = withCron(
  {
    job: 'proactive-reminders',
    route: 'proactive-reminders',
    errorEvent: 'proactive.reminders.error',
  },
  async () => {
    // Kill-switch global (platform_settings): pula ANTES de varrer a agenda.
    // O desfecho `skipped` continua sendo do handler — só ele sabe distinguir
    // "não havia o que fazer" de "falhou".
    if (!(await isProactiveEnabled())) {
      metrics.emit('proactive.reminders.skipped_disabled', {});
      await recordHeartbeat('proactive-reminders', 'skipped', { reason: 'disabled' });
      return Response.json({ ok: true, skipped: 'disabled' }, { status: 200 });
    }

    const enq = await enqueueRemindersDue();
    const batch = await processProactiveBatch('reminder');
    await recordHeartbeat('proactive-reminders', 'success', {
      enqueued: enq.enqueued,
      sent: batch.sent,
    });
    return Response.json({ ok: true, enqueued: enq.enqueued, ...batch }, { status: 200 });
  },
);
