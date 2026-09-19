/**
 * GET /api/cron/proactive-deposit-link (ADR-049 1.6a). Despacha os jobs
 * `deposit_link`: entrega ao paciente o link do sinal que a varredura da 1.3
 * gerou.
 *
 * Este é o elo que faltava desde a 1.3. Sem ele a cobrança nascia, o
 * `invoice_url` ficava guardado em `patient_charges`, e **ninguém o entregava**:
 * o hold vencia, a varredura cancelava o agendamento, e o paciente perdia a
 * consulta sem nunca ter recebido como pagar. Anti-no-show que produz no-show.
 *
 * Cron PRÓPRIO, e não uma carona num existente, pelo mesmo motivo dos outros
 * quatro: `processProactiveBatch` reivindica por TIPO, então um tipo sem cron
 * nunca sai da fila.
 *
 * Mesma janela dos demais (a cada 15 min, 11-23 UTC = 8-20h em Brasília): o `claimDue`
 * já aplica a janela local, e madrugada é a hora errada para pedir pagamento.
 * O hold de 24h absorve a espera.
 *
 * O kill-switch da mensageria proativa vale aqui como nos outros: desligado, a
 * fila acumula e nada é enviado — o link continua válido em `patient_charges` e
 * a próxima execução o entrega.
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
    job: 'proactive-deposit-link',
    route: 'proactive-deposit-link',
    errorEvent: 'proactive.deposit_link.error',
  },
  async () => {
    if (!(await isProactiveEnabled())) {
      metrics.emit('proactive.deposit_link.skipped_disabled', {});
      await recordHeartbeat('proactive-deposit-link', 'skipped', { reason: 'disabled' });
      return Response.json({ ok: true, skipped: 'disabled' }, { status: 200 });
    }

    const batch = await processProactiveBatch('deposit_link');
    await recordHeartbeat('proactive-deposit-link', 'success', { sent: batch.sent });
    return Response.json({ ok: true, ...batch }, { status: 200 });
  },
);
