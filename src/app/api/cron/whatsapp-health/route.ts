/**
 * GET /api/cron/whatsapp-health (META-001).
 *
 * A tela de Configurações revalida o canal quando alguém a abre. Uma clínica que
 * nunca abre aquela tela continuaria vendo "conectado" no checklist do painel
 * enquanto a Meta não entrega webhook nenhum — que é exatamente o estado que o
 * pentest encontrou. Esta varredura fecha essa janela.
 *
 * Só LEITURA na Meta: nenhuma reinscrição automática. Reassinar o app é decisão
 * operacional explícita (o token pode ter sido revogado de propósito), e um cron
 * que reconecta sozinho esconderia a causa em vez de expô-la.
 */
import { sweepChannelHealth } from '@/contexts/messaging';
import { recordHeartbeat } from '@/lib/cron-heartbeat';
import { withCron } from '@/lib/http/cron';
import { metrics } from '@/lib/observability/metrics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Teto por run: cada conexão custa até 3 GETs ao Graph. */
const SWEEP_LIMIT = 100;

export const GET = withCron(
  { job: 'whatsapp-health', route: 'whatsapp-health', errorEvent: 'messaging.health.error' },
  async () => {
    const result = await sweepChannelHealth(SWEEP_LIMIT);

    if (result.broken > 0) {
      // Alarme dedicado: canal inoperante é perda silenciosa de paciente.
      metrics.emit('messaging.whatsapp.health_broken', {
        broken: result.broken,
        scanned: result.scanned,
      });
    }
    metrics.emit('messaging.whatsapp.health_sweep', result);
    await recordHeartbeat('whatsapp-health', 'success', result);
    return Response.json({ ok: true, ...result }, { status: 200 });
  },
);
