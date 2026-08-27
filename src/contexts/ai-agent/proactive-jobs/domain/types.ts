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

/**
 * ADR-049 1.6a — link do sinal a caminho do paciente.
 *
 * `chargeId` e a chave do ciclo, e o payload **nao carrega o link**: ele e
 * resolvido no send-time por `paymentsApiV1.getPayableCharge`, que devolve
 * `null` se a cobranca ja tiver sido paga, estornada ou expirada. Guardar o link
 * aqui deixaria uma URL de pagamento em repouso numa fila que operador e worker
 * leem — e ainda por cima uma que pode estar obsoleta na hora do envio.
 */
export const DepositLinkPayloadSchema = z.object({
  patientId: uuid,
  chargeId: uuid,
  appointmentId: uuid,
  /** Valor do sinal, em reais — entra no texto da mensagem. */
  amount: z.number().positive(),
  /** Prazo para pagar. E o que da urgencia a mensagem, e o que a torna honesta. */
  holdExpiresAt: z.string().datetime(),
});
export type DepositLinkPayload = z.infer<typeof DepositLinkPayloadSchema>;

/**
 * D35 / 1.6c — link do restante após o atendimento.
 *
 * Não há prazo de hold: a consulta já aconteceu. Como no sinal, o link não fica
 * no job; o worker o resolve no send-time pelo seam do Payments.
 */
export const RemainderLinkPayloadSchema = z.object({
  patientId: uuid,
  chargeId: uuid,
  appointmentId: uuid,
  /** Saldo restante referente ao atendimento, em reais. */
  amount: z.number().positive(),
});
export type RemainderLinkPayload = z.infer<typeof RemainderLinkPayloadSchema>;

/**
 * WAIT-001 — vaga liberada por cancelamento, ofertada ao 1º elegível da fila.
 *
 * `waitlistEntryId` é a chave do ciclo: o guard de send-time confirma que a
 * oferta continua aberta antes de mandar qualquer mensagem, para não convidar
 * alguém para um horário que a clínica já preencheu.
 */
export const WaitlistOfferPayloadSchema = z.object({
  patientId: uuid,
  waitlistEntryId: uuid,
  releasedAppointmentId: uuid,
  /** Instante UTC da vaga (formata-se p/ hora local no template). */
  scheduledAt: z.string().datetime(),
  doctorNome: z.string().nullable(),
});
export type WaitlistOfferPayload = z.infer<typeof WaitlistOfferPayloadSchema>;

export const PROACTIVE_PAYLOAD_SCHEMAS = {
  reminder: ReminderPayloadSchema,
  dunning: DunningPayloadSchema,
  followup: FollowupPayloadSchema,
  waitlist_offer: WaitlistOfferPayloadSchema,
  deposit_link: DepositLinkPayloadSchema,
  remainder_link: RemainderLinkPayloadSchema,
} satisfies Record<ProactiveJobType, z.ZodTypeAny>;

export type ProactivePayload =
  | ReminderPayload
  | DunningPayload
  | FollowupPayload
  | WaitlistOfferPayload
  | DepositLinkPayload
  | RemainderLinkPayload;

/** Resultado da política de envio (suppression/consent/contato). */
export interface ProactivePolicyResult {
  allowed: boolean;
  /** Código curto p/ failed_reason quando bloqueado (no_contact|suppressed|no_consent). */
  reason?: string;
}
