/**
 * Domínio C14 — tipos + payloads dos jobs proativos.
 *
 * O `payload` de cada job é JSON-safe e NÃO-PII (ADR-011 #27): só ids + snapshot
 * operacional (nome de médico, datas, valor). Nome/telefone de paciente são
 * resolvidos no send-time (patientApiV1.getProactiveContact), nunca persistidos
 * aqui. Os schemas Zod validam o payload na borda do enqueue e do send.
 */
import { z } from 'zod';

import type { ProactiveJobType } from '../schema';

const uuid = z.string().uuid();
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/); // data-calendário local

/** Lembrete D-1 — prevenção de no-show. */
export const ReminderPayloadSchema = z.object({
  patientId: uuid,
  appointmentId: uuid,
  /** Instante UTC da consulta (formata-se p/ hora local no template). */
  scheduledAt: z.string().datetime(),
  doctorNome: z.string(),
});
export type ReminderPayload = z.infer<typeof ReminderPayloadSchema>;

/** Cobrança amigável D+3 / D+7 (só com opt-in cobranca_whatsapp). */
export const DunningPayloadSchema = z.object({
  patientId: uuid,
  lancamentoId: uuid,
  stage: z.union([z.literal(3), z.literal(7)]),
  valor: z.number().nonnegative(),
  dueDate: ymd,
  procedureNome: z.string().nullable(),
});
export type DunningPayload = z.infer<typeof DunningPayloadSchema>;

/** Followup de retorno solicitado pelo médico (return_date − 2 dias). */
export const FollowupPayloadSchema = z.object({
  patientId: uuid,
  prontuarioId: uuid,
  doctorNome: z.string().nullable(),
  returnDate: ymd,
});
export type FollowupPayload = z.infer<typeof FollowupPayloadSchema>;

export const PROACTIVE_PAYLOAD_SCHEMAS = {
  reminder: ReminderPayloadSchema,
  dunning: DunningPayloadSchema,
  followup: FollowupPayloadSchema,
} satisfies Record<ProactiveJobType, z.ZodTypeAny>;

export type ProactivePayload = ReminderPayload | DunningPayload | FollowupPayload;

/** Resultado da política de envio (suppression/consent/contato). */
export interface ProactivePolicyResult {
  allowed: boolean;
  /** Código curto p/ failed_reason quando bloqueado (no_contact|suppressed|no_consent). */
  reason?: string;
}
