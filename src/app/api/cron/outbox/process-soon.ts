/**
 * Processa AGORA, depois da resposta (`after`), os eventos que o próprio request publicou
 * (por chave idempotente). O cron do outbox (`/api/cron/outbox`, a cada minuto em
 * produção) continua sendo a garantia; isto só tira a espera — e no Preview/DEV, que não
 * têm cron (a Vercel só agenda cron no deploy de produção), é o que faz a guia automática,
 * o recebível da coparticipação, o XML em segundo plano e a baixa do pagamento do
 * paciente acontecerem sem ninguém acionar nada (R49).
 *
 * Mesmo caminho do tick (reserva com SKIP LOCKED, handler com RLS, finalização com
 * guarda), só para as linhas `pending` das chaves pedidas: nunca processa evento de outra
 * clínica nem de outro request, e um tick concorrente nunca processa a mesma linha.
 * Falha aqui não desfaz nada (o evento fica para o cron) e não muda a resposta.
 *
 * Vive na camada de app porque o boot dos handlers (`./handlers`) é de app.
 */
import 'server-only';

import { after } from 'next/server';

import { captureBackgroundError } from '@/lib/observability/capture';
import { metrics } from '@/lib/observability/metrics';
import type { WorkerTickSummary } from '@/lib/outbox/types';
import type { OutboxSelection } from '@/lib/outbox/worker';

/** Roda os eventos pedidos agora (dentro de um `after` já aberto). */
export async function runOutboxSelectionsNow(
  selections: readonly OutboxSelection[],
): Promise<WorkerTickSummary> {
  await import('./handlers');
  await import('@/lib/db/schema');
  const { runOutboxEventsNow } = await import('@/lib/outbox/worker');
  return runOutboxEventsNow(selections);
}

/** Agenda uma tarefa para depois da resposta; erro vai para a observabilidade, nunca para o usuário. */
export function runAfterResponse(flow: string, task: () => Promise<void>): void {
  try {
    after(async () => {
      try {
        await task();
      } catch (error) {
        captureBackgroundError(error, { flow: `${flow}.after_response` });
      }
    });
  } catch {
    // Fora de um request (teste, script): o cron processa.
  }
}

export function processOutboxSoon(flow: string, selections: readonly OutboxSelection[]): void {
  if (selections.every((s) => s.idempotencyKeys.length === 0)) return;
  runAfterResponse(flow, async () => {
    const summary = await runOutboxSelectionsNow(selections);
    metrics.emit('outbox.process_soon', { flow, ...summary });
  });
}
