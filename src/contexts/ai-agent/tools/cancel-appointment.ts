/**
 * Tool cancel_appointment (C12) — cancela consulta do paciente verificado.
 * Mesmo guard de propriedade do confirm. Motivo opcional. Audit obrigatório
 * (feito pelo core via idempotentMutation, actorType='ai_agent').
 */
import { z } from 'zod';

import { agentIdemKey } from '@/lib/agent/actor';
/* eslint-disable boundaries/element-types -- schedulingApiV1 é a API interna pública (M14). */
import { schedulingApiV1 } from '@/contexts/scheduling';
/* eslint-enable boundaries/element-types */

import { registerTool } from './registry';

const InputSchema = z.object({
  appointment_id: z.string().uuid().describe('UUID da consulta a cancelar'),
  reason: z.string().max(500).optional().describe('Motivo do cancelamento (opcional)'),
});

const OutputSchema = z.object({ appointment_id: z.string(), status: z.string() });

registerTool({
  name: 'cancel_appointment',
  description: 'Cancela uma consulta do paciente.',
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  handler: async (input, ctx) => {
    const appt = await schedulingApiV1.lookupAppointment(ctx.clinicId, input.appointment_id);
    if (!appt || !ctx.patientId || appt.patientId !== ctx.patientId) {
      throw new Error('consulta não pertence ao paciente verificado');
    }
    const idemKey = agentIdemKey(ctx.conversationId, 'cancel_appointment', input);
    const updated = await schedulingApiV1.cancelAsAgent(
      { clinicId: ctx.clinicId, eventId: ctx.eventId, aiRequestId: ctx.aiRequestId },
      input.appointment_id,
      idemKey,
      input.reason,
    );
    return { appointment_id: updated.id, status: updated.status };
  },
});
