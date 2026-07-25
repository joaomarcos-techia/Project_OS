/**
 * Tool cancel_appointment (C12) — cancela consulta do paciente verificado.
 * Mesmo guard de propriedade do confirm. Motivo opcional. Audit obrigatório
 * (feito pelo core via idempotentMutation, actorType='ai_agent').
 */
import { z } from 'zod';

/* eslint-disable boundaries/element-types -- schedulingApiV1 é a API interna pública (M14). */
import { schedulingApiV1 } from '@/contexts/scheduling';
/* eslint-enable boundaries/element-types */

import { proposePendingAction } from '../internal/pending-action';
import { registerTool } from './registry';

const InputSchema = z.object({
  appointment_id: z.string().uuid().describe('UUID da consulta a cancelar'),
  reason: z.string().max(500).optional().describe('Motivo do cancelamento (opcional)'),
});

const OutputSchema = z.object({
  pending_action_id: z.string().uuid(),
  action: z.literal('cancel_appointment'),
  summary: z.string(),
  expires_at: z.string().datetime(),
  requires_confirmation: z.literal(true),
});

registerTool({
  name: 'cancel_appointment',
  effect: 'mutation',
  description:
    'Prepara o cancelamento e devolve um resumo. A consulta só será cancelada após uma nova confirmação explícita.',
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  handler: async (input, ctx) => {
    const appt = await schedulingApiV1.lookupAppointment(ctx.clinicId, input.appointment_id);
    if (!appt || !ctx.patientId || appt.patientId !== ctx.patientId) {
      throw new Error('consulta não pertence ao paciente verificado');
    }
    const pending = await proposePendingAction(ctx.tx, {
      clinicId: ctx.clinicId,
      conversationId: ctx.conversationId,
      eventId: ctx.eventId,
      payload: {
        type: 'cancel_appointment',
        appointmentId: input.appointment_id,
        ...(input.reason !== undefined ? { reason: input.reason } : {}),
      },
      summary: `Cancelar consulta de ${appt.scheduledAt}`,
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
