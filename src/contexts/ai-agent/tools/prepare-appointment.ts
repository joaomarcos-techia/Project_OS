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

const OutputSchema = z.object({
  pending_action_id: z.string().uuid(),
  action: z.literal('schedule_appointment'),
  summary: z.string(),
  expires_at: z.string().datetime(),
  requires_confirmation: z.literal(true),
});

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

/** Test-only: matcher puro exposto p/ cobertura (bug real cardiologia↔cardiológica). */
export const __testing__ = { matchesProcedure };

registerTool({
  name: 'prepare_appointment',
  effect: 'mutation',
  description:
    'Prepara uma marcação de consulta nova de uma vez: resolve procedimento (por nome/especialidade), médico e horário. Passe procedure_name (omita se a clínica só tiver um) e scheduled_at (omita para o primeiro horário livre). Só PREPARA — a consulta é criada depois com confirm_pending_action.',
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  handler: async (input, ctx) => {
    assertAgentSchedulingIdentity({
      patientId: ctx.patientId,
      identityAmbiguous: ctx.identityAmbiguous,
      canScheduleAnonymous: ctx.canScheduleAnonymous,
    });

    // 1. Resolve o procedimento (server-side; nunca confia num id do LLM).
    const procedures = await schedulingApiV1.listProcedures(ctx.clinicId, { limit: 50 });
    if (procedures.length === 0) throw new Error('a clínica não tem procedimentos cadastrados');
    let procedure: (typeof procedures)[number] | undefined;
    if (input.procedure_name) {
      const matches = procedures.filter((p) => matchesProcedure(input.procedure_name!, p));
      if (matches.length === 1) procedure = matches[0];
      else if (matches.length === 0) {
        // Sem match mas só há um procedimento → é ele (evita fricção boba).
        if (procedures.length === 1) procedure = procedures[0];
        else throw new Error(`não encontrei um procedimento para "${input.procedure_name}"`);
      } else {
        throw new Error(
          `há mais de um procedimento parecido com "${input.procedure_name}"; peça ao paciente para especificar`,
        );
      }
    } else if (procedures.length === 1) {
      procedure = procedures[0];
    } else {
      throw new Error('a clínica tem vários procedimentos; pergunte ao paciente qual ele deseja');
    }

    // 2. Resolve o horário + médico (server-side, a partir da disponibilidade real).
    const now = new Date();
    let scheduledAt: string;
    let doctorId: string;
    if (input.scheduled_at) {
      const at = new Date(input.scheduled_at);
      if (at.getTime() < now.getTime()) throw new Error('não é possível agendar no passado');
      assertAgentSchedulePolicy({
        scheduledAt: input.scheduled_at,
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
      if (!match)
        throw new Error('esse horário não está livre; ofereça outras opções com list_slots');
      scheduledAt = match.startAt;
      doctorId = match.doctorId;
    } else {
      const slots = await schedulingApiV1.listSlots({
        clinicId: ctx.clinicId,
        from: now,
        to: new Date(now.getTime() + ctx.maxDaysAhead * 86_400_000),
        procedureId: procedure!.id,
      });
      if (slots.length === 0)
        throw new Error(
          'não há horários livres na janela; peça ao paciente para sugerir outra data',
        );
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
      summary: `Agendar ${procedure!.descricao} para ${scheduledAt}`,
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
