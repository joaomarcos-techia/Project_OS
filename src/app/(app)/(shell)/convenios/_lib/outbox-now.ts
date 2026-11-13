/**
 * Processa AGORA os eventos de Convênios que o próprio request publicou (por chave
 * idempotente), depois da resposta (`after`). O cron do outbox continua sendo a
 * garantia; isto só tira a espera — e no Preview/DEV, que não têm cron, é o que faz a
 * guia automática da conclusão e o recebível da coparticipação confirmada existirem.
 *
 * Mesmo caminho do tick (reserva com SKIP LOCKED, handler com RLS, finalização com
 * guarda), só para as linhas `pending` das chaves pedidas: nunca processa evento de
 * outra clínica nem de outro request. Falha aqui não desfaz nada (o evento fica para o
 * cron) e não muda a resposta da ação.
 *
 * Vive na camada de app porque o boot dos handlers (`/api/cron/outbox/handlers`) é de app.
 */
import 'server-only';

import { after } from 'next/server';

import { captureBackgroundError } from '@/lib/observability/capture';
import { metrics } from '@/lib/observability/metrics';
import type { OutboxSelection } from '@/lib/outbox/worker';

export function processOutboxSoon(flow: string, selections: readonly OutboxSelection[]): void {
  if (selections.every((s) => s.idempotencyKeys.length === 0)) return;
  try {
    after(async () => {
      try {
        await import('@/app/api/cron/outbox/handlers');
        await import('@/lib/db/schema');
        const { runOutboxEventsNow } = await import('@/lib/outbox/worker');
        const summary = await runOutboxEventsNow(selections);
        metrics.emit('health_insurance.outbox_now', { flow, ...summary });
      } catch (error) {
        captureBackgroundError(error, { flow: `health_insurance.${flow}.outbox_now` });
      }
    });
  } catch {
    // Fora de um request (teste, script): o cron processa.
  }
}
