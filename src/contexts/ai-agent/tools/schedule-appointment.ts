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

import {
  assertAgentSchedulePolicy,
  assertAgentSchedulingIdentity,
  proposePendingAction,
} from '../internal/pending-action';
import { registerTool } from './registry';

const InputSchema = z.object({
  doctor_id: z.string().uuid().describe('UUID do médico'),
  procedure_id: z.string().uuid().describe('UUID do procedimento'),
  scheduled_at: z.string().datetime({ offset: true }).describe('Data/hora (ISO 8601 com offset)'),
});

const OutputSchema = z.object({
  pending_action_id: z.string().uuid(),
  action: z.literal('schedule_appointment'),
  summary: z.string(),
  expires_at: z.string().datetime(),
  requires_confirmation: z.literal(true),
});

registerTool({
  name: 'schedule_appointment',
  effect: 'mutation',
  description:
    'Prepara um agendamento e devolve o resumo que deve ser confirmado em uma nova mensagem. Não cria a consulta imediatamente.',
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  handler: async (input, ctx) => {
    assertAgentSchedulingIdentity({
      patientId: ctx.patientId,
      identityAmbiguous: ctx.identityAmbiguous,
      canScheduleAnonymous: ctx.canScheduleAnonymous,
    });
    assertAgentSchedulePolicy({
      scheduledAt: input.scheduled_at,
      now: new Date(),
      maxDaysAhead: ctx.maxDaysAhead,
    });
    const pending = await proposePendingAction(ctx.tx, {
      clinicId: ctx.clinicId,
      conversationId: ctx.conversationId,
      eventId: ctx.eventId,
      payload: {
        type: 'schedule_appointment',
        patientId: ctx.patientId,
        doctorId: input.doctor_id,
        procedureId: input.procedure_id,
        scheduledAt: input.scheduled_at,
      },
      summary: `Agendar consulta para ${input.scheduled_at}`,
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
