/**
 * GET /api/cron/payments-deposit (ADR-049 1.3 · ADR-051 1.5b.3).
 *
 * Um tick, o ciclo de vida inteiro do dinheiro do paciente:
 *   1. **cobra** o sinal dos agendamentos recentes das clínicas com a política ligada;
 *   2. **expira** os holds vencidos — cancela o agendamento (pela máquina de estados
 *      congelada, via `applyTransition`) e devolve a vaga à lista de espera;
 *   3. **cobra o RESTANTE** dos atendimentos concluídos, pelo saldo que o
 *      **Financial** informa (nunca por conta própria: um pagamento em dinheiro
 *      na recepção não existe do lado do gateway, e cobrar por cima dele mandaria
 *      link ao paciente por algo que ele já pagou).
 *
 * O nome da rota ficou do tempo em que só havia sinal; renomeá-la custaria o
 * manifesto da Vercel, os docs de cron e o histórico de heartbeat, para não
 * mudar nada de comportamento.
 *
 * Um cron só, e não dois, porque as duas metades são o mesmo ciclo e rodam na
 * mesma cadência: cada cron a mais é mais uma coisa para monitorar às 3h da manhã.
 * A expiração roda MESMO SE a cobrança falhar — são independentes, e deixar vaga
 * presa por causa de um problema no gateway seria o pior dos dois mundos.
 * Roda a cada 15 minutos: o hold dura 24h, então minutos de latência não custam
 * nada — e o intervalo curto faz o link chegar ao paciente enquanto ele ainda
 * lembra que marcou.
 *
 * **Por que cron e não handler de evento:** `scheduling.appointment.created` já
 * tem dono (metering do Billing) e o outbox aceita um handler por evento. Este é o
 * mesmo padrão de reminder e dunning — e é **auto-curável**: uma indisponibilidade
 * do gateway é recoberta pela varredura seguinte, sem intervenção.
 *
 * `destructive: false`: o job cria cobrança, não apaga nem sobrescreve nada. É
 * idempotente em duas camadas (filtro de já-cobrados + `UNIQUE` no insert, mais a
 * recuperação por `external_reference` no gateway).
 *
 * Auth idêntica aos demais crons: Bearer CRON_SECRET + header Vercel não-fatal.
 */
import { recordHeartbeat } from '@/lib/cron-heartbeat';
import { withCron } from '@/lib/http/cron';
import { metrics } from '@/lib/observability/metrics';

import { runDepositScan } from '@/contexts/payments/internal/deposit-scan';
import { runRemainderScan } from '@/contexts/payments/internal/remainder-scan';
import { expireDepositHolds } from '@/contexts/scheduling/internal/deposit-hold';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export const GET = withCron(
  {
    job: 'payments-deposit',
    route: 'payments-deposit',
    errorEvent: 'payments.deposit.scan_failed',
    destructive: false,
  },
  async () => {
    // `allSettled`: nenhuma das três metades pode depender do sucesso das outras.
    // Deixar vaga presa por causa de um problema no gateway seria o pior dos
    // mundos, e o restante não pode parar porque o sinal falhou.
    const [scan, expiry, remainder] = await Promise.allSettled([
      runDepositScan(),
      expireDepositHolds(),
      runRemainderScan(),
    ]);

    const charged = scan.status === 'fulfilled' ? scan.value : null;
    const expired = expiry.status === 'fulfilled' ? expiry.value : null;
    const remaining = remainder.status === 'fulfilled' ? remainder.value : null;
    if (charged) metrics.emit('payments.deposit.scan', charged);
    if (expired) metrics.emit('scheduling.deposit_hold.expired', expired);
    if (remaining) metrics.emit('payments.remainder.scan', remaining);

    // Uma das metades ter falhado é erro do tick: o heartbeat precisa dizer isso,
    // senão o painel mostra "ok" enquanto metade do ciclo está parada.
    const failures = [scan, expiry, remainder].filter((r) => r.status === 'rejected');
    const body = {
      charge: charged,
      expiry: expired,
      remainder: remaining,
      failures: failures.length,
    };
    if (failures.length > 0) {
      for (const failure of failures) {
        if (failure.status === 'rejected') {
          metrics.emit('payments.deposit.scan_failed', { error: failure.reason });
        }
      }
      await recordHeartbeat('payments-deposit', 'error', { failures: failures.length });
      return Response.json({ ok: false, ...body }, { status: 500 });
    }

    await recordHeartbeat('payments-deposit', 'success', {
      charged: charged?.charged ?? 0,
      expired: expired?.cancelled ?? 0,
      remainder: remaining?.charged ?? 0,
    });
    return Response.json({ ok: true, ...body }, { status: 200 });
  },
);
