/**
 * Composição do único consumidor de `scheduling.appointment.no_show`.
 *
 * O registry do outbox é deliberadamente 1:1. A fase C14 é persistida primeiro
 * numa transação tenant-scoped curta; depois a fase Payments pode falar com o
 * Asaas sem segurar a conexão. Se a fase externa falhar, o retry reencontra o
 * mesmo job pelo dedup e repete apenas a operação financeira idempotente.
 */
import { withTenant } from '@/lib/db/tenant';
import { registerDetachedHandler } from '@/lib/outbox/registry';

import { SCHEDULING_EVENTS, type AppointmentNoShowPayload } from '@/contexts/scheduling';
import { scheduleNoShowFollowup } from '@/contexts/ai-agent/proactive-jobs/internal/handlers/appointment-no-show';
import { handleAppointmentNoShowPayment } from '@/contexts/payments/internal/handlers/appointment-no-show';

// @event-consumer SCHEDULING_EVENTS.NO_SHOW ai-agent
// @event-consumer SCHEDULING_EVENTS.NO_SHOW payments
registerDetachedHandler<AppointmentNoShowPayload>(SCHEDULING_EVENTS.NO_SHOW, async (ctx) => {
  await withTenant(ctx.clinicId, async (tx) => {
    await scheduleNoShowFollowup({ ...ctx, tx });
  });
  await handleAppointmentNoShowPayment(ctx);
});
