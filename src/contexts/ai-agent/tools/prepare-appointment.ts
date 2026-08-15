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
import { reconcileRequestedTime, resolveRequestedDateTime, zonedParts } from '../internal/relative-datetime';
import { agentSlotFloor } from './list-slots';
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

/**
 * F-04 (auditoria 2026-08-14): a resolução de data/hora saiu daqui para
 * `internal/relative-datetime.ts`. O que existia era um regex de "amanhã às N"
 * que vencia o modelo até quando a frase o negava, e que lia "depois de amanhã"
 * como "amanhã". Os primitivos de fuso moraram aqui; hoje vivem lá, com testes.
 */
function appointmentTimeForPatient(iso: string, timeZone: string): string {
  const parts = zonedParts(new Date(iso), timeZone);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${pad(parts.day)}/${pad(parts.month)}/${parts.year} às ${pad(parts.hour)}:${pad(parts.minute)}`;
}

/** Test-only: matcher puro exposto p/ cobertura (bug real cardiologia↔cardiológica). */
export const __testing__ = {
  matchesProcedure,
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
    // F-04: quem traduz "sexta de manhã" em instante é o SERVIDOR, ancorado no
    // fuso e no relógio da clínica. O modelo só decide quando o texto não traz
    // marcador de data; e quando o servidor só tem uma janela, um instante do
    // modelo DENTRO dela é aceito.
    const requested = reconcileRequestedTime({
      resolved: resolveRequestedDateTime({
        text: ctx.currentMessage,
        now,
        timeZone: ctx.clinicTimeZone,
        maxDaysAhead: ctx.maxDaysAhead,
      }),
      modelIso: input.scheduled_at,
    });

    // Hora nua sem marcador AM/PM ("às 3" = 03:00 ou 15:00). Quem desempata é a
    // AGENDA CONFIGURADA PELA CLÍNICA, não uma faixa de horário chutada aqui:
    // numa clínica 08–18 o candidato da madrugada não tem slot e morre sozinho;
    // numa que atende à noite, 21:00 é legítimo. Só pergunta quando os DOIS
    // horários existem de verdade — aí a dúvida é real.
    if (requested.mode === 'candidates') {
      const instants = requested.candidatesIso
        .map((iso) => new Date(iso))
        .sort((a, b) => a.getTime() - b.getTime());
      // Uma única consulta cobre os dois candidatos (12h de distância).
      const slots = await schedulingApiV1.listSlots({
        clinicId: ctx.clinicId,
        from: new Date(instants[0]!.getTime() - HOUR_MS),
        to: new Date(instants[instants.length - 1]!.getTime() + HOUR_MS),
        notBefore: agentSlotFloor(now),
        procedureId: procedure!.id,
      });
      const viable = requested.candidatesIso
        .map((iso) => ({
          iso,
          slot: slots.find(
            (s) => Math.abs(new Date(s.startAt).getTime() - new Date(iso).getTime()) < 60_000,
          ),
        }))
        .filter((c) => c.slot);

      if (viable.length === 0) {
        return {
          status: 'appointment_unavailable' as const,
          patient_message:
            'Esse horário não está disponível para esse atendimento. Informe outra data ou horário.',
        };
      }
      if (viable.length > 1) {
        const opcoes = viable
          .map((c) => appointmentTimeForPatient(c.iso, ctx.clinicTimeZone))
          .join(' ou ');
        return {
          status: 'appointment_information_required' as const,
          patient_message: `Só para confirmar: você prefere ${opcoes}?`,
        };
      }
      scheduledAt = viable[0]!.slot!.startAt;
      doctorId = viable[0]!.slot!.doctorId;
    } else if (requested.mode === 'search') {
      const slots = await schedulingApiV1.listSlots({
        clinicId: ctx.clinicId,
        from: new Date(requested.fromIso),
        to: new Date(requested.toIso),
        notBefore: agentSlotFloor(now),
        procedureId: procedure!.id,
      });
      if (slots.length === 0) {
        return {
          status: 'appointment_unavailable' as const,
          patient_message:
            'Não há horários livres nesse período para esse atendimento. Informe outra data ou horário.',
        };
      }
      scheduledAt = slots[0]!.startAt;
      doctorId = slots[0]!.doctorId;
    } else if (requested.mode === 'instant') {
      const requestedScheduledAt = requested.atIso;
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
        notBefore: agentSlotFloor(now),
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
        // F-03: sem isto, `slots[0]` no caminho "primeiro horário livre" era o
        // primeiro bloco do DIA (08:00), já vencido às 15:00 — a marcação era
        // preparada no passado e só falhava na confirmação.
        notBefore: agentSlotFloor(now),
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
