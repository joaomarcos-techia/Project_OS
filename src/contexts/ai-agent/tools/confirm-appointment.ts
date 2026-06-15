/**
 * Tool confirm_appointment (C12) — confirma consulta do paciente verificado.
 * Guard de propriedade: RLS escopa por clínica, NÃO por paciente; então a tool
 * confere que o appointment pertence a ctx.patientId antes de mutar (impede o
 * LLM de confirmar consulta de terceiro). State machine barra transição inválida.
 */
import { z } from 'zod';

import { agentIdemKey } from '@/lib/agent/actor';
/* eslint-disable boundaries/element-types -- schedulingApiV1 é a API interna pública (M14). */
import { schedulingApiV1 } from '@/contexts/scheduling';
/* eslint-enable boundaries/element-types */

import { registerTool } from './registry';

const InputSchema = z.object({
  appointment_id: z.string().uuid().describe('UUID da consulta a confirmar'),
});

const OutputSchema = z.object({ appointment_id: z.string(), status: z.string() });

registerTool({
  name: 'confirm_appointment',
  description: 'Confirma uma consulta pendente do paciente.',
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  handler: async (input, ctx) => {
    const appt = await schedulingApiV1.lookupAppointment(ctx.clinicId, input.appointment_id);
    if (!appt || !ctx.patientId || appt.patientId !== ctx.patientId) {
      throw new Error('consulta não pertence ao paciente verificado');
    }
    const idemKey = agentIdemKey(ctx.conversationId, 'confirm_appointment', input);
    const updated = await schedulingApiV1.confirmAsAgent(
      { clinicId: ctx.clinicId, eventId: ctx.eventId, aiRequestId: ctx.aiRequestId },
      input.appointment_id,
      idemKey,
    );
    return { appointment_id: updated.id, status: updated.status };
  },
});
