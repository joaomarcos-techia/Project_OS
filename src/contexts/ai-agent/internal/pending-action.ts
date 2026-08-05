import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import { agentIdemKey } from '@/lib/agent/actor';
import { decryptForTenant, encryptForTenant } from '@/lib/crypto';
import type { Tx } from '@/lib/db';
/* eslint-disable boundaries/element-types -- schedulingApiV1 é a API pública entre contextos. */
import { schedulingApiV1 } from '@/contexts/scheduling';
/* eslint-enable boundaries/element-types */

import { aiPendingActions } from '../schema';
import type { ToolContext } from '../tools/registry';

export const PENDING_ACTION_TTL_MS = 10 * 60 * 1_000;

const PendingActionPayloadSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('schedule_appointment'),
    patientId: z.string().uuid().nullable(),
    doctorId: z.string().uuid(),
    procedureId: z.string().uuid(),
    scheduledAt: z.string().datetime({ offset: true }),
  }),
  z.object({
    type: z.literal('confirm_appointment'),
    appointmentId: z.string().uuid(),
  }),
  z.object({
    type: z.literal('cancel_appointment'),
    appointmentId: z.string().uuid(),
    reason: z.string().max(500).optional(),
  }),
  z.object({
    type: z.literal('reschedule_appointment'),
    appointmentId: z.string().uuid(),
    newScheduledAt: z.string().datetime({ offset: true }),
  }),
]);

export type PendingActionPayload = z.infer<typeof PendingActionPayloadSchema>;
export type PendingActionName = PendingActionPayload['type'];

// Palavras que, sozinhas, sinalizam confirma\u00e7\u00e3o afirmativa inequ\u00edvoca.
const AFFIRM_WORDS = new Set([
  'sim',
  'confirmo',
  'confirmado',
  'confirmar',
  'confirma',
  'autorizo',
  'autorizado',
  'claro',
  'ok',
  'positivo',
  'certo',
  'pode',
  'podem',
]);

// Marcadores que NEGAM/CONDICIONAM a confirma\u00e7\u00e3o (mesmo junto de um "sim"):
// "sim, MAS mude o hor\u00e1rio", "n\u00e3o", "talvez", "e SE...", "espera".
const REJECT_WORDS = new Set([
  'nao',
  'mas',
  'porem',
  'talvez',
  'nem',
  'se',
  'espera',
  'aguarde',
  'aguarda',
]);

// In\u00edcio t\u00edpico de PERGUNTA/pedido (n\u00e3o \u00e9 confirmar): "posso confirmar?",
// "quero informa\u00e7\u00f5es", "e se eu cancelar?".
const REJECT_PREFIXES = [
  'posso',
  'poderia',
  'quero',
  'gostaria',
  'como',
  'quando',
  'qual',
  'sera',
  'e se',
];

function normalizeConfirmation(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Confirma\u00e7\u00e3o expl\u00edcita server-side (gate anti-execu\u00e7\u00e3o-sem-consentimento). N\u00c3O
 * \u00e9 um whitelist exato: o paciente real responde "SIM, confirmo o agendamento",
 * n\u00e3o s\u00f3 "sim". Aceita mensagens com uma palavra afirmativa inequ\u00edvoca, MAS
 * rejeita perguntas, nega\u00e7\u00f5es e condicionais ("sim, mas...", "posso confirmar?",
 * "talvez", "n\u00e3o") \u2014 nunca executa uma a\u00e7\u00e3o com base em resposta amb\u00edgua.
 */
export function isExplicitConfirmation(message: string): boolean {
  if (/\?\s*$/.test(message)) return false; // pergunta nunca confirma
  const normalized = normalizeConfirmation(message);
  if (normalized.length === 0) return false;
  const words = normalized.split(' ').filter(Boolean);
  if (words.some((w) => REJECT_WORDS.has(w))) return false;
  if (REJECT_PREFIXES.some((p) => normalized === p || normalized.startsWith(`${p} `))) return false;
  return words.some((w) => AFFIRM_WORDS.has(w));
}

export function assertAgentSchedulePolicy(args: {
  scheduledAt: string;
  now: Date;
  maxDaysAhead: number;
}): void {
  const scheduledAt = new Date(args.scheduledAt);
  if (Number.isNaN(scheduledAt.getTime())) throw new Error('data de agendamento inválida');
  const latest = args.now.getTime() + args.maxDaysAhead * 86_400_000;
  if (scheduledAt.getTime() > latest) {
    throw new Error(`agendamento excede o limite de ${args.maxDaysAhead} dias da clínica`);
  }
}

export function assertAgentSchedulingIdentity(args: {
  patientId: string | null;
  identityAmbiguous: boolean;
  canScheduleAnonymous: boolean;
}): void {
  if (args.identityAmbiguous) {
    throw new Error('telefone associado a mais de um paciente; requer desambiguação humana');
  }
  if (!args.patientId && !args.canScheduleAnonymous) {
    throw new Error('paciente não identificado: cadastre/identifique antes de agendar');
  }
}

export function parsePendingActionPayload(value: unknown): PendingActionPayload {
  return PendingActionPayloadSchema.parse(value);
}

/**
 * R1 — chave de idempotência da EXECUÇÃO derivada por CONTEÚDO da ação, NUNCA
 * pelo `pendingActionId` (que muda a cada preparação). Sem isto, duas tentativas
 * equivalentes (preparar→confirmar duas vezes com os mesmos argumentos) gerariam
 * chaves distintas no core → DUAS consultas. Ancorada na conversa + tipo + args
 * canônicos: o mesmo agendamento lógico colapsa numa única mutação no core,
 * mesmo com reentrega do webhook, retry do worker ou nova preparação idêntica.
 */
export function pendingActionIdemKey(
  conversationId: string,
  payload: PendingActionPayload,
): string {
  return agentIdemKey(conversationId, payload.type, payload);
}

export async function proposePendingAction<T extends PendingActionPayload>(
  tx: Tx,
  args: {
    clinicId: string;
    conversationId: string;
    eventId: string;
    payload: T;
    summary: string;
    now?: Date;
  },
): Promise<{ id: string; action: T['type']; summary: string; expiresAt: string }> {
  const now = args.now ?? new Date();
  const expiresAt = new Date(now.getTime() + PENDING_ACTION_TTL_MS);
  const payloadEncrypted = await encryptForTenant(args.clinicId, JSON.stringify(args.payload));

  await tx
    .update(aiPendingActions)
    .set({ status: 'superseded' })
    .where(
      and(
        eq(aiPendingActions.clinicId, args.clinicId),
        eq(aiPendingActions.conversationId, args.conversationId),
        eq(aiPendingActions.status, 'pending'),
      ),
    );

  const [row] = await tx
    .insert(aiPendingActions)
    .values({
      clinicId: args.clinicId,
      conversationId: args.conversationId,
      actionName: args.payload.type,
      payloadEncrypted,
      summary: args.summary,
      sourceEventId: args.eventId,
      expiresAt,
    })
    .returning({ id: aiPendingActions.id });
  if (!row) throw new Error('não foi possível preparar a ação para confirmação');

  return {
    id: row.id,
    action: args.payload.type,
    summary: args.summary,
    expiresAt: expiresAt.toISOString(),
  };
}

export interface PendingActionExecutionResult {
  pendingActionId: string;
  action: PendingActionName;
  appointmentId: string;
  status: string;
  scheduledAt?: string;
}

export async function executePendingAction(
  ctx: ToolContext,
): Promise<PendingActionExecutionResult> {
  if (!isExplicitConfirmation(ctx.currentMessage)) {
    throw new Error('a mensagem do paciente não é uma confirmação explícita');
  }

  const [row] = await ctx.tx
    .select()
    .from(aiPendingActions)
    .where(
      and(
        eq(aiPendingActions.clinicId, ctx.clinicId),
        eq(aiPendingActions.conversationId, ctx.conversationId),
        eq(aiPendingActions.status, 'pending'),
      ),
    )
    .orderBy(desc(aiPendingActions.createdAt))
    .limit(1)
    .for('update');

  if (!row) throw new Error('não há ação pendente para confirmar');
  if (new Date(row.expiresAt).getTime() <= Date.now()) {
    await ctx.tx
      .update(aiPendingActions)
      .set({ status: 'expired' })
      .where(and(eq(aiPendingActions.id, row.id), eq(aiPendingActions.clinicId, ctx.clinicId)));
    throw new Error('a confirmação expirou; peça um novo resumo da ação');
  }

  const payload = parsePendingActionPayload(
    JSON.parse(await decryptForTenant(ctx.clinicId, row.payloadEncrypted)) as unknown,
  );
  if (payload.type !== row.actionName) throw new Error('ação pendente inconsistente');

  const actor = {
    clinicId: ctx.clinicId,
    eventId: ctx.eventId,
    aiRequestId: ctx.aiRequestId,
  };
  // Chave por CONTEÚDO (não por row.id): preparar→confirmar duas vezes com os
  // mesmos argumentos colapsa numa única consulta no core (idempotência real).
  const idempotencyKey = pendingActionIdemKey(ctx.conversationId, payload);

  let appointment: Awaited<ReturnType<typeof schedulingApiV1.lookupAppointment>>;
  if (payload.type === 'schedule_appointment') {
    appointment = await schedulingApiV1.scheduleAsAgent(
      actor,
      {
        doctorId: payload.doctorId,
        procedureId: payload.procedureId,
        patientId: payload.patientId,
        scheduledAt: payload.scheduledAt,
      },
      idempotencyKey,
    );
  } else if (payload.type === 'confirm_appointment') {
    appointment = await schedulingApiV1.confirmAsAgent(
      actor,
      payload.appointmentId,
      idempotencyKey,
    );
  } else if (payload.type === 'cancel_appointment') {
    appointment = await schedulingApiV1.cancelAsAgent(
      actor,
      payload.appointmentId,
      idempotencyKey,
      payload.reason,
    );
  } else {
    appointment = await schedulingApiV1.rescheduleAsAgent(
      actor,
      payload.appointmentId,
      { newScheduledAt: payload.newScheduledAt },
      idempotencyKey,
    );
  }
  if (!appointment) throw new Error('ação confirmada sem consulta resultante');

  await ctx.tx
    .update(aiPendingActions)
    .set({
      status: 'executed',
      confirmationEventId: ctx.eventId,
      executedAt: sql`now()`,
    })
    .where(
      and(
        eq(aiPendingActions.id, row.id),
        eq(aiPendingActions.clinicId, ctx.clinicId),
        eq(aiPendingActions.status, 'pending'),
      ),
    );

  return {
    pendingActionId: row.id,
    action: payload.type,
    appointmentId: appointment.id,
    status: appointment.status,
    scheduledAt: appointment.scheduledAt,
  };
}
