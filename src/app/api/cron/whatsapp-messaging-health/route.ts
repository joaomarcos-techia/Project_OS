/**
 * GET /api/cron/whatsapp-messaging-health — saúde de ENVIO, uma vez por dia.
 *
 * Lê o `health_status` da Meta de cada número ativo que não foi lido nas
 * últimas 20 h e grava o resultado na conexão (0116). A conexão, a tela de
 * Configurações e uma recusa de template por forma de pagamento também leem,
 * fora desta agenda; este cron cobre a clínica que nunca abre a tela.
 *
 * Uma GET por número, bem abaixo do limite de chamadas da Meta por WABA. Roda às
 * 10:30 UTC (07:30 em Brasília), antes da janela da C14 (11–23 UTC): o painel já
 * mostra o aviso antes do primeiro lembrete do dia.
 *
 * Só LEITURA na Meta, como `/api/cron/whatsapp-health`.
 */
import { sweepMessagingHealth } from '@/contexts/messaging';
import { buildRequestContext } from '@/lib/audit/request-context';
import { recordHeartbeat } from '@/lib/cron-heartbeat';
import { withCron } from '@/lib/http/cron';
import { metrics } from '@/lib/observability/metrics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Teto por execução; o resto fica para a próxima. */
const SWEEP_LIMIT = 100;

export const GET = withCron(
  {
    job: 'whatsapp-messaging-health',
    route: 'whatsapp-messaging-health',
    errorEvent: 'messaging.messaging_health.error',
  },
  async (req) => {
    const result = await sweepMessagingHealth(SWEEP_LIMIT, buildRequestContext(req.headers));

    if (result.blocked > 0) {
      // Alarme dedicado: com a conta bloqueada, nenhum lembrete chega ao paciente.
      metrics.emit('messaging.whatsapp.messaging_health_blocked', {
        blocked: result.blocked,
        scanned: result.scanned,
      });
    }
    metrics.emit('messaging.whatsapp.messaging_health_sweep', result);
    await recordHeartbeat('whatsapp-messaging-health', 'success', result);
    return Response.json({ ok: true, ...result }, { status: 200 });
  },
);
