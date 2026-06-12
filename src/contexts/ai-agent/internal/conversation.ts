/**
 * Persistência de conversas/mensagens do agente (C11) — helpers tx-aware.
 *
 * Todas as funções recebem `tx` (withTenant — RLS aplicada) e são idempotentes
 * sob re-entrada da saga (R2): upsert por unique parcial, SELECT-before-INSERT
 * por event_id, COALESCE em marcadores.
 *
 * Isolamento de conversa (contrato C11): NENHUM estado de módulo, NENHUM cache
 * compartilhado — tudo deriva do tx tenant-scoped. Duas clínicas/dois pacientes
 * são 100% isolados por RLS + chave AES per-tenant.
 */
import { and, desc, eq, sql } from 'drizzle-orm';

import { decryptForTenant, encryptForTenant } from '@/lib/crypto';
import type { Tx } from '@/lib/db';
import { metrics } from '@/lib/observability/metrics';

/* eslint-disable boundaries/element-types -- patients é superfície PÚBLICA do Patient (re-exportada em @/contexts/patient/index); mesma exceção do suppressionList no sender C10. Leitura por hash, sem JOIN. */
import { patients } from '@/contexts/patient';
/* eslint-enable boundaries/element-types */

import { MAX_FALLBACKS } from '../limits';
import { aiConversations, aiHandoffQueue, aiMessages, type AiMessageRow } from '../schema';
import type { PromptHistoryEntry } from '../types';

// --- conversa -----------------------------------------------------------------

export interface ActiveConversation {
  id: string;
  patientId: string | null;
  patientNome: string | null;
  status: 'active' | 'handoff' | 'closed' | 'abandoned';
  fallbackCount: number;
}

/**
 * Localiza (ou cria) a conversa ATIVA do contato. Idempotente pela unique
 * parcial (clinic_id, patient_phone_hash) WHERE status='active'. Identifica o
 * paciente pelo MESMO hash de telefone do cadastro (patients.telefone_hash).
 * Conversas em 'handoff' também são retornadas (o humano está atendendo; o
 * agente persiste o inbound mas não responde — decisão de C11).
 */
export async function findOrCreateConversation(
  tx: Tx,
  clinicId: string,
  phoneHash: string,
  phoneEncrypted: string,
): Promise<ActiveConversation> {
  // Paciente cadastrado com este telefone? (leitura por hash, sem JOIN)
  const [patient] = await tx
    .select({ id: patients.id, nome: patients.nome })
    .from(patients)
    .where(and(eq(patients.clinicId, clinicId), eq(patients.telefoneHash, phoneHash)))
    .limit(1);

  // Conversa não-encerrada mais recente do contato (active OU handoff).
  const [existing] = await tx
    .select()
    .from(aiConversations)
    .where(
      and(
        eq(aiConversations.clinicId, clinicId),
        eq(aiConversations.patientPhoneHash, phoneHash),
        sql`${aiConversations.status} IN ('active', 'handoff')`,
      ),
    )
    .orderBy(desc(aiConversations.lastMessageAt))
    .limit(1);

  if (existing) {
    await tx
      .update(aiConversations)
      .set({
        lastMessageAt: sql`now()`,
        // Backfill do patient_id se o paciente foi cadastrado depois da 1ª mensagem.
        ...(existing.patientId === null && patient ? { patientId: patient.id } : {}),
      })
      .where(eq(aiConversations.id, existing.id));
    return {
      id: existing.id,
      patientId: existing.patientId ?? patient?.id ?? null,
      patientNome: patient?.nome ?? null,
      status: existing.status,
      fallbackCount: existing.fallbackCount,
    };
  }

  const [created] = await tx
    .insert(aiConversations)
    .values({
      clinicId,
      patientId: patient?.id ?? null,
      patientPhoneHash: phoneHash,
      patientPhoneEncrypted: phoneEncrypted,
    })
    .onConflictDoNothing({
      target: [aiConversations.clinicId, aiConversations.patientPhoneHash],
      where: sql`status = 'active'`,
    })
    .returning();

  if (created) {
    return {
      id: created.id,
      patientId: created.patientId,
      patientNome: patient?.nome ?? null,
      status: created.status,
      fallbackCount: created.fallbackCount,
    };
  }

  // Corrida perdida (outra execução criou) — relê a ativa.
  const [raced] = await tx
    .select()
    .from(aiConversations)
    .where(
      and(
        eq(aiConversations.clinicId, clinicId),
        eq(aiConversations.patientPhoneHash, phoneHash),
        eq(aiConversations.status, 'active'),
      ),
    )
    .limit(1);
  if (!raced) throw new Error('[ai-agent] upsert de conversa falhou sem ativa existente');
  return {
    id: raced.id,
    patientId: raced.patientId,
    patientNome: patient?.nome ?? null,
    status: raced.status,
    fallbackCount: raced.fallbackCount,
  };
}

// --- mensagens ------------------------------------------------------------------

/** Checkpoint da saga: mensagens deste turno (event_id) já persistidas? */
export async function findTurnMessages(
  tx: Tx,
  clinicId: string,
  eventId: string,
): Promise<{ inRow: AiMessageRow | null; outRow: AiMessageRow | null }> {
  const rows = await tx
    .select()
    .from(aiMessages)
    .where(and(eq(aiMessages.clinicId, clinicId), eq(aiMessages.eventId, eventId)));
  return {
    inRow: rows.find((r) => r.direction === 'in') ?? null,
    outRow: rows.find((r) => r.direction === 'out') ?? null,
  };
}

export async function appendInboundMessage(
  tx: Tx,
  args: { clinicId: string; conversationId: string; eventId: string; text: string },
): Promise<void> {
  await tx.insert(aiMessages).values({
    clinicId: args.clinicId,
    conversationId: args.conversationId,
    direction: 'in',
    contentEncrypted: await encryptForTenant(args.clinicId, args.text),
    eventId: args.eventId,
  });
}

export interface OutboundMessageArgs {
  clinicId: string;
  conversationId: string;
  eventId: string;
  aiRequestId: string;
  text: string;
  intent?: string | null | undefined;
  toolCalls?: unknown;
  tokensInput?: number | undefined;
  tokensOutput?: number | undefined;
  costUsd?: number | undefined;
  model?: string | null | undefined;
  latencyMs?: number | undefined;
  promptVersion?: string | undefined;
  promptHash?: string | undefined;
  promptSnapshotEncrypted?: string | null | undefined;
}

/**
 * Persiste a resposta do turno com cost tracking (recordCost embutido: tokens,
 * USD, modelo, latência — congelado tokens × $/1M) + versionamento de prompt
 * (G8/R6) + snapshot (G10) + trace (R7).
 */
export async function appendOutboundMessage(tx: Tx, args: OutboundMessageArgs): Promise<void> {
  await tx.insert(aiMessages).values({
    clinicId: args.clinicId,
    conversationId: args.conversationId,
    direction: 'out',
    contentEncrypted: await encryptForTenant(args.clinicId, args.text),
    intent: args.intent ?? null,
    toolCalls: args.toolCalls ?? null,
    tokensInput: args.tokensInput ?? null,
    tokensOutput: args.tokensOutput ?? null,
    costUsd: args.costUsd !== undefined ? args.costUsd.toFixed(6) : null,
    model: args.model ?? null,
    latencyMs: args.latencyMs ?? null,
    eventId: args.eventId,
    promptVersion: args.promptVersion ?? null,
    promptHash: args.promptHash ?? null,
    promptSnapshotEncrypted: args.promptSnapshotEncrypted ?? null,
    aiRequestId: args.aiRequestId,
  });
  metrics.emit('ai_agent.cost', {
    clinicId: args.clinicId,
    conversationId: args.conversationId,
    aiRequestId: args.aiRequestId,
    tokensInput: args.tokensInput ?? 0,
    tokensOutput: args.tokensOutput ?? 0,
    costUsd: args.costUsd ?? 0,
    model: args.model ?? 'none',
  });
}

/**
 * Últimas N mensagens DECIFRADAS, ordem cronológica (janela de memória G2).
 * `excludeEventId` tira o turno CORRENTE da janela (a mensagem 'in' já foi
 * persistida na FASE A; sem isto ela entraria duplicada no prompt).
 */
export async function getRecentMessages(
  tx: Tx,
  clinicId: string,
  conversationId: string,
  limit: number,
  excludeEventId?: string,
): Promise<PromptHistoryEntry[]> {
  const rows = await tx
    .select({
      direction: aiMessages.direction,
      contentEncrypted: aiMessages.contentEncrypted,
    })
    .from(aiMessages)
    .where(
      and(
        eq(aiMessages.clinicId, clinicId),
        eq(aiMessages.conversationId, conversationId),
        ...(excludeEventId
          ? [sql`${aiMessages.eventId} IS DISTINCT FROM ${excludeEventId}`]
          : []),
      ),
    )
    .orderBy(desc(aiMessages.createdAt))
    .limit(limit);

  const chronological = rows.reverse();
  return Promise.all(
    chronological.map(async (r) => ({
      direction: r.direction,
      text: await decryptForTenant(clinicId, r.contentEncrypted),
    })),
  );
}

// --- handoff / fallback (R3) -------------------------------------------------------

/**
 * Escala a conversa para humano: status='handoff' + entrada na fila (dedup
 * pela unique parcial de handoff aberto). Usada pela tool request_human_handoff
 * e pela política automática de MAX_FALLBACKS.
 */
export async function escalateToHuman(
  tx: Tx,
  clinicId: string,
  conversationId: string,
  reason: string,
): Promise<void> {
  await tx
    .insert(aiHandoffQueue)
    .values({ clinicId, conversationId, reason })
    .onConflictDoNothing({
      target: [aiHandoffQueue.conversationId],
      where: sql`resolved_at IS NULL`,
    });
  await tx
    .update(aiConversations)
    .set({ status: 'handoff' })
    .where(and(eq(aiConversations.id, conversationId), eq(aiConversations.clinicId, clinicId)));
  metrics.emit('ai_agent.handoff.created', { clinicId, conversationId, reason });
}

/**
 * R3 — incrementa fallback_count; ao atingir MAX_FALLBACKS escala
 * automaticamente (reason 'fallback_threshold'). Retorna o novo count e se
 * escalou neste incremento.
 */
export async function incrementFallback(
  tx: Tx,
  clinicId: string,
  conversationId: string,
): Promise<{ fallbackCount: number; escalated: boolean }> {
  const [row] = await tx
    .update(aiConversations)
    .set({ fallbackCount: sql`${aiConversations.fallbackCount} + 1` })
    .where(and(eq(aiConversations.id, conversationId), eq(aiConversations.clinicId, clinicId)))
    .returning({ fallbackCount: aiConversations.fallbackCount });
  const fallbackCount = row?.fallbackCount ?? 0;
  if (fallbackCount >= MAX_FALLBACKS) {
    await escalateToHuman(tx, clinicId, conversationId, 'fallback_threshold');
    return { fallbackCount, escalated: true };
  }
  return { fallbackCount, escalated: false };
}
