/**
 * Tool reschedule_appointment (C12) — reagenda (cancel + create ATÔMICO na mesma
 * TX, preço preservado — implementado no core, NÃO reimplementado aqui). Mesmo
 * guard de propriedade. Passado é barrado no core.
 *
 * 08/10/2026 — o novo horário passa pela MESMA resolução do prepare_appointment:
 * o servidor interpreta a frase do paciente no fuso da clínica e confere o
 * instante contra a disponibilidade real do MESMO profissional e procedimento.
 * Antes, o instante vinha só do modelo e o core confere apenas conflito e
 * passado: a IA podia mover uma consulta para fora do expediente, e um horário
 * ocupado só falhava depois do "SIM", virando "um atendente vai te responder".
 */
import { z } from 'zod';

/* eslint-disable boundaries/element-types -- schedulingApiV1 é a API interna pública (M14). */
import { schedulingApiV1 } from '@/contexts/scheduling';
/* eslint-enable boundaries/element-types */

import { assertAgentSchedulePolicy, proposePendingAction } from '../internal/pending-action';
import {
  appointmentTimeForPatient,
  reconcileRequestedTime,
  resolveRequestedDateTime,
} from '../internal/relative-datetime';
import { agentSlotFloor } from './list-slots';
import { registerTool } from './registry';

const InputSchema = z.object({
  appointment_id: z.string().uuid().describe('UUID da consulta a reagendar'),
  new_scheduled_at: z
    .string()
    .datetime({ offset: true })
    .describe('Nova data/hora (ISO 8601 com offset)'),
});

const OutputSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('appointment_prepared'),
    pending_action_id: z.string().uuid(),
    action: z.literal('reschedule_appointment'),
    summary: z.string(),
    expires_at: z.string().datetime(),
    requires_confirmation: z.literal(true),
  }),
  z.object({
    status: z.enum(['appointment_unavailable', 'appointment_information_required']),
    patient_message: z.string(),
  }),
]);

const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

/**
 * O destino de "remarcar de sexta às 10h para sábado às 17h30" é a oração depois
 * do ÚLTIMO "para"/"pra". O resolvedor lê a frase inteira e, com duas datas e
 * duas horas, montava um instante híbrido (data da origem + hora do destino).
 */
function rescheduleTargetClause(text: string): string | null {
  const matches = [...text.matchAll(/\b(?:para|pra)\b/gi)];
  const last = matches.at(-1);
  if (!last || last.index === undefined) return null;
  const tail = text.slice(last.index + last[0].length).trim();
  return tail.length > 0 ? tail : null;
}

const unavailable = {
  status: 'appointment_unavailable' as const,
  patient_message:
    'Esse horário não está disponível para essa consulta. Informe outra data ou horário.',
};

registerTool({
  name: 'reschedule_appointment',
  effect: 'mutation',
  description:
    'Prepara o reagendamento e devolve um resumo. A consulta só será alterada após uma nova confirmação explícita. O servidor confere o novo horário na agenda do mesmo profissional.',
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  handler: async (input, ctx) => {
    const appt = await schedulingApiV1.lookupAppointment(ctx.clinicId, input.appointment_id);
    if (!appt || !ctx.patientId || appt.patientId !== ctx.patientId) {
      throw new Error('consulta não pertence ao paciente verificado');
    }

    const now = new Date();
    const resolve = (text: string) =>
      resolveRequestedDateTime({
        text,
        now,
        timeZone: ctx.clinicTimeZone,
        maxDaysAhead: ctx.maxDaysAhead,
      });
    const target = rescheduleTargetClause(ctx.currentMessage);
    const targetResolved = target ? resolve(target) : null;
    const reconciled = reconcileRequestedTime({
      resolved:
        targetResolved && targetResolved.kind !== 'none'
          ? targetResolved
          : resolve(ctx.currentMessage),
      modelIso: input.new_scheduled_at,
    });
    // "Remarcar de segunda às 10h para segunda às 11h": a frase traz os DOIS
    // horários e o resolvedor lê o primeiro — o de origem (visto ao vivo em
    // 08/10/2026: "horário indisponível", porque a origem está ocupada pela
    // própria consulta). O destino de um reagendamento nunca é a origem: nesse
    // caso vale o destino proposto pelo modelo, conferido na agenda igual.
    const origin = new Date(appt.scheduledAt).getTime();
    const isOrigin = (iso: string) => Math.abs(new Date(iso).getTime() - origin) < MINUTE_MS;
    const readTheOrigin =
      (reconciled.mode === 'instant' && isOrigin(reconciled.atIso)) ||
      (reconciled.mode === 'candidates' && reconciled.candidatesIso.some(isOrigin));
    const modelAt = new Date(input.new_scheduled_at);
    const requested: typeof reconciled = !readTheOrigin
      ? reconciled
      : !Number.isNaN(modelAt.getTime()) && !isOrigin(input.new_scheduled_at)
        ? { mode: 'instant', atIso: modelAt.toISOString() }
        : { mode: 'none' };
    if (requested.mode === 'none') {
      return {
        status: 'appointment_information_required' as const,
        patient_message: 'Informe a nova data e o horário que prefere para a consulta.',
      };
    }

    // Disponibilidade REAL do mesmo profissional e procedimento (o core mantém
    // os dois no reagendamento). Slots já começados ficam fora pelo piso.
    const window =
      requested.mode === 'search'
        ? { from: new Date(requested.fromIso), to: new Date(requested.toIso) }
        : (() => {
            const instants = (
              requested.mode === 'instant' ? [requested.atIso] : requested.candidatesIso
            ).map((iso) => new Date(iso).getTime());
            return {
              from: new Date(Math.min(...instants) - HOUR_MS),
              to: new Date(Math.max(...instants) + HOUR_MS),
            };
          })();
    const slots = (
      await schedulingApiV1.listSlots({
        clinicId: ctx.clinicId,
        from: window.from,
        to: window.to,
        notBefore: agentSlotFloor(now),
        procedureId: appt.procedureId,
        doctorId: appt.doctorId,
      })
    ).filter((slot) => slot.doctorId === appt.doctorId);
    const slotAt = (iso: string) =>
      slots.find(
        (slot) => Math.abs(new Date(slot.startAt).getTime() - new Date(iso).getTime()) < MINUTE_MS,
      );

    let newScheduledAt: string;
    if (requested.mode === 'search') {
      if (!slots[0]) return unavailable;
      newScheduledAt = slots[0].startAt;
    } else if (requested.mode === 'candidates') {
      const viable = requested.candidatesIso.filter((iso) => slotAt(iso));
      if (viable.length === 0) return unavailable;
      if (viable.length > 1) {
        return {
          status: 'appointment_information_required' as const,
          patient_message: `Só para confirmar: você prefere ${viable
            .map((iso) => appointmentTimeForPatient(iso, ctx.clinicTimeZone))
            .join(' ou ')}?`,
        };
      }
      newScheduledAt = slotAt(viable[0]!)!.startAt;
    } else {
      const slot = slotAt(requested.atIso);
      if (!slot) return unavailable;
      newScheduledAt = slot.startAt;
    }

    assertAgentSchedulePolicy({
      scheduledAt: newScheduledAt,
      now,
      maxDaysAhead: ctx.maxDaysAhead,
    });
    const pending = await proposePendingAction(ctx.tx, {
      clinicId: ctx.clinicId,
      conversationId: ctx.conversationId,
      eventId: ctx.eventId,
      payload: {
        type: 'reschedule_appointment',
        appointmentId: input.appointment_id,
        newScheduledAt,
      },
      summary: `Reagendar consulta de ${appointmentTimeForPatient(
        appt.scheduledAt,
        ctx.clinicTimeZone,
      )} para ${appointmentTimeForPatient(newScheduledAt, ctx.clinicTimeZone)}`,
    });
    return {
      status: 'appointment_prepared' as const,
      pending_action_id: pending.id,
      action: 'reschedule_appointment' as const,
      summary: pending.summary,
      expires_at: pending.expiresAt,
      requires_confirmation: true as const,
    };
  },
});
