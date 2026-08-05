/**
 * ADR-047 — consumer de `ai_agent.manual_reply.requested`: envia ao WhatsApp a
 * resposta que um humano escreveu no painel.
 *
 * POR QUE existe um handler em vez de a Server Action enviar direto: o envio é
 * uma chamada de rede a um provider externo. Fazê-la na action significaria ou
 * (a) segurar a TX aberta durante o round-trip da Meta, ou (b) commitar e
 * depois enviar, com uma janela em que o processo morre e a mensagem fica no
 * histórico sem nunca ter saído. O outbox resolve os dois: a action commita
 * mensagem + evento atomicamente, e o worker garante at-least-once do envio.
 *
 * NÃO usa `ctx.tx` para o envio: `sendText` abre as PRÓPRIAS transações
 * (3-fase reserve/send/finalize) e `withTenant` NÃO suporta aninhamento. O
 * mesmo motivo pelo qual o handler do agente usa `phase()` em vez de ctx.tx.
 *
 * Idempotência: `idempotencyKey = messageEventId` em TODA a cadeia. Reentrada
 * do worker → mesma key → `outbound_messages` dedupa (UNIQUE clinic+key) e a
 * Meta não recebe duplicata.
 */
import { and, eq, gte } from 'drizzle-orm';

import { decryptForTenant } from '@/lib/crypto';
import { withTenant } from '@/lib/db/tenant';
import { PoisonPillError } from '@/lib/outbox/errors';
import { registerHandler } from '@/lib/outbox/registry';
import type { HandlerCtx } from '@/lib/outbox/types';
import { metrics } from '@/lib/observability/metrics';

/* eslint-disable boundaries/element-types -- messaging é superfície PÚBLICA (mesma exceção do handler inbound-received). */
import {
  messagingApiV1,
  NumberNotConnectedError,
  SuppressedRecipientError,
} from '@/contexts/messaging';
/* eslint-enable boundaries/element-types */

import { AI_AGENT_EVENTS, type ManualReplyRequestedPayload } from '../../events';
import { aiConversations, aiMessages } from '../../schema';

async function sendManualReply(ctx: HandlerCtx<ManualReplyRequestedPayload>): Promise<void> {
  const { clinicId, payload } = ctx;

  if (payload.clinicId !== clinicId) {
    throw new PoisonPillError(
      `manual reply: clinicId do payload (${payload.clinicId}) != tenant do evento (${clinicId})`,
      'clinic_mismatch',
    );
  }

  // Leitura na tx do worker (RLS aplicada); o envio acontece DEPOIS, fora dela.
  const loaded = await withTenant(clinicId, async (tx) => {
    const [conv] = await tx
      .select({
        phoneEncrypted: aiConversations.patientPhoneEncrypted,
        startedAt: aiConversations.startedAt,
      })
      .from(aiConversations)
      .where(
        and(eq(aiConversations.id, payload.conversationId), eq(aiConversations.clinicId, clinicId)),
      )
      .limit(1);
    if (!conv) return null;

    const [msg] = await tx
      .select({ contentEncrypted: aiMessages.contentEncrypted })
      .from(aiMessages)
      .where(
        and(
          eq(aiMessages.clinicId, clinicId),
          eq(aiMessages.conversationId, payload.conversationId),
          eq(aiMessages.eventId, payload.messageEventId),
          eq(aiMessages.direction, 'out'),
          // Poda de partição: sem predicado em created_at o planner varre as 13
          // partições. A conversa não tem mensagem anterior ao seu started_at
          // (invariante documentada em queries.ts).
          gte(aiMessages.createdAt, conv.startedAt),
        ),
      )
      .limit(1);
    if (!msg) return null;

    return {
      toNumber: await decryptForTenant(clinicId, conv.phoneEncrypted),
      text: await decryptForTenant(clinicId, msg.contentEncrypted),
    };
  });

  // A mensagem foi publicada na MESMA TX que a inseriu — não existir aqui
  // significa que ela foi purgada pela retenção (30d) ou que a conversa sumiu.
  // Retry não conserta nenhum dos dois.
  if (!loaded) {
    throw new PoisonPillError(
      `manual reply: mensagem ${payload.messageEventId} não encontrada na conversa ${payload.conversationId}`,
      'manual_reply_not_found',
    );
  }

  try {
    await messagingApiV1.sendText({
      clinicId,
      toNumber: loaded.toNumber,
      idempotencyKey: payload.messageEventId,
      body: { kind: 'text', text: loaded.text },
    });
  } catch (err) {
    // Terminais: retentar não muda o desfecho. O operador vê 'failed' na thread
    // (outbound_messages), então a falha não fica invisível.
    if (err instanceof SuppressedRecipientError) {
      metrics.emit('ai_agent.manual_reply.blocked', {
        clinicId,
        conversationId: payload.conversationId,
        reason: 'suppressed',
      });
      return;
    }
    if (err instanceof NumberNotConnectedError) {
      metrics.emit('ai_agent.manual_reply.blocked', {
        clinicId,
        conversationId: payload.conversationId,
        reason: 'number_not_connected',
      });
      return;
    }
    metrics.emit('ai_agent.manual_reply.send_failed', {
      clinicId,
      conversationId: payload.conversationId,
      attempt: ctx.attempt,
    });
    throw err; // indeterminado → worker retenta com a mesma key (sem duplicar)
  }

  metrics.emit('ai_agent.manual_reply.sent', {
    clinicId,
    conversationId: payload.conversationId,
  });
}

registerHandler<ManualReplyRequestedPayload>(
  AI_AGENT_EVENTS.MANUAL_REPLY_REQUESTED,
  sendManualReply,
);
