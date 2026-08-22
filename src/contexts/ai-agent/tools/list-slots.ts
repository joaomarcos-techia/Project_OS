/**
 * Tool list_slots (C12) — horários livres numa janela. Thin wrapper de
 * schedulingApiV1.listSlots. Nunca devolve slot ocupado nem de outra clínica
 * (query de disponibilidade + RLS por clinicId).
 *
 * F-03 (auditoria 2026-08-14): "nem no passado" NÃO era verdade e agora é. A
 * janela normalizada aqui só move a fronteira `from`, e `from` é reduzido a uma
 * DATA lá dentro — às 15:00 a tool devolvia os blocos das 08:00. O piso por
 * INSTANTE é `notBefore`, aplicado pelo Scheduling.
 * Input string-only (R4): UUIDs e datas são z.string() refinadas.
 */
import { z } from 'zod';

/* eslint-disable boundaries/element-types -- schedulingApiV1 é a API interna pública (M14), mesma exceção de provide-procedure-price. */
import { schedulingApiV1 } from '@/contexts/scheduling';
/* eslint-enable boundaries/element-types */

import { AGENT_MIN_LEAD_MINUTES } from '../limits';
import { registerTool } from './registry';

/** Piso de disponibilidade do agente: agora + antecedência mínima. */
export function agentSlotFloor(now = new Date()): Date {
  return new Date(now.getTime() + AGENT_MIN_LEAD_MINUTES * 60_000);
}

const InputSchema = z.object({
  date_from: z
    .string()
    .datetime({ offset: true })
    .describe('Início da janela (ISO 8601 com offset)'),
  date_to: z.string().datetime({ offset: true }).describe('Fim da janela (ISO 8601 com offset)'),
  doctor_id: z.string().uuid().optional().describe('Filtra por médico (UUID, opcional)'),
  procedure_id: z.string().uuid().optional().describe('Filtra por procedimento (UUID, opcional)'),
});

const OutputSchema = z.object({
  time_zone: z.string().describe('Fuso IANA da clínica aplicado aos horários retornados'),
  slots: z.array(
    z.object({
      doctor_id: z.string(),
      start_at: z.string().describe('Início no horário local da clínica, com offset UTC'),
      end_at: z.string().describe('Fim no horário local da clínica, com offset UTC'),
      duration_min: z.number(),
    }),
  ),
});

/**
 * Mantém o instante, mas o apresenta no relógio da clínica.
 *
 * `schedulingApiV1.listSlots` devolve ISO em UTC (`...Z`). Entregar esse valor
 * cru ao modelo fez 08:00 de São Paulo (`11:00Z`) ser anunciado como 11:00 e,
 * no incidente de 2026-08-19, um `14:00Z` parecer o slot local de 14:00 que já
 * estava ocupado. O offset explícito elimina a conversão implícita pelo LLM.
 */
export function slotInstantInTimeZone(iso: string, timeZone: string): string {
  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) throw new Error('invalid slot instant');

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'longOffset',
  }).formatToParts(instant);
  const value = (type: Intl.DateTimeFormatPartTypes): string => {
    const part = parts.find((item) => item.type === type)?.value;
    if (!part) throw new Error(`could not format slot in timezone ${timeZone}`);
    return part;
  };
  const zoneName = value('timeZoneName');
  const offset = zoneName === 'GMT' ? '+00:00' : /^GMT([+-]\d{2}:\d{2})$/u.exec(zoneName)?.[1];
  if (!offset) throw new Error(`could not resolve offset for timezone ${timeZone}`);

  return `${value('year')}-${value('month')}-${value('day')}T${value('hour')}:${value(
    'minute',
  )}:${value('second')}${offset}`;
}

/**
 * A janela é controlada pelo modelo, portanto não pode expor disponibilidade
 * histórica. Datas relativas erradas devem resultar em nenhuma opção, nunca em
 * um horário passado que o modelo possa apresentar ao paciente.
 */
export function normalizeSlotWindow(
  from: Date,
  to: Date,
  now = new Date(),
): { from: Date; to: Date } | null {
  if (to.getTime() <= from.getTime() || to.getTime() <= now.getTime()) return null;
  return {
    from: new Date(Math.max(from.getTime(), now.getTime())),
    to,
  };
}

registerTool({
  name: 'list_slots',
  description:
    'Lista horários DISPONÍVEIS para agendamento numa janela de datas. Use antes de agendar.',
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  handler: async (input, ctx) => {
    const window = normalizeSlotWindow(new Date(input.date_from), new Date(input.date_to));
    if (!window) return { time_zone: ctx.clinicTimeZone, slots: [] };
    const slots = await schedulingApiV1.listSlots({
      clinicId: ctx.clinicId,
      from: window.from,
      to: window.to,
      notBefore: agentSlotFloor(),
      ...(input.doctor_id ? { doctorId: input.doctor_id } : {}),
      ...(input.procedure_id ? { procedureId: input.procedure_id } : {}),
    });
    return {
      time_zone: ctx.clinicTimeZone,
      slots: slots.slice(0, 20).map((s) => ({
        doctor_id: s.doctorId,
        start_at: slotInstantInTimeZone(s.startAt, ctx.clinicTimeZone),
        end_at: slotInstantInTimeZone(s.endAt, ctx.clinicTimeZone),
        duration_min: s.durationMin,
      })),
    };
  },
});
