/**
 * Coexistência — a recepção respondeu o paciente pelo app WhatsApp Business do
 * celular (`messaging.business_app_echo.received`).
 *
 * Duas coisas acontecem, na mesma tx:
 *
 * 1. A mensagem entra na conversa, marcada `sent_via_business_app` (0107). O
 *    painel mostra quem escreveu, e quando a conversa voltar para o agente ele
 *    tem o contexto do que a recepção disse — `getRecentMessages` já inclui as
 *    mensagens de saída humanas no histórico do prompt.
 *
 * 2. Se a conversa estava com o agente, ela vai para atendimento humano
 *    (`handoff`). Decisão de produto de 30/09/2026: a IA fica pausada naquela
 *    conversa até alguém clicar em "Devolver ao agente" no painel — o mesmo
 *    ciclo assumir/devolver do ADR-047. Sem isto, a IA e a recepção
 *    responderiam o mesmo paciente.
 *
 * Idempotente por `eventId`: o reenvio do outbox encontra a mensagem já gravada
 * e não faz nada. Não usa `ctx.tx` pelo mesmo motivo dos outros handlers do
 * agente: a escrita precisa de RLS, e `withTenant` abre a própria tx.
 */
import { and, eq, gte, sql } from 'drizzle-orm';

import { encryptForTenant } from '@/lib/crypto';
import { withTenant } from '@/lib/db/tenant';
import { metrics } from '@/lib/observability/metrics';
import { PoisonPillError } from '@/lib/outbox/errors';
import { registerHandler } from '@/lib/outbox/registry';
import type { HandlerCtx } from '@/lib/outbox/types';

/* eslint-disable boundaries/element-types -- evento + API interna são o contrato PÚBLICO do Messaging (mesma exceção dos handlers inbound-received e manual-reply-requested). */
import {
  MESSAGING_EVENTS,
  messagingApiV1,
  type BusinessAppEchoReceivedPayload,
} from '@/contexts/messaging';
/* eslint-enable boundaries/element-types */

import { aiMessages } from '../../schema';
import { escalateToHuman, findOrCreateConversation } from '../conversation';

/** Motivo do handoff quando a recepção assume a conversa pelo celular. */
export const BUSINESS_APP_REPLY_REASON = 'business_app_reply';

/**
 * O que fica na conversa quando o eco não era texto (foto, áudio, figurinha).
 * O conteúdo da mídia não é baixado — só o registro de que a recepção
 * respondeu, que é o que o painel e o agente precisam.
 */
export const BUSINESS_APP_NON_TEXT =
  '[Mensagem sem texto enviada pelo WhatsApp Business do celular]';

type Outcome = 'paused' | 'recorded' | 'duplicate';

export async function recordBusinessAppEcho(
  ctx: HandlerCtx<BusinessAppEchoReceivedPayload>,
): Promise<void> {
  const { clinicId, payload, eventId } = ctx;

  if (payload.clinicId !== clinicId) {
    throw new PoisonPillError(
      `business app echo: clinicId do payload (${payload.clinicId}) != tenant do evento (${clinicId})`,
      'clinic_mismatch',
    );
  }

  const outcome = await withTenant(clinicId, async (tx): Promise<Outcome | null> => {
    const echo = await messagingApiV1.getBusinessAppEchoForAgent(tx, clinicId, payload.echoId);
    if (!echo) return null;

    const conversation = await findOrCreateConversation(
      tx,
      clinicId,
      echo.toNumberHash,
      await encryptForTenant(clinicId, echo.toNumber),
    );

    // Checkpoint por eventId. A janela de 7 dias poda as partições de
    // ai_messages; um retry do outbox acontece em minutos, não em dias.
    const [already] = await tx
      .select({ id: aiMessages.id })
      .from(aiMessages)
      .where(
        and(
          eq(aiMessages.clinicId, clinicId),
          eq(aiMessages.conversationId, conversation.id),
          eq(aiMessages.eventId, eventId),
          gte(aiMessages.createdAt, sql`now() - interval '7 days'`),
        ),
      )
      .limit(1);
    if (already) return 'duplicate';

    await tx.insert(aiMessages).values({
      clinicId,
      conversationId: conversation.id,
      direction: 'out',
      contentEncrypted: await encryptForTenant(
        clinicId,
        echo.hasText ? echo.text : BUSINESS_APP_NON_TEXT,
      ),
      eventId,
      sentViaBusinessApp: true,
    });

    if (conversation.status === 'active') {
      await escalateToHuman(tx, clinicId, conversation.id, BUSINESS_APP_REPLY_REASON);
      return 'paused';
    }
    // Já em atendimento humano: a mensagem entra, a pausa já existe.
    return 'recorded';
  });

  // O eco foi gravado na MESMA tx que publicou o evento: sumir aqui significa
  // que a retenção (90d) já o purgou. Retry não conserta.
  if (outcome === null) {
    throw new PoisonPillError(
      `business app echo ${payload.echoId} não encontrado`,
      'business_app_echo_not_found',
    );
  }

  metrics.emit('ai_agent.business_app_echo.recorded', { clinicId, outcome });
}

registerHandler<BusinessAppEchoReceivedPayload>(
  MESSAGING_EVENTS.BUSINESS_APP_ECHO_RECEIVED,
  recordBusinessAppEcho,
);
