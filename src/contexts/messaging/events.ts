/**
 * Messaging context events (C10). Producer-side schema registrado no catálogo do
 * outbox no module load (importado por ./schema, re-exportado pelo barrel).
 *
 * Eventos: `messaging.inbound.received` (turno da IA, C11), o eco do app
 * WhatsApp Business (coexistência) e `messaging.outbound.status_updated`, que
 * a fila C14 consome para fechar o job cuja mensagem a Meta recusou depois de
 * aceitar (EC-32).
 *
 * Payload rule (5.9): NUNCA conteúdo/plaintext — só ids + hashes + escalares
 * não-sensíveis. JSON-safe (sem Date/BigInt; receivedAt é string ISO). O
 * consumidor lê a row por id para descriptografar.
 */
import { z } from 'zod';

import { registerEventSchema } from '@/lib/outbox/catalog';

export const MESSAGING_EVENTS = {
  INBOUND_RECEIVED: 'messaging.inbound.received',
  OUTBOUND_STATUS_UPDATED: 'messaging.outbound.status_updated',
  /**
   * Coexistência: a recepção respondeu o paciente pelo app WhatsApp Business
   * do celular. O agente de IA reage registrando a mensagem na conversa e
   * pausando o atendimento automático.
   */
  BUSINESS_APP_ECHO_RECEIVED: 'messaging.business_app_echo.received',
} as const;

const uuid = z.string().uuid();

export const InboundReceivedSchema = z.object({
  clinicId: uuid,
  inboundMessageId: uuid,
  providerMessageId: z.string(),
  provider: z.enum(['meta', 'zapi']),
  fromNumberHash: z.string(),
  toPhoneId: z.string(),
  hasText: z.boolean(),
  /**
   * `type` da Meta (08/10/2026). Aditivo e opcional: eventos anteriores seguem
   * válidos e são tratados como hoje (sem texto = sem resposta).
   */
  messageType: z.string().max(40).optional(),
  receivedAt: z.string(),
});
export type InboundReceivedPayload = z.infer<typeof InboundReceivedSchema>;

export const OutboundStatusUpdatedSchema = z.object({
  clinicId: uuid,
  outboundMessageId: uuid,
  providerMessageId: z.string(),
  status: z.enum(['sent', 'delivered', 'read', 'failed']),
  /**
   * Código da recusa quando `status = 'failed'` (Meta: `errors[0].code`, ex.:
   * "131042"). Aditivo e opcional: eventos anteriores a ele continuam válidos e
   * o callback pode vir sem código.
   */
  errorCode: z
    .string()
    .regex(/^\d{1,10}$/)
    .optional(),
});
export type OutboundStatusUpdatedPayload = z.infer<typeof OutboundStatusUpdatedSchema>;

/**
 * Só ids e o hash do destinatário — nunca texto nem telefone, nem cifrados: o
 * ciphertext muda a cada cifragem e o outbox trataria o reenvio da Meta como
 * colisão de chave. O handler lê o conteúdo por `messagingApiV1`.
 */
export const BusinessAppEchoReceivedSchema = z.object({
  clinicId: uuid,
  echoId: uuid,
  providerMessageId: z.string(),
  provider: z.enum(['meta', 'zapi']),
  toNumberHash: z.string(),
  hasText: z.boolean(),
  sentAt: z.string(),
});
export type BusinessAppEchoReceivedPayload = z.infer<typeof BusinessAppEchoReceivedSchema>;

registerEventSchema(MESSAGING_EVENTS.INBOUND_RECEIVED, InboundReceivedSchema);
registerEventSchema(MESSAGING_EVENTS.BUSINESS_APP_ECHO_RECEIVED, BusinessAppEchoReceivedSchema);
registerEventSchema(MESSAGING_EVENTS.OUTBOUND_STATUS_UPDATED, OutboundStatusUpdatedSchema);
