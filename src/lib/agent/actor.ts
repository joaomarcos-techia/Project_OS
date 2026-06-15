/**
 * AI Agent actor (C12) — identidade ESTÁVEL do agente para mutações no worker.
 *
 * R6: o agente NÃO usa conversationId como identidade (conversa é contexto, não
 * identidade). A identidade é o `actorType:'ai_agent'` (state-log) + `userId
 * null` (sem usuário humano). O rastro por-turno (eventId/aiRequestId) vai no
 * RequestContext (correlationId/requestId), separado da identidade.
 *
 * O conteúdo destas funções é a ÚNICA forma de um caminho de agente montar o
 * ator de sistema passado aos cores de mutação (scheduling/patient).
 */
import { createHash } from 'node:crypto';

import { buildAgentRequestContext } from '@/lib/audit/request-context';
import type { RequestContext } from '@/lib/audit/types';
import type { MutationActor } from '@/lib/idempotency/mutation';

export interface AgentActorCtx {
  clinicId: string;
  /** eventId do inbound (correlationId cross-context). */
  eventId: string;
  /** aiRequestId do turno (requestId / R7). */
  aiRequestId: string;
}

/** Ator de sistema: clinicId do turno + userId null (sem humano). */
export function agentMutationActor(ctx: AgentActorCtx): MutationActor {
  return { clinicId: ctx.clinicId, userId: null };
}

/** RequestContext sintético para audit das mutações do agente. */
export function agentRequestContext(ctx: AgentActorCtx): RequestContext {
  return buildAgentRequestContext({ requestId: ctx.aiRequestId, correlationId: ctx.eventId });
}

/**
 * R1 — chave de idempotência DERIVADA POR CONTEÚDO (não por eventId). Mesma
 * operação lógica (conversa + intent + args) → mesma chave, mesmo que webhook
 * reentregue / worker retente / Gemini dê timeout com eventId diferente. Hex
 * sha256 satisfaz o formato `^[a-f0-9]{8,}$` do idemKey() dos contextos.
 */
export function agentIdemKey(conversationId: string, intent: string, args: unknown): string {
  return createHash('sha256')
    .update(`${conversationId}|${intent}|${JSON.stringify(args ?? null)}`)
    .digest('hex');
}
