'use server';

/**
 * Server Actions do painel de Conversas IA (ADR-047). Pipeline congelado:
 *   requireUser → require*Permission → Zod → idempotentMutation({idempotency,audit}, tx => …)
 *
 * Três invariantes de segurança, TODAS revalidadas no servidor. A UI desabilita
 * botão e textarea, mas isso é UX — o cliente não é autoridade sobre nada aqui.
 *
 *  1. TENANT — `idempotentMutation` abre `withTenant(clinicId)`; o `tx` já chega
 *     RLS-scoped e nenhuma query filtra clinic_id "na mão" por acaso.
 *
 *  2. STATUS = 'handoff' para responder. Em 'active' o agente ainda responde ao
 *     próximo inbound: humano e IA falariam com o paciente ao mesmo tempo. A
 *     checagem é feita sob `SELECT ... FOR UPDATE`, não sobre o estado que a UI
 *     carregou — entre o render e o clique outro operador pode ter devolvido a
 *     conversa ao agente.
 *
 *  3. JANELA DE 24h da Meta, recalculada aqui. Fora dela o provider rejeita
 *     texto livre, e a rejeição chegaria DEPOIS de o operador achar que
 *     respondeu.
 *
 * Idempotência: resolvida por `idempotentMutation` ANTES de qualquer regra de
 * negócio. Duplo-clique com a mesma chave devolve o resultado original — não um
 * erro "não está em handoff" (que é o que aconteceria se a regra rodasse antes).
 */
import { and, desc, eq, gte } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import { PERMISSIONS } from '@/lib/auth/permissions';
import { requireCachedPermission, requireClinicId, requireUser } from '@/lib/auth/tenant-context';
import { idempotentMutation } from '@/lib/idempotency/mutation';
import { MUTATION_IDEM_TTL_SECONDS } from '@/lib/idempotency/ttl';
import { metrics } from '@/lib/observability/metrics';
import { publishEvent } from '@/lib/outbox/publish';

import {
  ConversationNotFoundError,
  ConversationNotInHandoffError,
  InvalidConversationTransitionError,
  MetaWindowClosedError,
} from './errors';
import { AI_AGENT_EVENTS } from './events';
import { idemKey, jsonSafe, requestContext } from './internal/action-helpers';
import { appendManualMessage, escalateToHuman, returnToAgent } from './internal/conversation';
import { canReplyManually } from './internal/reply-policy';
import { MAX_INBOUND_CHARS } from './limits';
import { aiConversations, aiMessages } from './schema';

const ConversationIdSchema = z.string().uuid();

const ManualReplySchema = z.object({
  conversationId: z.string().uuid(),
  text: z.string().trim().min(1, 'Escreva uma mensagem.').max(MAX_INBOUND_CHARS),
});

export interface ManualReplyResult {
  messageEventId: string;
}

/**
 * Trava a conversa para a transação corrente. TODA action de mutação passa por
 * aqui: sem o FOR UPDATE, dois operadores agindo ao mesmo tempo leem o mesmo
 * status e ambos "vencem".
 */
async function lockConversation(
  tx: Parameters<Parameters<typeof idempotentMutation>[1]>[0],
  clinicId: string,
  conversationId: string,
): Promise<{ status: string; startedAt: Date }> {
  const [row] = await tx
    .select({ status: aiConversations.status, startedAt: aiConversations.startedAt })
    .from(aiConversations)
    .where(and(eq(aiConversations.id, conversationId), eq(aiConversations.clinicId, clinicId)))
    .limit(1)
    .for('update');
  if (!row) throw new ConversationNotFoundError();
  return row;
}

// --- assumir conversa --------------------------------------------------------

/**
 * Coloca a conversa em 'handoff'. REUSA `escalateToHuman` — a mesma função que
 * a tool `request_human_handoff` e o gatilho de MAX_FALLBACKS usam. Ela já
 * dedupa a fila pela unique parcial de handoff aberto; o que falta e é
 * acrescentado aqui é a auditoria (o contexto ai-agent não escreve audit).
 */
export async function assumirConversa(
  conversationId: string,
  idempotencyKey: string,
): Promise<void> {
  await requireUser();
  await requireCachedPermission(PERMISSIONS.MANAGE_CONVERSATIONS);
  const id = ConversationIdSchema.parse(conversationId);
  const clinicId = await requireClinicId();
  const ctx = await requestContext();

  await idempotentMutation(
    {
      idempotency: {
        key: idemKey('assume_conversation', idempotencyKey),
        payload: jsonSafe({ conversationId: id }),
        ttlSeconds: MUTATION_IDEM_TTL_SECONDS,
      },
      audit: {
        action: 'ai_agent.conversation.assumed',
        resourceType: 'ai_conversation',
        resourceId: id,
        before: null,
        requestContext: ctx,
      },
    },
    async (tx) => {
      const conv = await lockConversation(tx, clinicId, id);
      // 'closed'/'abandoned' são terminais: reabrir exigiria decisão de produto
      // que ninguém tomou. 'handoff' já assumida é no-op (idempotente).
      if (conv.status !== 'active' && conv.status !== 'handoff') {
        throw new InvalidConversationTransitionError(conv.status, 'handoff');
      }
      await escalateToHuman(tx, clinicId, id, 'manual_takeover');
      metrics.emit('ai_agent.conversation.assumed', { clinicId, conversationId: id });
      return { conversationId: id };
    },
  );
}

// --- devolver ao agente ------------------------------------------------------

export async function devolverAoAgente(
  conversationId: string,
  idempotencyKey: string,
): Promise<void> {
  await requireUser();
  await requireCachedPermission(PERMISSIONS.MANAGE_CONVERSATIONS);
  const id = ConversationIdSchema.parse(conversationId);
  const clinicId = await requireClinicId();
  const ctx = await requestContext();

  await idempotentMutation(
    {
      idempotency: {
        key: idemKey('return_conversation', idempotencyKey),
        payload: jsonSafe({ conversationId: id }),
        ttlSeconds: MUTATION_IDEM_TTL_SECONDS,
      },
      audit: {
        action: 'ai_agent.conversation.returned',
        resourceType: 'ai_conversation',
        resourceId: id,
        before: null,
        requestContext: ctx,
      },
    },
    async (tx) => {
      const conv = await lockConversation(tx, clinicId, id);
      if (conv.status !== 'handoff') {
        throw new InvalidConversationTransitionError(conv.status, 'active');
      }
      await returnToAgent(tx, clinicId, id);
      metrics.emit('ai_agent.conversation.returned', { clinicId, conversationId: id });
      return { conversationId: id };
    },
  );
}

// --- responder manualmente ---------------------------------------------------

/**
 * Persiste a resposta do humano e ENFILEIRA o envio. A mensagem e o evento
 * commitam juntos: não existe estado em que a mensagem esteja no histórico sem
 * o envio agendado, nem envio agendado sem mensagem no histórico.
 *
 * O retorno traz `messageEventId` — a chave que liga a linha de `ai_messages` à
 * de `outbound_messages` e permite à thread mostrar pending/sent/failed em vez
 * de afirmar "enviada" logo após o clique.
 */
export async function responderManualmente(
  input: { conversationId: string; text: string },
  idempotencyKey: string,
): Promise<ManualReplyResult> {
  const user = await requireUser();
  await requireCachedPermission(PERMISSIONS.MANAGE_CONVERSATIONS);
  const data = ManualReplySchema.parse(input);
  const clinicId = await requireClinicId();
  const ctx = await requestContext();

  return idempotentMutation(
    {
      idempotency: {
        key: idemKey('manual_reply', idempotencyKey),
        payload: jsonSafe({ conversationId: data.conversationId, text: data.text }),
        ttlSeconds: MUTATION_IDEM_TTL_SECONDS,
      },
      audit: {
        action: 'ai_agent.manual_reply.sent',
        resourceType: 'ai_conversation',
        resourceId: data.conversationId,
        before: null,
        requestContext: ctx,
      },
      // Sem `project`: o texto da mensagem não alcança nem audit_events nem
      // idempotency_keys. O `payload` vira payload_HASH (a tabela não guarda o
      // original) e o `result` — que é o que vai para audit.after e para a
      // resposta em cache — é só `{ messageEventId }`. Se um dia o retorno
      // passar a carregar o conteúdo, ESTE é o ponto que precisa redigir (A1).
    },
    async (tx): Promise<ManualReplyResult> => {
      const conv = await lockConversation(tx, clinicId, data.conversationId);

      // Última mensagem DO PACIENTE — o marco da janela da Meta. O
      // `gte(createdAt, startedAt)` é poda de partição (WHY em queries.ts).
      const [lastInbound] = await tx
        .select({ createdAt: aiMessages.createdAt })
        .from(aiMessages)
        .where(
          and(
            eq(aiMessages.clinicId, clinicId),
            eq(aiMessages.conversationId, data.conversationId),
            eq(aiMessages.direction, 'in'),
            gte(aiMessages.createdAt, conv.startedAt),
          ),
        )
        .orderBy(desc(aiMessages.createdAt))
        .limit(1);

      // As duas invariantes, revalidadas sob o lock — não sobre o estado que a
      // UI carregou. Entre o render e o clique a conversa pode ter sido
      // devolvida ao agente por outro operador.
      const decision = canReplyManually({
        status: conv.status,
        lastInboundAt: lastInbound?.createdAt ?? null,
        now: new Date(),
      });

      if (!decision.allowed) {
        metrics.emit('ai_agent.manual_reply.rejected', {
          clinicId,
          conversationId: data.conversationId,
          reason: decision.reason,
          status: conv.status,
        });
        throw decision.reason === 'not_handoff'
          ? new ConversationNotInHandoffError(conv.status)
          : new MetaWindowClosedError();
      }

      const messageEventId = randomUUID();

      await appendManualMessage(tx, {
        clinicId,
        conversationId: data.conversationId,
        eventId: messageEventId,
        text: data.text,
        sentByUserId: user.userId,
      });

      await publishEvent(tx, {
        clinicId,
        eventType: AI_AGENT_EVENTS.MANUAL_REPLY_REQUESTED,
        payload: {
          clinicId,
          conversationId: data.conversationId,
          messageEventId,
          sentByUserId: user.userId,
        },
        idempotencyKey: messageEventId,
      });

      metrics.emit('ai_agent.manual_reply.queued', {
        clinicId,
        conversationId: data.conversationId,
        chars: data.text.length,
      });

      return { messageEventId };
    },
  );
}
