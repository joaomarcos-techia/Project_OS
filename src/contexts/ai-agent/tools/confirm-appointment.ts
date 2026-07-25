/**
 * Confirma presença somente para o paciente identificado. Uma única consulta
 * futura pode ser confirmada diretamente com "SIM"; múltiplas exigem seleção
 * e uma confirmação posterior vinculada a uma pending action.
 */
import { z } from 'zod';

import { agentIdemKey } from '@/lib/agent/actor';
/* eslint-disable boundaries/element-types -- schedulingApiV1 é a API pública entre contextos. */
import { schedulingApiV1 } from '@/contexts/scheduling';
/* eslint-enable boundaries/element-types */

import { selectAppointmentForConfirmation } from '../internal/appointment-selection';
import { isExplicitConfirmation, proposePendingAction } from '../internal/pending-action';
import { registerTool } from './registry';

const InputSchema = z.object({
  appointment_id: z.string().uuid().optional().describe('UUID da consulta, quando conhecido'),
  scheduled_at: z
    .string()
    .datetime({ offset: true })
    .optional()
    .describe('Data/hora escolhida quando o paciente tem mais de uma consulta'),
});

const AppointmentOptionSchema = z.object({
  appointment_id: z.string().uuid(),
  scheduled_at: z.string(),
  status: z.string(),
  doctor_name: z.string(),
  procedure_name: z.string(),
});

const OutputSchema = z.object({
  confirmed: z.boolean(),
  requires_selection: z.boolean(),
  requires_confirmation: z.boolean(),
  appointment_id: z.string().uuid().nullable(),
  pending_action_id: z.string().uuid().nullable(),
  status: z.string().nullable(),
  summary: z.string().nullable(),
  appointments: z.array(AppointmentOptionSchema),
});

function toOption(appointment: Awaited<ReturnType<typeof schedulingApiV1.listPatientAppointments>>[number]) {
  return {
    appointment_id: appointment.id,
    scheduled_at: appointment.scheduledAt,
    status: appointment.status,
    doctor_name: appointment.snapshotDoctorNome,
    procedure_name: appointment.snapshotProcedureName,
  };
}

registerTool({
  name: 'confirm_appointment',
  effect: 'mutation',
  description:
    'Confirma presença. Sem id/data, confirma apenas se houver uma única consulta futura; com várias, devolve opções para seleção segura.',
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  handler: async (input, ctx) => {
    if (!ctx.patientId || ctx.identityAmbiguous) {
      throw new Error('paciente não identificado de forma inequívoca');
    }
    const appointments = await schedulingApiV1.listPatientAppointments(
      ctx.clinicId,
      ctx.patientId,
      10,
    );
    const selected = selectAppointmentForConfirmation(appointments, {
      ...(input.appointment_id !== undefined ? { appointmentId: input.appointment_id } : {}),
      ...(input.scheduled_at !== undefined ? { scheduledAt: input.scheduled_at } : {}),
    });

    if (!selected) {
      if (input.appointment_id || input.scheduled_at) {
        throw new Error('consulta selecionada não encontrada entre as consultas do paciente');
      }
      return {
        confirmed: false,
        requires_selection: appointments.length > 1,
        requires_confirmation: false,
        appointment_id: null,
        pending_action_id: null,
        status: null,
        summary: null,
        appointments: appointments.map(toOption),
      };
    }

    if (selected.status === 'confirmado') {
      return {
        confirmed: true,
        requires_selection: false,
        requires_confirmation: false,
        appointment_id: selected.id,
        pending_action_id: null,
        status: selected.status,
        summary: null,
        appointments: [],
      };
    }

    if (!isExplicitConfirmation(ctx.currentMessage)) {
      const summary = `Confirmar presença na consulta de ${selected.scheduledAt}`;
      const pending = await proposePendingAction(ctx.tx, {
        clinicId: ctx.clinicId,
        conversationId: ctx.conversationId,
        eventId: ctx.eventId,
        payload: { type: 'confirm_appointment', appointmentId: selected.id },
        summary,
      });
      return {
        confirmed: false,
        requires_selection: false,
        requires_confirmation: true,
        appointment_id: selected.id,
        pending_action_id: pending.id,
        status: selected.status,
        summary,
        appointments: [],
      };
    }

    const updated = await schedulingApiV1.confirmAsAgent(
      { clinicId: ctx.clinicId, eventId: ctx.eventId, aiRequestId: ctx.aiRequestId },
      selected.id,
      agentIdemKey(ctx.conversationId, 'confirm_appointment', { appointmentId: selected.id }),
    );
    return {
      confirmed: true,
      requires_selection: false,
      requires_confirmation: false,
      appointment_id: updated.id,
      pending_action_id: null,
      status: updated.status,
      summary: null,
      appointments: [],
    };
  },
});
