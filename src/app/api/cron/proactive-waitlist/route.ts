/**
 * GET /api/cron/proactive-waitlist (WAIT-001). Duas responsabilidades sobre a
 * mesma fila, na ordem que importa:
 *
 *   1. EXPIRA ofertas sem resposta e REPASSA a vaga ao próximo elegível. Sem
 *      isso, a primeira pessoa que não responde congela o horário para sempre —
 *      o mesmo desfecho de não ter lista de espera.
 *   2. DESPACHA os jobs `waitlist_offer` vencidos (o handler de
 *      `scheduling.waitlist.offered` os enfileirou).
 *
 * Expirar primeiro é de propósito: o repasse publica um evento novo, cujo job
 * já é despachado nesta mesma execução em vez de esperar a próxima.
 */
import { expireStaleWaitlistOffers } from '@/contexts/scheduling';
import { processProactiveBatch } from '@/contexts/ai-agent/proactive-jobs/application/process';
import { recordHeartbeat } from '@/lib/cron-heartbeat';
import { withCron } from '@/lib/http/cron';
import { metrics } from '@/lib/observability/metrics';
import { isProactiveEnabled } from '@/lib/platform-settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Janela de resposta. Curta porque a vaga é perecível — em geral o horário
 * liberado é dos próximos dias — e porque quem não respondeu volta para a fila,
 * não perde o lugar.
 */
const OFFER_TTL_MINUTES = 240;
const EXPIRE_LIMIT = 200;

export const GET = withCron(
  {
    job: 'proactive-waitlist',
    route: 'proactive-waitlist',
    errorEvent: 'proactive.waitlist.error',
  },
  async () => {
    // A expiração é higiene de agenda e roda mesmo com a mensageria proativa
    // desligada: senão o kill-switch de mensagens travaria a fila inteira.
    const expired = await expireStaleWaitlistOffers({
      olderThanMinutes: OFFER_TTL_MINUTES,
      limit: EXPIRE_LIMIT,
    });
    metrics.emit('waitlist.offers.expired', { ...expired });

    if (!(await isProactiveEnabled())) {
      metrics.emit('proactive.waitlist.skipped_disabled', {});
      await recordHeartbeat('proactive-waitlist', 'skipped', { reason: 'disabled', ...expired });
      return Response.json({ ok: true, skipped: 'disabled', ...expired }, { status: 200 });
    }

    const batch = await processProactiveBatch('waitlist_offer');
    await recordHeartbeat('proactive-waitlist', 'success', { sent: batch.sent, ...expired });
    return Response.json({ ok: true, ...batch, ...expired }, { status: 200 });
  },
);
