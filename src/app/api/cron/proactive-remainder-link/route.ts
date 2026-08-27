/**
 * GET /api/cron/proactive-remainder-link (D35 / 1.6c).
 *
 * Cron C14 próprio porque `processProactiveBatch` reivindica por tipo. Reusa
 * integralmente lease, janela 8–20h, retry/backoff, dedup, consentimento,
 * suppression e envio via Meta do worker existente.
 */
import { processProactiveBatch } from '@/contexts/ai-agent/proactive-jobs/application/process';
import { recordHeartbeat } from '@/lib/cron-heartbeat';
import { withCron } from '@/lib/http/cron';
import { metrics } from '@/lib/observability/metrics';
import { isProactiveEnabled } from '@/lib/platform-settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export const GET = withCron(
  {
    job: 'proactive-remainder-link',
    route: 'proactive-remainder-link',
    errorEvent: 'proactive.remainder_link.error',
  },
  async () => {
    if (!(await isProactiveEnabled())) {
      metrics.emit('proactive.remainder_link.skipped_disabled', {});
      await recordHeartbeat('proactive-remainder-link', 'skipped', { reason: 'disabled' });
      return Response.json({ ok: true, skipped: 'disabled' }, { status: 200 });
    }

    const batch = await processProactiveBatch('remainder_link');
    await recordHeartbeat('proactive-remainder-link', 'success', { sent: batch.sent });
    return Response.json({ ok: true, ...batch }, { status: 200 });
  },
);
