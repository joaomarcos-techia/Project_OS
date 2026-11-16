/**
 * ConversationsRepository (C15) — conversas de IA no console da plataforma.
 * Único ponto que toca dbAdmin para esta área (review #5/#13).
 *
 * S-01 / ADR-073: este repositório NÃO decifra nada.
 *   - `list` e `getMetadata` devolvem só metadado (nenhum texto, nenhum ciphertext).
 *   - `findContentRowsTx` devolve as linhas com `content_encrypted` DENTRO da tx
 *     do leitor auditado (`_lib/conversation-content.ts`), o único que decifra e
 *     o único que pode chamá-lo — trava estática em `conversation-content.test.ts`.
 *
 * Server-only.
 */
import 'server-only';

import { and, asc, desc, eq, gte, ilike, inArray, lte, sql, type SQL } from 'drizzle-orm';

import { aiConversations, aiMessages } from '@/contexts/ai-agent/schema';
import { clinics } from '@/contexts/tenancy/schema';
import { dbAdmin, type Tx } from '@/lib/db';

import type {
  AiMessageAuthorDTO,
  AiMessageMetaDTO,
  ConversationListItemDTO,
  ConversationMetadataDTO,
} from '../dto';

const iso = (v: Date | string): string =>
  v instanceof Date ? v.toISOString() : new Date(v).toISOString();

/** Teto por abertura (mesmo de antes do S-01). */
const MAX_MESSAGES = 500;
const MAX_TOOL_NAMES = 10;
const MAX_TOOL_NAME_CHARS = 64;

export interface ConversationListQuery {
  clinicId?: string | undefined;
  from?: string | undefined; // ISO
  to?: string | undefined; // ISO
  search?: string | undefined;
  page?: number | undefined;
  pageSize?: number | undefined;
}

/** Colunas de metadado de mensagem — nenhuma delas é texto do paciente. */
const messageMetaColumns = {
  id: aiMessages.id,
  direction: aiMessages.direction,
  sentByUserId: aiMessages.sentByUserId,
  sentViaBusinessApp: aiMessages.sentViaBusinessApp,
  intent: aiMessages.intent,
  toolCalls: aiMessages.toolCalls,
  model: aiMessages.model,
  latencyMs: aiMessages.latencyMs,
  createdAt: aiMessages.createdAt,
};

export interface MessageMetaRow {
  id: string;
  direction: 'in' | 'out';
  sentByUserId: string | null;
  sentViaBusinessApp: boolean;
  intent: string | null;
  toolCalls: unknown;
  model: string | null;
  latencyMs: number | null;
  createdAt: Date | string;
}

export interface ContentRow extends MessageMetaRow {
  contentEncrypted: string;
}

interface ConversationHeadRow {
  id: string;
  status: string;
  clinicNome: string;
}

/**
 * Mesma regra do painel da clínica (ADR-047): autoria vem de `sent_by_user_id`
 * e `sent_via_business_app`, nunca de `model IS NULL`.
 */
function authorOf(r: Pick<MessageMetaRow, 'direction' | 'sentByUserId' | 'sentViaBusinessApp'>) {
  const author: AiMessageAuthorDTO =
    r.direction === 'in'
      ? 'patient'
      : r.sentByUserId
        ? 'human'
        : r.sentViaBusinessApp
          ? 'business_app'
          : 'agent';
  return author;
}

/**
 * Só o NOME de cada tool. `tool_calls` guarda uma whitelist (F-16), mas nem ela
 * aparece no console: argumentos não são metadado de depuração do agente.
 */
function toolNamesOf(toolCalls: unknown): string[] {
  if (!Array.isArray(toolCalls)) return [];
  const names: string[] = [];
  for (const call of toolCalls) {
    const name = (call as { name?: unknown } | null)?.name;
    if (typeof name === 'string' && name.length > 0) names.push(name.slice(0, MAX_TOOL_NAME_CHARS));
    if (names.length >= MAX_TOOL_NAMES) break;
  }
  return names;
}

/** Projeção de metadado. Recebe a linha com ou sem ciphertext e nunca o copia. */
export function toMessageMeta(r: MessageMetaRow): AiMessageMetaDTO {
  return {
    id: r.id,
    direction: r.direction,
    author: authorOf(r),
    intent: r.intent ?? null,
    toolNames: toolNamesOf(r.toolCalls),
    model: r.model ?? null,
    latencyMs: r.latencyMs ?? null,
    createdAt: iso(r.createdAt),
  };
}

export class ConversationsRepository {
  async list(q: ConversationListQuery): Promise<ConversationListItemDTO[]> {
    const pageSize = Math.min(Math.max(q.pageSize ?? 30, 1), 100);
    const offset = (Math.max(1, q.page ?? 1) - 1) * pageSize;

    const conds: SQL[] = [];
    if (q.clinicId) conds.push(eq(aiConversations.clinicId, q.clinicId));
    if (q.from) conds.push(gte(aiConversations.lastMessageAt, sql`${q.from}::timestamptz`));
    if (q.to) conds.push(lte(aiConversations.lastMessageAt, sql`${q.to}::timestamptz`));
    if (q.search) {
      conds.push(ilike(aiConversations.intentAtual, `%${q.search.trim().slice(0, 64)}%`) as SQL);
    }

    const rows = await dbAdmin
      .select({
        id: aiConversations.id,
        clinicId: aiConversations.clinicId,
        clinicNome: clinics.nome,
        status: aiConversations.status,
        lastMessageAt: aiConversations.lastMessageAt,
      })
      .from(aiConversations)
      .innerJoin(clinics, eq(clinics.id, aiConversations.clinicId))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(aiConversations.lastMessageAt))
      .limit(pageSize)
      .offset(offset);

    // Contagem de mensagens: UMA query agregada para os ids da página (filtra por
    // clinic_id + conversation_id → usa o índice; evita COUNT correlacionado por
    // linha sobre a ai_messages particionada).
    const convIds = rows.map((r) => r.id);
    const clinicIds = [...new Set(rows.map((r) => r.clinicId))];
    const counts = new Map<string, number>();
    if (convIds.length > 0) {
      const c = await dbAdmin
        .select({ conversationId: aiMessages.conversationId, n: sql<number>`(COUNT(*))::int` })
        .from(aiMessages)
        .where(
          and(inArray(aiMessages.clinicId, clinicIds), inArray(aiMessages.conversationId, convIds)),
        )
        .groupBy(aiMessages.conversationId);
      for (const x of c) counts.set(x.conversationId, Number(x.n) || 0);
    }

    return rows.map((r) => ({
      id: r.id,
      clinicId: r.clinicId,
      clinicNome: r.clinicNome,
      status: r.status,
      lastMessageAt: iso(r.lastMessageAt),
      messageCount: counts.get(r.id) ?? 0,
    }));
  }

  /**
   * Conversa SEM texto: o que o console mostra fora de sessão de suporte.
   * `null` quando a conversa não existe nessa clínica (conversa e clínica
   * precisam bater — ids trocados não devolvem nada).
   */
  async getMetadata(
    clinicId: string,
    conversationId: string,
  ): Promise<ConversationMetadataDTO | null> {
    const [conv] = await selectHead(dbAdmin, clinicId, conversationId);
    if (!conv) return null;

    const rows = await dbAdmin
      .select(messageMetaColumns)
      .from(aiMessages)
      .where(and(eq(aiMessages.clinicId, clinicId), eq(aiMessages.conversationId, conversationId)))
      .orderBy(asc(aiMessages.createdAt))
      .limit(MAX_MESSAGES);

    return {
      id: conv.id,
      clinicId,
      clinicNome: conv.clinicNome,
      status: conv.status,
      messages: rows.map(toMessageMeta),
    };
  }

  /**
   * Linhas COM ciphertext, dentro da tx do leitor auditado. Não decifra.
   * Só `_lib/conversation-content.ts` pode chamar (trava estática).
   */
  async findContentRowsTx(
    tx: Tx,
    clinicId: string,
    conversationId: string,
  ): Promise<{ conversation: ConversationHeadRow; rows: ContentRow[] } | null> {
    const [conv] = await selectHead(tx, clinicId, conversationId);
    if (!conv) return null;

    const rows = await tx
      .select({ ...messageMetaColumns, contentEncrypted: aiMessages.contentEncrypted })
      .from(aiMessages)
      .where(and(eq(aiMessages.clinicId, clinicId), eq(aiMessages.conversationId, conversationId)))
      .orderBy(asc(aiMessages.createdAt))
      .limit(MAX_MESSAGES);

    return { conversation: conv, rows };
  }
}

/** Cabeçalho da conversa, amarrado à clínica (`id` E `clinic_id`). Serve ao pool e à tx. */
function selectHead(
  q: Pick<Tx, 'select'>,
  clinicId: string,
  conversationId: string,
): Promise<ConversationHeadRow[]> {
  return q
    .select({
      id: aiConversations.id,
      status: aiConversations.status,
      clinicNome: clinics.nome,
    })
    .from(aiConversations)
    .innerJoin(clinics, eq(clinics.id, aiConversations.clinicId))
    .where(and(eq(aiConversations.id, conversationId), eq(aiConversations.clinicId, clinicId)))
    .limit(1);
}

export const conversationsRepository = new ConversationsRepository();
