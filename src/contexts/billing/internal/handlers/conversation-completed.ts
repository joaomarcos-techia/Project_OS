/**
 * Billing consumer: ai_agent.conversation.completed → +1 em usage_metrics
 * (conversas_ia). Idempotente via usage_counter_ledger.
 *
 * Conta só `outcome='replied'` (a IA efetivamente respondeu — não fallback/
 * quota_blocked/prefiltered). Dedup por conversationId: o evento NÃO carrega o
 * telefone (PII), então o "1×/24h por número" do spec é aproximado por
 * conversationId (uma conversa = um diálogo por número). Desvio documentado no
 * REPORT. O bloqueio por teto é do próprio ai-agent (circuit/quota de custo).
 */
import type { Tx } from '@/lib/db';
import { registerHandler } from '@/lib/outbox/registry';

/* eslint-disable boundaries/element-types -- evento + tipo são contrato PÚBLICO do AI Agent. */
import { AI_AGENT_EVENTS, type ConversationCompletedPayload } from '@/contexts/ai-agent';
/* eslint-enable boundaries/element-types */

import { currentPeriod, recordUsage } from '../quota';

async function countConversaIa(ctx: {
  tx: Tx;
  clinicId: string;
  payload: ConversationCompletedPayload;
}): Promise<void> {
  const { tx, clinicId, payload } = ctx;
  if (payload.outcome !== 'replied') return;
  await recordUsage(
    tx,
    clinicId,
    { metric: 'ai_messages', subjectId: payload.conversationId, dedupKey: payload.conversationId },
    currentPeriod(),
  );
}

registerHandler<ConversationCompletedPayload>(
  AI_AGENT_EVENTS.CONVERSATION_COMPLETED,
  countConversaIa,
);
