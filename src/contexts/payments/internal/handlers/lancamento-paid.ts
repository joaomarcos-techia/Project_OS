/**
 * Recepção registrou pagamento no Caixa → fecha o link do restante (08/10/2026).
 *
 * Reage a `financial.lancamento.paid` com `source: manual` e atendimento. A
 * baixa que veio do próprio link (`gateway`) e eventos anteriores ao campo
 * passam direto. Detached: fechar o link chama o Asaas, e chamada externa não
 * fica dentro da transação do worker (mesmo desenho do cancelamento).
 */
import { registerDetachedHandler } from '@/lib/outbox/registry';

/* eslint-disable boundaries/element-types -- evento + tipo são o contrato PÚBLICO do Financial (mesma exceção dos demais handlers que consomem contratos de vizinhos). */
import { FINANCIAL_EVENTS, type LancamentoPaidPayload } from '@/contexts/financial';
/* eslint-enable boundaries/element-types */

import { closeRemainderAfterManualPayment } from '../charge-closeout';

registerDetachedHandler<LancamentoPaidPayload>(FINANCIAL_EVENTS.LANCAMENTO_PAID, async (ctx) => {
  if (ctx.payload.source !== 'manual' || !ctx.payload.appointmentId) return;
  await closeRemainderAfterManualPayment({
    clinicId: ctx.clinicId,
    appointmentId: ctx.payload.appointmentId,
  });
});
