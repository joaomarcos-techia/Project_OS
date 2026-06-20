/**
 * ConversationsRepository (C15) — conversas de IA, DESCRIPTOGRAFADAS SERVER-SIDE.
 * Único ponto que toca dbAdmin para esta área (review #5/#13).
 *
 * OR-D1: o ciphertext NUNCA sai do servidor. `getDetail` decifra cada mensagem
 * com `decryptForTenant(clinicId, content_encrypted)` e devolve só plaintext.
 * Se a decifragem falhar, devolvemos um placeholder e seguimos (nunca vaza o
 * ciphertext; nunca derruba a tela) — edge case do plano §6.
 *
 * Server-only.
 */
import 'server-only';

import { and, asc, desc, eq, gte, ilike, lte, sql, type SQL } from 'drizzle-orm';

import { aiConversations, aiMessages } from '@/contexts/ai-agent/schema';
import { clinics } from '@/contexts/tenancy/schema';
import { dbAdmin } from '@/lib/db';
import { decryptForTenant } from '@/lib/crypto';

import type { AiMessageDTO, ConversationDetailDTO, ConversationListItemDTO } from '../dto';

const iso = (v: Date | string): string =>
  v instanceof Date ? v.toISOString() : new Date(v).toISOString();

export interface ConversationListQuery {
  clinicId?: string | undefined;
  from?: string | undefined; // ISO
  to?: string | undefined; // ISO
  search?: string | undefined;
  page?: number | undefined;
  pageSize?: number | undefined;
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
        messageCount: sql<number>`(SELECT COUNT(*) FROM ai_messages m WHERE m.conversation_id = ${aiConversations.id})::int`,
      })
      .from(aiConversations)
      .innerJoin(clinics, eq(clinics.id, aiConversations.clinicId))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(aiConversations.lastMessageAt))
      .limit(pageSize)
      .offset(offset);

    return rows.map((r) => ({
      id: r.id,
      clinicId: r.clinicId,
      clinicNome: r.clinicNome,
      status: r.status,
      lastMessageAt: iso(r.lastMessageAt),
      messageCount: Number(r.messageCount) || 0,
    }));
  }

  async getDetail(clinicId: string, conversationId: string): Promise<ConversationDetailDTO | null> {
    const [conv] = await dbAdmin
      .select({
        id: aiConversations.id,
        status: aiConversations.status,
        clinicNome: clinics.nome,
      })
      .from(aiConversations)
      .innerJoin(clinics, eq(clinics.id, aiConversations.clinicId))
      .where(and(eq(aiConversations.id, conversationId), eq(aiConversations.clinicId, clinicId)))
      .limit(1);
    if (!conv) return null;

    const rows = await dbAdmin
      .select({
        id: aiMessages.id,
        direction: aiMessages.direction,
        contentEncrypted: aiMessages.contentEncrypted,
        model: aiMessages.model,
        createdAt: aiMessages.createdAt,
      })
      .from(aiMessages)
      .where(and(eq(aiMessages.clinicId, clinicId), eq(aiMessages.conversationId, conversationId)))
      .orderBy(asc(aiMessages.createdAt))
      .limit(500);

    const messages: AiMessageDTO[] = await Promise.all(
      rows.map(async (r) => {
        let text: string;
        try {
          text = await decryptForTenant(clinicId, r.contentEncrypted);
        } catch {
          // OR-D1: nunca expõe ciphertext; degrada para placeholder.
          text = '[conteúdo indisponível]';
        }
        return {
          id: r.id,
          direction: r.direction,
          text,
          model: r.model ?? null,
          createdAt: iso(r.createdAt),
        };
      }),
    );

    return { id: conv.id, clinicNome: conv.clinicNome, status: conv.status, messages };
  }
}

export const conversationsRepository = new ConversationsRepository();
