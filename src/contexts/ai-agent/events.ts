/**
 * AI Agent context events (C11). Producer-side schema registrado no catálogo do
 * outbox no module load (importado por ./schema, re-exportado pelo barrel).
 *
 * ÚNICO evento: `ai_agent.conversation.completed` — emitido ao fim de cada
 * TURNO de conversa (inbound processado → resposta enviada/fallback). Sem
 * handler até C14/C15 (producer ahead — allowlisted no check-handler-registry).
 *
 * Payload rule (5.9): NUNCA conteúdo/plaintext — só ids + enum de outcome +
 * contadores. JSON-safe (sem Date/BigInt).
 */
import { z } from 'zod';

import { registerEventSchema } from '@/lib/outbox/catalog';

export const AI_AGENT_EVENTS = {
  CONVERSATION_COMPLETED: 'ai_agent.conversation.completed',
} as const;

const uuid = z.string().uuid();

/**
 * Outcome do turno:
 *  - replied        — LLM respondeu (com ou sem tools)
 *  - fallback       — falha de provider/tool/rounds → resposta operacional
 *  - handoff        — tool request_human_handoff ou MAX_FALLBACKS atingido
 *  - suppressed     — destinatário em suppression_list (sem envio)
 *  - quota_blocked  — orçamento mensal da clínica estourado (sem LLM)
 *  - prefiltered    — pré-filtro clínico respondeu o fallback seguro (sem LLM)
 */
export const ConversationCompletedSchema = z.object({
  clinicId: uuid,
  conversationId: uuid,
  inboundMessageId: uuid,
  outcome: z.enum([
    'replied',
    'fallback',
    'handoff',
    'suppressed',
    'quota_blocked',
    'prefiltered',
  ]),
  toolCallCount: z.number().int().min(0),
  costUsd: z.number().min(0),
});
export type ConversationCompletedPayload = z.infer<typeof ConversationCompletedSchema>;

registerEventSchema(AI_AGENT_EVENTS.CONVERSATION_COMPLETED, ConversationCompletedSchema);
