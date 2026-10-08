/**
 * Tool reschedule_appointment (C12) — reagenda (cancel + create ATÔMICO na mesma
 * TX, preço preservado — implementado no core, NÃO reimplementado aqui). Mesmo
 * guard de propriedade. Passado é barrado no core.
 */
import { z } from 'zod';

/* eslint-disable boundaries/element-types -- schedulingApiV1 é a API interna pública (M14). */
import { schedulingApiV1 } from '@/contexts/scheduling';
/* eslint-enable boundaries/element-types */

import { assertAgentSchedulePolicy, proposePendingAction } from '../internal/pending-action';
import { appointmentTimeForPatient } from '../internal/relative-datetime';
import { registerTool } from './registry';

const InputSchema = z.object({
  appointment_id: z.string().uuid().describe('UUID da consulta a reagendar'),
  new_scheduled_at: z
    .string()
    .datetime({ offset: true })
    .describe('Nova data/hora (ISO 8601 com offset)'),
});

const OutputSchema = z.object({
  pending_action_id: z.string().uuid(),
  action: z.literal('reschedule_appointment'),
  summary: z.string(),
  expires_at: z.string().datetime(),
  requires_confirmation: z.literal(true),
});

registerTool({
  name: 'reschedule_appointment',
  effect: 'mutation',
  description:
    'Prepara o reagendamento e devolve um resumo. A consulta só será alterada após uma nova confirmação explícita.',
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  handler: async (input, ctx) => {
    const appt = await schedulingApiV1.lookupAppointment(ctx.clinicId, input.appointment_id);
    if (!appt || !ctx.patientId || appt.patientId !== ctx.patientId) {
      throw new Error('consulta não pertence ao paciente verificado');
    }
    assertAgentSchedulePolicy({
      scheduledAt: input.new_scheduled_at,
      now: new Date(),
      maxDaysAhead: ctx.maxDaysAhead,
    });
    const pending = await proposePendingAction(ctx.tx, {
      clinicId: ctx.clinicId,
      conversationId: ctx.conversationId,
      eventId: ctx.eventId,
      payload: {
        type: 'reschedule_appointment',
        appointmentId: input.appointment_id,
        newScheduledAt: input.new_scheduled_at,
      },
      summary: `Reagendar consulta de ${appointmentTimeForPatient(
        appt.scheduledAt,
        ctx.clinicTimeZone,
      )} para ${appointmentTimeForPatient(input.new_scheduled_at, ctx.clinicTimeZone)}`,
    });
    return {
      pending_action_id: pending.id,
      action: pending.action,
      summary: pending.summary,
      expires_at: pending.expiresAt,
      requires_confirmation: true as const,
    };
  },
});
