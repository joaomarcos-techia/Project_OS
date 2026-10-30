/**
 * AI Agent context events (C11). Producer-side schema registrado no catálogo do
 * outbox no module load (importado por ./schema, re-exportado pelo barrel).
 *
 * Eventos:
 *   - `ai_agent.conversation.completed` — fim de cada TURNO de conversa (inbound
 *     processado → resposta enviada/fallback). Consumido pelo metering do
 *     Billing (C13).
 *   - `ai_agent.manual_reply.requested` (ADR-047) — humano respondeu pelo painel;
 *     o handler faz o envio ao WhatsApp fora da TX.
 *
 * Payload rule (5.9): NUNCA conteúdo/plaintext — só ids + enum de outcome +
 * contadores. JSON-safe (sem Date/BigInt).
 */
import { z } from 'zod';

import { registerEventSchema } from '@/lib/outbox/catalog';

export const AI_AGENT_EVENTS = {
  CONVERSATION_COMPLETED: 'ai_agent.conversation.completed',
  MANUAL_REPLY_REQUESTED: 'ai_agent.manual_reply.requested',
} as const;

const uuid = z.string().uuid();

/**
 * Outcome do turno:
 *  - replied        — LLM respondeu (com ou sem tools)
 *  - fallback       — falha de provider/tool/rounds ou envio não aceito pela Meta
 *  - handoff        — tool request_human_handoff ou MAX_FALLBACKS atingido
 *  - suppressed     — destinatário em suppression_list (sem envio)
 *  - quota_blocked  — teto de custo da clínica na janela (R4): o turno respondeu
 *                     o fallback operacional SEM chamar o provider. Passou a ser
 *                     gerado de fato na auditoria 2026-09-10 (item 11); antes o
 *                     valor existia no contrato mas nenhum caminho o produzia.
 *                     Não é teto de plano comercial — esse é do Billing.
 *  - prefiltered    — pré-filtro clínico respondeu o fallback seguro (sem LLM)
 */
export const ConversationCompletedSchema = z.object({
  clinicId: uuid,
  conversationId: uuid,
  inboundMessageId: uuid,
  outcome: z.enum(['replied', 'fallback', 'handoff', 'suppressed', 'quota_blocked', 'prefiltered']),
  toolCallCount: z.number().int().min(0),
  costUsd: z.number().min(0),
});
export type ConversationCompletedPayload = z.infer<typeof ConversationCompletedSchema>;

registerEventSchema(AI_AGENT_EVENTS.CONVERSATION_COMPLETED, ConversationCompletedSchema);

/**
 * ADR-047 — um humano respondeu pelo painel; falta ENVIAR ao WhatsApp.
 *
 * A mensagem já está cifrada em `ai_messages` (mesma TX que publicou este
 * evento). O payload carrega só ids: o texto da resposta é conteúdo clínico e
 * o outbox é lido em plaintext no banco (payload jsonb) — regra 5.9. O handler
 * relê e decifra a mensagem por `messageEventId`.
 *
 * `messageEventId` é a MESMA chave usada como idempotencyKey do outbox e do
 * envio (outbound_messages), fechando a cadeia de dedup ponta a ponta.
 */
export const ManualReplyRequestedSchema = z.object({
  clinicId: uuid,
  conversationId: uuid,
  messageEventId: uuid,
  sentByUserId: uuid,
});
export type ManualReplyRequestedPayload = z.infer<typeof ManualReplyRequestedSchema>;

registerEventSchema(AI_AGENT_EVENTS.MANUAL_REPLY_REQUESTED, ManualReplyRequestedSchema);
