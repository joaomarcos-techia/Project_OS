/**
 * Billing consumer: ai_agent.conversation.completed → +1 em usage_metrics
 * (conversas_ia). Idempotente via usage_counter_ledger.
 *
 * Conta só `outcome='replied'`. O hash do telefone fica na tabela da IA;
 * o evento carrega apenas ids. Um turno processado conta no máximo uma vez,
 * e um paciente identificado (ou contato anônimo) conta no máximo uma vez por
 * 24h, inclusive quando a janela atravessa a virada do mês.
 */
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';

import type { Tx } from '@/lib/db';
import { publishEvent } from '@/lib/outbox/publish';
import { registerHandler } from '@/lib/outbox/registry';

/* eslint-disable boundaries/element-types -- evento + tipo são contrato PÚBLICO do AI Agent. */
import {
  AI_AGENT_EVENTS,
  aiConversations,
  type ConversationCompletedPayload,
} from '@/contexts/ai-agent';
/* eslint-enable boundaries/element-types */

import { BILLING_EVENTS } from '../../events';
import { PROPOSED_OFFER, isOffer2026PlanCode } from '../../proposed-offer';
import { planSeatLimits, plans, subscriptions, usageCounterLedger } from '../../schema';
import { currentPeriod, readUsage, recordUsage } from '../quota';

const AI_WINDOW_HOURS = 24;
const WARNING_THRESHOLDS = [80, 100] as const;

async function countConversaIa(ctx: {
  tx: Tx;
  clinicId: string;
  payload: ConversationCompletedPayload;
  eventId: string;
}): Promise<void> {
  const { tx, clinicId, payload, eventId } = ctx;
  if (payload.outcome !== 'replied') return;

  const [conversation] = await tx
    .select({ phoneHash: aiConversations.patientPhoneHash, patientId: aiConversations.patientId })
    .from(aiConversations)
    .where(
      and(eq(aiConversations.id, payload.conversationId), eq(aiConversations.clinicId, clinicId)),
    )
    .limit(1);
  if (!conversation) throw new Error('Conversa da IA não encontrada para contabilização.');

  const subjectId = conversation.patientId
    ? `patient:${conversation.patientId}`
    : `phone:${conversation.phoneHash}`;
  const relatedSubjects = [...new Set([subjectId, `phone:${conversation.phoneHash}`])];

  // Locks por tenant+identidade, em ordem estável, fecham respostas concorrentes
  // e a corrida entre contato anônimo e identificação do paciente.
  for (const lockKey of [...new Set(relatedSubjects)].sort()) {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`ai-usage:${clinicId}:${lockKey}`}, 0))`,
    );
  }
  // O marcador por eventId impede que um retry tardio conte de novo após 24h.
  const [clock] = await tx.execute<{ counted_at: string | Date }>(sql`SELECT now() AS counted_at`);
  if (!clock) throw new Error('Relógio do banco indisponível para contabilização.');
  const countedAt = new Date(clock.counted_at);
  if (!Number.isFinite(countedAt.getTime())) {
    throw new Error('Relógio do banco inválido para contabilização.');
  }
  const period = currentPeriod(countedAt);
  const turn = await tx
    .insert(usageCounterLedger)
    .values({
      clinicId,
      metric: 'ai_turn',
      subjectId,
      dedupKey: eventId,
      periodYyyymm: period,
    })
    .onConflictDoNothing()
    .returning({ dedupKey: usageCounterLedger.dedupKey });
  if (turn.length === 0) return;

  const [recent] = await tx
    .select({ createdAt: usageCounterLedger.createdAt })
    .from(usageCounterLedger)
    .where(
      and(
        eq(usageCounterLedger.clinicId, clinicId),
        eq(usageCounterLedger.metric, 'ai_messages'),
        inArray(usageCounterLedger.subjectId, relatedSubjects),
        gte(usageCounterLedger.createdAt, sql`now() - (${AI_WINDOW_HOURS} * interval '1 hour')`),
      ),
    )
    .orderBy(desc(usageCounterLedger.createdAt))
    .limit(1);
  if (recent) return;

  await recordUsage(tx, clinicId, { metric: 'ai_messages', subjectId, dedupKey: eventId }, period);

  const [plan] = await tx
    .select({ code: plans.code, doctors: planSeatLimits.doctors })
    .from(subscriptions)
    .innerJoin(plans, eq(plans.id, subscriptions.planId))
    .innerJoin(planSeatLimits, eq(planSeatLimits.planId, plans.id))
    .where(eq(subscriptions.clinicId, clinicId))
    .limit(1);
  if (!plan || !isOffer2026PlanCode(plan.code)) return;
  const limit = plan.doctors * PROPOSED_OFFER.conversationsPerProfessional;
  const usage = (await readUsage(tx, clinicId, period)).ai_messages;
  for (const threshold of WARNING_THRESHOLDS) {
    const triggerAt = Math.ceil((limit * threshold) / 100);
    if (usage < triggerAt || usage - 1 >= triggerAt) continue;
    await publishEvent(tx, {
      clinicId,
      eventType: BILLING_EVENTS.AI_USAGE_NOTICE_REQUESTED,
      payload: { clinicId, period, threshold, count: usage, limit },
      // Uma compra de médico adicional muda a referência no mesmo mês.
      // Limites diferentes geram avisos diferentes, sem colisão no outbox.
      idempotencyKey: `ai-usage:${clinicId}:${period}:${limit}:${threshold}`,
    });
  }
}

registerHandler<ConversationCompletedPayload>(
  AI_AGENT_EVENTS.CONVERSATION_COMPLETED,
  countConversaIa,
);
