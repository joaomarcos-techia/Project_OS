/**
 * Tool schedule_appointment (C12) — cria consulta para o paciente VERIFICADO.
 *
 * Segurança: o paciente é SEMPRE ctx.patientId (casado pelo telefone Meta),
 * NUNCA um patient_id vindo do LLM (anti-spoofing — matriz de identidade). Se
 * não há paciente identificado, lança (a saga coleta/cria antes de agendar).
 * Idempotência por CONTEÚDO (R1): conversa + intent + args → mesma chave mesmo
 * com reentrega/retry. Conflito de horário/passado é barrado no core e vira erro
 * que o LLM repassa ao paciente.
 */
import { z } from 'zod';

import { agentIdemKey } from '@/lib/agent/actor';
/* eslint-disable boundaries/element-types -- schedulingApiV1 é a API interna pública (M14). */
import { schedulingApiV1 } from '@/contexts/scheduling';
/* eslint-enable boundaries/element-types */

import { registerTool } from './registry';

const InputSchema = z.object({
  doctor_id: z.string().uuid().describe('UUID do médico'),
  procedure_id: z.string().uuid().describe('UUID do procedimento'),
  scheduled_at: z.string().datetime({ offset: true }).describe('Data/hora (ISO 8601 com offset)'),
});

const OutputSchema = z.object({
  appointment_id: z.string(),
  status: z.string(),
  scheduled_at: z.string(),
});

registerTool({
  name: 'schedule_appointment',
  description:
    'Agenda uma consulta para o paciente já identificado. Confirme o horário com o paciente ANTES de chamar.',
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  handler: async (input, ctx) => {
    if (!ctx.patientId) {
      throw new Error('paciente não identificado: cadastre/identifique antes de agendar');
    }
    const idemKey = agentIdemKey(ctx.conversationId, 'schedule_appointment', input);
    const appt = await schedulingApiV1.scheduleAsAgent(
      { clinicId: ctx.clinicId, eventId: ctx.eventId, aiRequestId: ctx.aiRequestId },
      {
        doctorId: input.doctor_id,
        procedureId: input.procedure_id,
        patientId: ctx.patientId,
        scheduledAt: input.scheduled_at,
      },
      idemKey,
    );
    return { appointment_id: appt.id, status: appt.status, scheduled_at: appt.scheduledAt };
  },
});
