/**
 * TEMP C6 → substituir pelo handler de Financial em C9.
 *
 * O contrato `scheduling.appointment.completed` é o gatilho do faturamento, mas
 * Financial só existe em C9. Sem NENHUM handler, o worker marcaria o evento como
 * `skipped` (F-03) — legítimo, mas o teste 6.6.6 exige um handler executando o
 * round-trip pelo outbox. Este placeholder só emite uma métrica de completion.
 *
 * REMOVER ao implementar `@/contexts/financial/internal/handlers/appointment-completed`
 * (que criará o lançamento a receber). Enquanto existir, NÃO contém lógica
 * financeira — Scheduling não conhece faturamento (REGRA 5).
 */
import { metrics } from '@/lib/observability/metrics';
import { registerHandler } from '@/lib/outbox/registry';

import { SCHEDULING_EVENTS, type AppointmentCompletedPayload } from '../../events';

registerHandler<AppointmentCompletedPayload>(
  SCHEDULING_EVENTS.COMPLETED,
  async ({ clinicId, payload, eventId }) => {
    metrics.emit('scheduling.appointment.completed.handled_temp', {
      clinicId,
      eventId,
      appointmentId: payload.appointmentId,
      valor: payload.valor,
    });
  },
);
