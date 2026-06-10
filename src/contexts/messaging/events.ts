/**
 * Messaging context events (C10). Producer-side schema registrado no catálogo do
 * outbox no module load (importado por ./schema, re-exportado pelo barrel).
 *
 * ÚNICO evento: `messaging.inbound.received`. Outbound e status callbacks NÃO
 * emitem evento (decisão de produto: só status + métrica).
 *
 * Payload rule (5.9): NUNCA conteúdo/plaintext — só ids + hashes + escalares
 * não-sensíveis. JSON-safe (sem Date/BigInt; receivedAt é string ISO). O
 * consumidor (C11 AI Agent) lê a row por id para descriptografar.
 *
 * Até C11 registrar o handler, este evento fica `skipped` no worker (catálogo
 * sem handler = "producer ahead of consumer", F-03). A mensagem permanece salva
 * em inbound_messages_raw.
 */
import { z } from 'zod';

import { registerEventSchema } from '@/lib/outbox/catalog';

export const MESSAGING_EVENTS = {
  INBOUND_RECEIVED: 'messaging.inbound.received',
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
  receivedAt: z.string(),
});
export type InboundReceivedPayload = z.infer<typeof InboundReceivedSchema>;

registerEventSchema(MESSAGING_EVENTS.INBOUND_RECEIVED, InboundReceivedSchema);
