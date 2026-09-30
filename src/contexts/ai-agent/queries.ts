/**
 * Queries de leitura do painel /conversas (ADR-047).
 *
 * Tudo aqui roda em `withTenant` — RLS é a segunda barreira, nunca a única, e
 * `dbAdmin` é proibido neste caminho (fluxo iniciado por usuário).
 *
 * A decifragem acontece SÓ aqui, no servidor, dentro do tenant autorizado, e o
 * que sai são os DTOs de types.ts — nunca a row. Os campos que não podem
 * atravessar a fronteira (patient_phone_encrypted, patient_phone_hash,
 * collected_data_encrypted com CPF, prompt_snapshot_encrypted) não são
 * sequer selecionados.
 */
import 'server-only';

import { and, desc, eq, gte, inArray, isNull, sql, type SQL } from 'drizzle-orm';

/* eslint-disable boundaries/element-types -- API pública de Messaging: só estado de entrega, sem schema. */
import { messagingApiV1 } from '@/contexts/messaging';
/* eslint-enable boundaries/element-types */

import { decryptForTenant, hashForLookup, normalizePhone } from '@/lib/crypto';
import { withTenant } from '@/lib/db/tenant';
import { maskPhone } from '@/lib/format';
import { metrics } from '@/lib/observability/metrics';

/* eslint-disable boundaries/element-types -- A listagem lê somente `nome` via LEFT JOIN para eliminar N+1; não acessa estado do domínio Patient. */
import { patients } from '@/contexts/patient';
/* eslint-enable boundaries/element-types */

import { isWindowOpen, windowClosesAt } from './internal/meta-window';
import { aiConversations, aiHandoffQueue, aiMessages } from './schema';
import type {
  AIConversationListItem,
  AIConversationListResult,
  AIConversationStatus,
  AIConversationThread,
  AIMessageAuthor,
  AIMessageDelivery,
  AIThreadMessage,
} from './types';

const PAGE_SIZE = 30;
const PREVIEW_CHARS = 90;
/** Teto de mensagens por thread. A retenção é 30d, então na prática não corta. */
const MAX_THREAD_MESSAGES = 500;

function toIso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

function preview(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= PREVIEW_CHARS ? flat : `${flat.slice(0, PREVIEW_CHARS)}…`;
}

/** Só dígitos e comprimento plausível de telefone → busca por hash. */
function looksLikePhone(term: string): boolean {
  const digits = term.replace(/\D/g, '');
  return digits.length >= 8 && digits.length === term.replace(/[\s()+-]/g, '').length;
}

export interface ListConversationsOpts {
  status?: AIConversationStatus | undefined;
  search?: string | undefined;
  page?: number | undefined;
  overdueOnly?: boolean | undefined;
}

export interface PendingHandoff {
  conversationId: string;
  createdAt: string;
  priority: 'normal' | 'urgent';
}

/**
 * Handoffs ABERTOS da clínica — os que ainda esperam um humano.
 *
 * Existe para a notificação do shell, então é deliberadamente magra: só id,
 * instante e prioridade. Nada de nome de paciente ou trecho da conversa — o
 * payload trafega a cada polling, para todo usuário com a permissão, e uma
 * notificação não precisa de PII para dizer "alguém está esperando".
 *
 * `resolvedAt IS NULL` é o mesmo predicado do dedup da fila: uma linha aberta é
 * exatamente uma espera não atendida.
 */
export async function listOpenHandoffs(clinicId: string, limit = 20): Promise<PendingHandoff[]> {
  return withTenant(clinicId, async (tx) => {
    const rows = await tx
      .select({
        conversationId: aiHandoffQueue.conversationId,
        createdAt: aiHandoffQueue.createdAt,
        priority: aiHandoffQueue.priority,
      })
      .from(aiHandoffQueue)
      .where(and(eq(aiHandoffQueue.clinicId, clinicId), isNull(aiHandoffQueue.resolvedAt)))
      .orderBy(desc(aiHandoffQueue.createdAt))
      .limit(limit);
    return rows.map((r) => ({
      conversationId: r.conversationId,
      createdAt: r.createdAt.toISOString(),
      priority: r.priority,
    }));
  });
}

/** Pulso da fila de handoff para o alerta do Dashboard. */
export interface HandoffPulse {
  /** Conversas esperando um humano agora. */
  abertos: number;
  /** Subconjunto de `abertos` cujo `dueAt` já passou (SLA vencido). */
  vencidos: number;
}

/**
 * Contagem da fila de handoff — dois inteiros, nada mais.
 *
 * Existe separada de `listOpenHandoffs` porque o alerta precisa do `dueAt` para
 * saber o que venceu, e carregar linhas só para contá-las no Node desperdiça
 * banda a cada render do Dashboard. Continua sem PII, pelo mesmo motivo.
 */
export async function countOpenHandoffs(clinicId: string): Promise<HandoffPulse> {
  return withTenant(clinicId, async (tx) => {
    const [row] = await tx
      .select({
        abertos: sql<number>`count(*)::int`,
        vencidos: sql<number>`count(*) filter (where ${aiHandoffQueue.dueAt} < now())::int`,
      })
      .from(aiHandoffQueue)
      .where(and(eq(aiHandoffQueue.clinicId, clinicId), isNull(aiHandoffQueue.resolvedAt)));
    return { abertos: row?.abertos ?? 0, vencidos: row?.vencidos ?? 0 };
  });
}

/**
 * Fila de conversas. Ordenação NÃO é preferência de UI — é a regra operacional:
 * `handoff` primeiro porque são as que esperam um humano; dentro de cada grupo,
 * a mais recente. `id` como tie-breaker garante que a paginação por offset não
 * repita nem pule linha quando dois `last_message_at` empatam.
 */
export async function listConversations(
  clinicId: string,
  opts: ListConversationsOpts = {},
): Promise<AIConversationListResult> {
  const page = Math.max(1, opts.page ?? 1);
  const offset = (page - 1) * PAGE_SIZE;

  const term = opts.search?.trim().slice(0, 64) ?? '';
  const handoffFirst = sql`(${aiConversations.status} = 'handoff') DESC`;
  const overdueFirst = sql`(${aiHandoffQueue.dueAt} < now() AND ${aiHandoffQueue.resolvedAt} IS NULL) DESC`;
  const urgentFirst = sql`(${aiHandoffQueue.priority} = 'urgent') DESC`;

  return withTenant(clinicId, async (tx) => {
    const conds: SQL[] = [eq(aiConversations.clinicId, clinicId)];
    if (opts.status) conds.push(eq(aiConversations.status, opts.status));
    if (opts.overdueOnly) {
      conds.push(eq(aiConversations.status, 'handoff'));
      conds.push(sql`${aiHandoffQueue.dueAt} < now()`);
      conds.push(isNull(aiHandoffQueue.resolvedAt));
    }

    if (term && looksLikePhone(term)) {
      // Telefone é cifrado: não dá para ILIKE. A busca é por hash determinístico
      // — o mesmo `hashForLookup` que o webhook usa ao gravar.
      conds.push(eq(aiConversations.patientPhoneHash, await hashForLookup(normalizePhone(term))));
    } else if (term) {
      const matched = await tx
        .select({ id: patients.id })
        .from(patients)
        .where(and(eq(patients.clinicId, clinicId), sql`${patients.nome} ILIKE ${`%${term}%`}`))
        .limit(200);
      // Nenhum paciente casa o termo → vazio determinístico. Sem o `false` o
      // filtro seria ignorado e a busca devolveria a lista inteira.
      conds.push(
        matched.length
          ? inArray(
              aiConversations.patientId,
              matched.map((r) => r.id),
            )
          : sql`false`,
      );
    }

    const where = and(...conds);

    const [rows, [countRow]] = await Promise.all([
      tx
        .select({
          id: aiConversations.id,
          patientId: aiConversations.patientId,
          patientName: patients.nome,
          patientPhoneEncrypted: aiConversations.patientPhoneEncrypted,
          status: aiConversations.status,
          intentAtual: aiConversations.intentAtual,
          startedAt: aiConversations.startedAt,
          lastMessageAt: aiConversations.lastMessageAt,
          assignedToUserId: aiHandoffQueue.assignedTo,
          handoffPriority: aiHandoffQueue.priority,
          handoffDueAt: aiHandoffQueue.dueAt,
        })
        .from(aiConversations)
        .leftJoin(
          aiHandoffQueue,
          and(
            eq(aiHandoffQueue.clinicId, clinicId),
            eq(aiHandoffQueue.conversationId, aiConversations.id),
            isNull(aiHandoffQueue.resolvedAt),
          ),
        )
        .leftJoin(
          patients,
          and(eq(patients.id, aiConversations.patientId), eq(patients.clinicId, clinicId)),
        )
        .where(where)
        .orderBy(
          handoffFirst,
          overdueFirst,
          urgentFirst,
          aiHandoffQueue.dueAt,
          desc(aiConversations.lastMessageAt),
          desc(aiConversations.id),
        )
        .limit(PAGE_SIZE)
        .offset(offset),
      tx
        .select({ total: sql<number>`count(*)::int` })
        .from(aiConversations)
        .leftJoin(
          aiHandoffQueue,
          and(
            eq(aiHandoffQueue.clinicId, clinicId),
            eq(aiHandoffQueue.conversationId, aiConversations.id),
            isNull(aiHandoffQueue.resolvedAt),
          ),
        )
        .where(where),
    ]);

    const conversationIds = rows.map((row) => row.id);
    const earliestConversationStart = rows.reduce<Date | null>(
      (earliest, row) => (!earliest || row.startedAt < earliest ? row.startedAt : earliest),
      null,
    );
    // UMA varredura em `ai_messages`, não duas.
    //
    // Eram dois `DISTINCT ON` sobre a mesma tabela particionada, com o mesmo
    // predicado, um esperando o outro: a última mensagem (preview) e o último
    // INBOUND (janela da Meta). Numa transação isso custa dois tempos — uma
    // transação é UMA conexão, e o Postgres atende um statement por vez.
    //
    // A janela da Meta continua contando do último INBOUND, não da última
    // mensagem (responder não reabre nada): o `FILTER` faz essa distinção dentro
    // da mesma passada. Combinar é legítimo porque funções de janela são
    // avaliadas ANTES do DISTINCT ON — a janela enxerga todas as linhas da
    // conversa, e só depois o DISTINCT ON escolhe a mais recente.
    const resumoPorConversa =
      conversationIds.length > 0 && earliestConversationStart
        ? await tx
            .selectDistinctOn([aiMessages.conversationId], {
              conversationId: aiMessages.conversationId,
              contentEncrypted: aiMessages.contentEncrypted,
              // EPOCH, não o timestamp cru: numa coluna CALCULADA o driver não
              // aplica o mapeamento de tipo que aplicaria numa coluna conhecida,
              // e o valor chegava como string — `isWindowOpen` quebrava com
              // "lastInboundAt.getTime is not a function". Milissegundos desde a
              // época não têm ambiguidade de fuso nem de formato.
              lastInboundEpochMs: sql<
                string | null
              >`extract(epoch from max(${aiMessages.createdAt}) FILTER (WHERE ${aiMessages.direction} = 'in') OVER (PARTITION BY ${aiMessages.conversationId})) * 1000`,
            })
            .from(aiMessages)
            .where(
              and(
                eq(aiMessages.clinicId, clinicId),
                inArray(aiMessages.conversationId, conversationIds),
                // Poda de partição: a conversa mais antiga determina o menor
                // intervalo que pode conter uma mensagem desta página.
                gte(aiMessages.createdAt, earliestConversationStart),
              ),
            )
            .orderBy(aiMessages.conversationId, desc(aiMessages.createdAt))
        : [];
    const lastMessageByConversation = new Map(
      resumoPorConversa.map((message) => [message.conversationId, message.contentEncrypted]),
    );
    const lastInboundByConversation = new Map(
      resumoPorConversa.map((message) => [
        message.conversationId,
        message.lastInboundEpochMs == null ? null : new Date(Number(message.lastInboundEpochMs)),
      ]),
    );
    const agora = new Date();

    const items = await Promise.all(
      rows.map(async (r): Promise<AIConversationListItem> => {
        const nome = r.patientName ?? null;
        const contactPhone = await decryptForTenant(clinicId, r.patientPhoneEncrypted);
        const lastMessage = lastMessageByConversation.get(r.id);
        return {
          id: r.id,
          patientDisplayName: nome,
          // Preserva o fallback mascarado; a UI autorizada usa o contato separado.
          maskedPhone: nome ? null : maskPhone(contactPhone),
          contactPhone: contactPhone || null,
          lastMessagePreview: lastMessage
            ? preview(await decryptForTenant(clinicId, lastMessage))
            : null,
          status: r.status,
          lastMessageAt: toIso(r.lastMessageAt)!,
          intentAtual: r.intentAtual,
          windowOpen: isWindowOpen(lastInboundByConversation.get(r.id) ?? null, agora),
          handoff:
            r.status === 'handoff' && r.handoffDueAt && r.handoffPriority
              ? {
                  assignedToUserId: r.assignedToUserId ?? null,
                  priority: r.handoffPriority,
                  dueAt: toIso(r.handoffDueAt)!,
                  overdue: r.handoffDueAt.getTime() < Date.now(),
                }
              : null,
        };
      }),
    );

    metrics.emit('ai_agent.conversations.listed', {
      clinicId,
      count: items.length,
      page,
      filtered: Boolean(opts.status || term),
    });

    return { items, total: countRow?.total ?? 0, page, pageSize: PAGE_SIZE };
  });
}

/**
 * Predicado padrão de leitura de `ai_messages`.
 *
 * O `gte(createdAt, startedAt)` NÃO é filtro de negócio — é PODA DE PARTIÇÃO.
 * `ai_messages` é particionada por mês em `created_at`; sem um predicado nessa
 * coluna o planner varre as 13 partições para achar as ~20 linhas de uma
 * conversa.
 *
 * INVARIANTE DE QUE ISTO DEPENDE: nenhuma mensagem da conversa é anterior ao
 * `started_at` dela. Verificado (2026-07-20): `started_at` só é escrito pelo
 * DEFAULT da coluna — nada no código o atualiza, e conversa "reaberta" é linha
 * NOVA (a unique parcial só cobre status='active'). Se algum backfill/import
 * futuro inserir mensagem anterior ao started_at, esta poda ESCONDE histórico
 * silenciosamente. O smoke tem uma asserção guardando essa invariante.
 */
function partitionScopedConversation(
  clinicId: string,
  conversationId: string,
  startedAt: Date,
): SQL {
  return and(
    eq(aiMessages.clinicId, clinicId),
    eq(aiMessages.conversationId, conversationId),
    gte(aiMessages.createdAt, startedAt),
  )!;
}

/**
 * Thread completa, decifrada, em ordem cronológica. `null` quando a conversa não
 * existe OU pertence a outra clínica (RLS já não a devolve — o null não
 * distingue os dois casos de propósito).
 */
export async function getConversationThread(
  clinicId: string,
  conversationId: string,
): Promise<AIConversationThread | null> {
  return withTenant(clinicId, async (tx) => {
    // TRÊS queries, não cinco. A fila de handoff e o nome do paciente saíam de
    // SELECTs próprios, cada um esperando o anterior — e a listagem ao lado já
    // resolvia os dois por LEFT JOIN. Aqui é o mesmo JOIN, pelo mesmo motivo.
    const [conv] = await tx
      .select({
        id: aiConversations.id,
        patientId: aiConversations.patientId,
        patientName: patients.nome,
        patientPhoneEncrypted: aiConversations.patientPhoneEncrypted,
        status: aiConversations.status,
        intentAtual: aiConversations.intentAtual,
        startedAt: aiConversations.startedAt,
        lastMessageAt: aiConversations.lastMessageAt,
        assignedToUserId: aiHandoffQueue.assignedTo,
        handoffPriority: aiHandoffQueue.priority,
        handoffDueAt: aiHandoffQueue.dueAt,
      })
      .from(aiConversations)
      .leftJoin(
        aiHandoffQueue,
        and(
          eq(aiHandoffQueue.clinicId, clinicId),
          eq(aiHandoffQueue.conversationId, aiConversations.id),
          isNull(aiHandoffQueue.resolvedAt),
        ),
      )
      .leftJoin(
        patients,
        and(eq(patients.id, aiConversations.patientId), eq(patients.clinicId, clinicId)),
      )
      .where(and(eq(aiConversations.id, conversationId), eq(aiConversations.clinicId, clinicId)))
      .limit(1);
    if (!conv) return null;

    const rows = await tx
      .select({
        id: aiMessages.id,
        direction: aiMessages.direction,
        contentEncrypted: aiMessages.contentEncrypted,
        intent: aiMessages.intent,
        toolCalls: aiMessages.toolCalls,
        model: aiMessages.model,
        latencyMs: aiMessages.latencyMs,
        costUsd: aiMessages.costUsd,
        eventId: aiMessages.eventId,
        sentByUserId: aiMessages.sentByUserId,
        sentViaBusinessApp: aiMessages.sentViaBusinessApp,
        createdAt: aiMessages.createdAt,
      })
      .from(aiMessages)
      .where(partitionScopedConversation(clinicId, conversationId, conv.startedAt))
      .orderBy(aiMessages.createdAt)
      .limit(MAX_THREAD_MESSAGES);

    // Mesma condição de antes, agora sobre o que o JOIN trouxe: só conversa em
    // `handoff` expõe a fila, e a linha precisa existir — o LEFT JOIN devolve
    // nulos quando ela já foi resolvida.
    const handoffRow =
      conv.status === 'handoff' && conv.handoffDueAt && conv.handoffPriority
        ? {
            assignedToUserId: conv.assignedToUserId,
            priority: conv.handoffPriority,
            dueAt: conv.handoffDueAt,
          }
        : null;

    // Estado de entrega só das mensagens humanas — as do agente já foram
    // enviadas de forma síncrona no próprio turno.
    const manualKeys = rows.filter((r) => r.sentByUserId && r.eventId).map((r) => r.eventId!);
    const delivery = await messagingApiV1.getOutboundStatuses(tx, clinicId, manualKeys);

    const messages = await Promise.all(
      rows.map(async (r): Promise<AIThreadMessage> => {
        // Sem o `sentViaBusinessApp`, a resposta da recepção pelo celular
        // cairia no último ramo e apareceria assinada pela IA.
        const author: AIMessageAuthor =
          r.direction === 'in'
            ? 'patient'
            : r.sentByUserId
              ? 'human'
              : r.sentViaBusinessApp
                ? 'business_app'
                : 'agent';
        return {
          id: r.id,
          direction: r.direction,
          author,
          text: await decryptForTenant(clinicId, r.contentEncrypted),
          createdAt: toIso(r.createdAt)!,
          meta:
            author === 'agent'
              ? {
                  intent: r.intent,
                  toolCalls: r.toolCalls,
                  model: r.model,
                  latencyMs: r.latencyMs,
                  costUsd: r.costUsd === null ? null : Number(r.costUsd),
                }
              : null,
          delivery: author === 'human' ? toDelivery(delivery.get(r.eventId!)) : null,
        };
      }),
    );

    const lastInboundAt = [...rows].reverse().find((r) => r.direction === 'in')?.createdAt ?? null;
    const now = new Date();
    const nome = conv.patientName ?? null;
    const contactPhone = await decryptForTenant(clinicId, conv.patientPhoneEncrypted);

    metrics.emit('ai_agent.conversation.opened', {
      clinicId,
      conversationId,
      status: conv.status,
      messageCount: messages.length,
    });

    return {
      id: conv.id,
      patientDisplayName: nome,
      maskedPhone: maskPhone(contactPhone),
      contactPhone: contactPhone || null,
      status: conv.status,
      intentAtual: conv.intentAtual,
      startedAt: toIso(conv.startedAt)!,
      lastMessageAt: toIso(conv.lastMessageAt)!,
      messages,
      handoff: handoffRow
        ? {
            assignedToUserId: handoffRow.assignedToUserId ?? null,
            priority: handoffRow.priority,
            dueAt: toIso(handoffRow.dueAt)!,
            overdue: handoffRow.dueAt.getTime() < now.getTime(),
          }
        : null,
      window: {
        open: isWindowOpen(lastInboundAt, now),
        lastInboundAt: toIso(lastInboundAt),
        closesAt: toIso(windowClosesAt(lastInboundAt, now)),
      },
    };
  });
}

/**
 * Chave ausente = evento publicado, worker ainda não enviou. 'unknown' vem do
 * provider sem resposta conclusiva — tratado como pendente, não como entregue.
 */
function toDelivery(status: string | undefined): AIMessageDelivery {
  if (status === 'accepted' || status === 'sent') return 'sent';
  if (status === 'delivered') return 'delivered';
  if (status === 'read') return 'read';
  if (status === 'failed') return 'failed';
  return 'pending';
}
