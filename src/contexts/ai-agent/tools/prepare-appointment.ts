/**
 * Tool prepare_appointment (C12+) — booking CONSOLIDADO em UMA chamada.
 *
 * Motivação (teste ao vivo 2026-07-30): a marcação decomposta em 3 tools
 * (provide_procedure_price → list_slots → schedule_appointment) exigia o modelo
 * orquestrar múltiplas rodadas e ele não convergia (ficava em loop em list_slots).
 * Esta tool recebe entradas HUMANAS (nome do procedimento/especialidade + horário
 * desejado, ou nada = primeiro horário livre) e resolve procedimento, médico e
 * slot SERVER-SIDE, devolvendo o pending action num passo só. A confirmação
 * continua em duas etapas (confirm_pending_action no turno seguinte).
 *
 * Segurança: idêntica a schedule_appointment — paciente é SEMPRE ctx.patientId
 * (telefone verificado), políticas de identidade/maxDaysAhead/passado aplicadas.
 * NÃO cria a consulta: só prepara (mesma trilha de proposePendingAction).
 */
import { z } from 'zod';

/* eslint-disable boundaries/element-types -- schedulingApiV1 é a API interna pública (M14), mesma exceção das outras tools de agenda. */
import { schedulingApiV1 } from '@/contexts/scheduling';
/* eslint-enable boundaries/element-types */

import {
  assertAgentSchedulePolicy,
  assertAgentSchedulingIdentity,
  proposePendingAction,
} from '../internal/pending-action';
import { registerTool } from './registry';

const InputSchema = z.object({
  procedure_name: z
    .string()
    .max(200)
    .optional()
    .describe(
      'Nome ou especialidade do procedimento que o paciente quer. Omita se a clínica só tiver um procedimento.',
    ),
  scheduled_at: z
    .string()
    .datetime({ offset: true })
    .optional()
    .describe('Horário desejado (ISO 8601 com offset). Omita para pegar o primeiro horário livre.'),
});

const PreparedOutputSchema = z.object({
  status: z.literal('appointment_prepared'),
  pending_action_id: z.string().uuid(),
  action: z.literal('schedule_appointment'),
  summary: z.string(),
  expires_at: z.string().datetime(),
  requires_confirmation: z.literal(true),
});

const RegistrationRequiredOutputSchema = z.object({
  status: z.literal('patient_registration_required'),
  required_fields: z.tuple([z.literal('nome'), z.literal('cpf'), z.literal('motivo')]),
});

const AppointmentInformationRequiredOutputSchema = z.object({
  status: z.literal('appointment_information_required'),
  patient_message: z.string(),
});

const AppointmentUnavailableOutputSchema = z.object({
  status: z.literal('appointment_unavailable'),
  patient_message: z.string(),
});

const REGISTRATION_REQUIRED_FIELDS = ['nome', 'cpf', 'motivo'] satisfies ['nome', 'cpf', 'motivo'];

const OutputSchema = z.discriminatedUnion('status', [
  PreparedOutputSchema,
  RegistrationRequiredOutputSchema,
  AppointmentInformationRequiredOutputSchema,
  AppointmentUnavailableOutputSchema,
]);

/** Normaliza (minúsculas, sem acentos). */
function fold(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Tokens significativos (>= 4 chars) para matching tolerante. */
function procTokens(s: string): string[] {
  return fold(s)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4);
}

/**
 * Matching TOLERANTE de procedimento por nome/especialidade. Substring simples
 * falhava em casos reais (o paciente diz "cardiologia", o procedimento é
 * "Consulta Cardiológica"). Casa por token: inclusão em qualquer direção OU
 * prefixo de 5 chars compartilhado (cardiologia↔cardiológica, dermato↔dermatológica).
 */
function matchesProcedure(
  query: string,
  p: { descricao: string; categoria: string | null },
): boolean {
  const q = procTokens(query);
  const target = procTokens(`${p.descricao} ${p.categoria ?? ''}`);
  return q.some((qt) =>
    target.some((tt) => tt.includes(qt) || qt.includes(tt) || tt.slice(0, 5) === qt.slice(0, 5)),
  );
}

const HOUR_MS = 60 * 60 * 1000;

type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

function zonedParts(instant: Date, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const value = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((item) => item.type === type)?.value;
    if (!part) throw new Error(`could not resolve timezone ${timeZone}`);
    return Number(part);
  };
  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour: value('hour'),
    minute: value('minute'),
  };
}

function timeZoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = zonedParts(instant, timeZone);
  return (
    Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute) - instant.getTime()
  );
}

function wallClockInTimeZoneToInstant(args: ZonedParts, timeZone: string): Date {
  const wallClockUtc = Date.UTC(args.year, args.month - 1, args.day, args.hour, args.minute);
  let instant = new Date(wallClockUtc - timeZoneOffsetMs(new Date(wallClockUtc), timeZone));
  const adjustedOffset = timeZoneOffsetMs(instant, timeZone);
  if (wallClockUtc - adjustedOffset !== instant.getTime()) {
    instant = new Date(wallClockUtc - adjustedOffset);
  }
  return instant;
}

function tomorrowTimeFromMessage(
  currentMessage: string,
  timeZone: string,
  now: Date,
): string | null {
  const match = currentMessage.match(
    /amanh(?:\u00e3|a)\s*,?\s*(?:\u00e0s?|as|em)\s*(\d{1,2})(?:\s*:\s*(\d{2})|\s*h\s*(\d{1,2})?|\s+horas?(?:\s+e\s+(\d{1,2}))?)?/iu,
  );
  if (!match) return null;

  const hour = Number(match[1]);
  const minute = Number(match[2] ?? match[3] ?? match[4] ?? '0');
  if (hour > 23 || minute > 59) return null;

  const today = zonedParts(now, timeZone);
  const tomorrow = new Date(Date.UTC(today.year, today.month - 1, today.day + 1));
  return wallClockInTimeZoneToInstant(
    {
      year: tomorrow.getUTCFullYear(),
      month: tomorrow.getUTCMonth() + 1,
      day: tomorrow.getUTCDate(),
      hour,
      minute,
    },
    timeZone,
  ).toISOString();
}

function appointmentTimeForPatient(iso: string, timeZone: string): string {
  const parts = zonedParts(new Date(iso), timeZone);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${pad(parts.day)}/${pad(parts.month)}/${parts.year} às ${pad(parts.hour)}:${pad(parts.minute)}`;
}

/** Test-only: matcher puro exposto p/ cobertura (bug real cardiologia↔cardiológica). */
export const __testing__ = {
  matchesProcedure,
  tomorrowTimeFromMessage,
  appointmentTimeForPatient,
};

registerTool({
  name: 'prepare_appointment',
  effect: 'mutation',
  description:
    'Prepara uma marcação de atendimento novo de uma vez: resolve o serviço ou procedimento, profissional e horário. Passe procedure_name (omita se a clínica só tiver um) e scheduled_at (omita para o primeiro horário livre). Só PREPARA — o atendimento é criado depois com confirm_pending_action. Se retornar status="patient_registration_required", peça o nome completo para iniciar o cadastro; não encaminhe para humano nem tente agendar neste turno.',
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  handler: async (input, ctx) => {
    // Cadastro é pré-condição do agendamento. É um estado recuperável da conversa,
    // não uma falha operacional: o resultado orienta o modelo a iniciar a coleta
    // em vez de cair no fallback que promete atendimento humano.
    if (!ctx.patientId && !ctx.identityAmbiguous && !ctx.canScheduleAnonymous) {
      return {
        status: 'patient_registration_required' as const,
        required_fields: REGISTRATION_REQUIRED_FIELDS,
      };
    }

    assertAgentSchedulingIdentity({
      patientId: ctx.patientId,
      identityAmbiguous: ctx.identityAmbiguous,
      canScheduleAnonymous: ctx.canScheduleAnonymous,
    });

    // 1. Resolve o procedimento (server-side; nunca confia num id do LLM).
    const procedures = await schedulingApiV1.listProcedures(ctx.clinicId, { limit: 50 });
    if (procedures.length === 0) {
      return {
        status: 'appointment_information_required' as const,
        patient_message:
          'Não encontrei atendimentos disponíveis para agendamento. Por favor, informe qual serviço deseja marcar.',
      };
    }
    let procedure: (typeof procedures)[number] | undefined;
    const requestedProcedureName = input.procedure_name ?? ctx.pendingAppointmentProcedureName;
    if (requestedProcedureName) {
      const matches = procedures.filter((p) => matchesProcedure(requestedProcedureName, p));
      if (matches.length === 1) procedure = matches[0];
      else if (matches.length === 0) {
        // Sem match mas só há um procedimento → é ele (evita fricção boba).
        if (procedures.length === 1) procedure = procedures[0];
        else {
          return {
            status: 'appointment_information_required' as const,
            patient_message:
              'Não identifiquei o atendimento desejado. Informe o nome do serviço que quer agendar.',
          };
        }
      } else {
        return {
          status: 'appointment_information_required' as const,
          patient_message:
            'Encontrei mais de um atendimento parecido. Informe o nome completo do serviço que deseja agendar.',
        };
      }
    } else if (procedures.length === 1) {
      procedure = procedures[0];
    } else {
      return {
        status: 'appointment_information_required' as const,
        patient_message: 'Informe qual atendimento ou serviço você deseja agendar.',
      };
    }

    // 2. Resolve o horário + médico (server-side, a partir da disponibilidade real).
    const now = new Date();
    let scheduledAt: string;
    let doctorId: string;
    const scheduledAtFromMessage = tomorrowTimeFromMessage(
      ctx.currentMessage,
      ctx.clinicTimeZone,
      now,
    );
    const requestedScheduledAt = scheduledAtFromMessage ?? input.scheduled_at;
    if (requestedScheduledAt) {
      const at = new Date(requestedScheduledAt);
      if (at.getTime() < now.getTime()) {
        return {
          status: 'appointment_unavailable' as const,
          patient_message:
            'Esse horário já passou. Informe outra data e horário para o atendimento.',
        };
      }
      const latestAllowedAt = now.getTime() + ctx.maxDaysAhead * 86_400_000;
      if (at.getTime() > latestAllowedAt) {
        return {
          status: 'appointment_unavailable' as const,
          patient_message:
            'Essa data não está disponível para agendamento. Informe outra data e horário.',
        };
      }
      assertAgentSchedulePolicy({
        scheduledAt: requestedScheduledAt,
        now,
        maxDaysAhead: ctx.maxDaysAhead,
      });
      const slots = await schedulingApiV1.listSlots({
        clinicId: ctx.clinicId,
        from: new Date(at.getTime() - HOUR_MS),
        to: new Date(at.getTime() + HOUR_MS),
        procedureId: procedure!.id,
      });
      const match = slots.find(
        (s) => Math.abs(new Date(s.startAt).getTime() - at.getTime()) < 60_000,
      );
      if (!match) {
        return {
          status: 'appointment_unavailable' as const,
          patient_message:
            'Esse horário não está disponível para esse atendimento. Informe outra data ou horário.',
        };
      }
      scheduledAt = match.startAt;
      doctorId = match.doctorId;
    } else {
      const slots = await schedulingApiV1.listSlots({
        clinicId: ctx.clinicId,
        from: now,
        to: new Date(now.getTime() + ctx.maxDaysAhead * 86_400_000),
        procedureId: procedure!.id,
      });
      if (slots.length === 0) {
        return {
          status: 'appointment_unavailable' as const,
          patient_message:
            'Não há horários disponíveis para esse atendimento nesse período. Informe outra data ou horário.',
        };
      }
      scheduledAt = slots[0]!.startAt;
      doctorId = slots[0]!.doctorId;
    }

    // 3. Prepara (mesma trilha do schedule_appointment: pending action + confirmação).
    const pending = await proposePendingAction(ctx.tx, {
      clinicId: ctx.clinicId,
      conversationId: ctx.conversationId,
      eventId: ctx.eventId,
      payload: {
        type: 'schedule_appointment',
        patientId: ctx.patientId,
        doctorId,
        procedureId: procedure!.id,
        scheduledAt,
      },
      summary: `Agendar ${procedure!.descricao} para ${appointmentTimeForPatient(
        scheduledAt,
        ctx.clinicTimeZone,
      )}`,
    });
    return {
      status: 'appointment_prepared' as const,
      pending_action_id: pending.id,
      action: pending.action,
      summary: pending.summary,
      expires_at: pending.expiresAt,
      requires_confirmation: true as const,
    };
  },
});
