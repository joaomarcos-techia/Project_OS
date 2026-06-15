/**
 * Tool reschedule_appointment (C12) — reagenda (cancel + create ATÔMICO na mesma
 * TX, preço preservado — implementado no core, NÃO reimplementado aqui). Mesmo
 * guard de propriedade. Passado é barrado no core.
 */
import { z } from 'zod';

import { agentIdemKey } from '@/lib/agent/actor';
/* eslint-disable boundaries/element-types -- schedulingApiV1 é a API interna pública (M14). */
import { schedulingApiV1 } from '@/contexts/scheduling';
/* eslint-enable boundaries/element-types */

import { registerTool } from './registry';

const InputSchema = z.object({
  appointment_id: z.string().uuid().describe('UUID da consulta a reagendar'),
  new_scheduled_at: z
    .string()
    .datetime({ offset: true })
    .describe('Nova data/hora (ISO 8601 com offset)'),
});

const OutputSchema = z.object({
  appointment_id: z.string(),
  status: z.string(),
  scheduled_at: z.string(),
});

registerTool({
  name: 'reschedule_appointment',
  description: 'Reagenda uma consulta do paciente para um novo horário (confirme antes).',
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  handler: async (input, ctx) => {
    const appt = await schedulingApiV1.lookupAppointment(ctx.clinicId, input.appointment_id);
    if (!appt || !ctx.patientId || appt.patientId !== ctx.patientId) {
      throw new Error('consulta não pertence ao paciente verificado');
    }
    const idemKey = agentIdemKey(ctx.conversationId, 'reschedule_appointment', input);
    const created = await schedulingApiV1.rescheduleAsAgent(
      { clinicId: ctx.clinicId, eventId: ctx.eventId, aiRequestId: ctx.aiRequestId },
      input.appointment_id,
      { newScheduledAt: input.new_scheduled_at },
      idemKey,
    );
    return { appointment_id: created.id, status: created.status, scheduled_at: created.scheduledAt };
  },
});
