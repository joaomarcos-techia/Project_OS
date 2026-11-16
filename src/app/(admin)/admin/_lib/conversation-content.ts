/**
 * Abertura de conversa da IA no console da plataforma (S-01, ADR-073).
 *
 * ===================================================================
 * Regra
 * ===================================================================
 * O console mostra METADADO de qualquer conversa (autor, horário, intent,
 * tools, modelo, latência). O TEXTO só sai quando o super_admin está numa
 * sessão de suporte ativa PARA A MESMA CLÍNICA — a mesma sessão que já exige
 * TOTP no início, dura 1 h, é uma por vez e pode ser revogada
 * (`actions/impersonation.ts`, `src/lib/impersonation`).
 *
 * Cada abertura de texto grava `ai_conversation.content_viewed` em
 * `super_admin_actions` NA MESMA TRANSAÇÃO da leitura (`superAdminAuditedRead`).
 * Se o INSERT falhar, a leitura falha junto e o texto não sai daqui.
 *
 * Decisões:
 *  1. A SESSÃO vem de `requireUser()` (cookie assinado + linha ativa em
 *     `impersonation_sessions`, resolvidos por request), nunca de argumento.
 *  2. O evento leva só metadado: conversa, sessão, tela, contagens e
 *     `requestId`. Nunca texto, telefone, nome nem ciphertext.
 *  3. Conversa inexistente (ou de outra clínica) não grava nada: a trilha
 *     registra leitura que aconteceu.
 *  4. Sem sessão para a clínica, NADA é decifrado — nem uma mensagem.
 *
 * Único ponto do `(admin)` que decifra conversa — trava estática em
 * `conversation-content.test.ts`.
 *
 * Server-only.
 */
import 'server-only';

import { requestContext } from '@/lib/audit/request-context-from-headers';
import { superAdminAuditedRead } from '@/lib/audit/super-admin';
import { requireSuperAdmin, requireUser } from '@/lib/auth/tenant-context';
import { decryptForTenant } from '@/lib/crypto';
import { metrics } from '@/lib/observability/metrics';

import type { ConversationContentDTO, ConversationMetadataDTO } from './dto';
import { conversationsRepository, toMessageMeta } from './repositories/conversations.repo';

/** `action` gravada em `super_admin_actions` a cada abertura de texto. */
export const CONVERSATION_CONTENT_VIEWED = 'ai_conversation.content_viewed';

/** Tela de origem — valor nomeado no servidor, não string do cliente. */
export const CONVERSATION_CONTENT_SURFACE = 'admin_conversas_ia';

/** Placeholder quando uma mensagem não decifra. Nunca o ciphertext. */
export const UNAVAILABLE_TEXT = '[conteúdo indisponível]';

export type MetadataOnlyReason = 'no_support_session' | 'other_clinic_session';

export type ConversationOpenResult =
  | { kind: 'not_found' }
  | { kind: 'metadata'; reason: MetadataOnlyReason; conversation: ConversationMetadataDTO }
  | { kind: 'content'; conversation: ConversationContentDTO };

/** O que sai da tx auditada: o texto vai para a página; a contagem, para o evento. */
interface ContentRead {
  conversation: ConversationContentDTO;
  decryptFailures: number;
}

/**
 * Abre uma conversa para o console. `clinicId` e `conversationId` já chegam
 * validados como UUID pela página; aqui eles só escolhem O QUE ler — QUEM pode
 * ler o texto é decidido pela sessão.
 */
export async function openConversationForAdmin(
  clinicId: string,
  conversationId: string,
): Promise<ConversationOpenResult> {
  // Defesa em profundidade: a página já passou pelo guard, mas esta função
  // não depende de quem a chama.
  await requireSuperAdmin();
  const user = await requireUser();
  const impersonation = user.session?.impersonation ?? null;

  if (!impersonation || impersonation.clinicId !== clinicId) {
    const conversation = await conversationsRepository.getMetadata(clinicId, conversationId);
    if (!conversation) return { kind: 'not_found' };
    const reason: MetadataOnlyReason = impersonation
      ? 'other_clinic_session'
      : 'no_support_session';
    metrics.emit('admin.conversation.metadata_only', { targetClinicId: clinicId, reason });
    return { kind: 'metadata', reason, conversation };
  }

  const context = await requestContext();
  const read = await superAdminAuditedRead<ContentRead>(
    {
      action: CONVERSATION_CONTENT_VIEWED,
      targetClinicId: clinicId,
      requestContext: context,
      payload: (r) => ({
        conversationId: r.conversation.id,
        impersonationId: impersonation.impersonationId,
        surface: CONVERSATION_CONTENT_SURFACE,
        messageCount: r.conversation.messages.length,
        decryptFailures: r.decryptFailures,
        requestId: context.requestId,
      }),
    },
    async (tx) => {
      const found = await conversationsRepository.findContentRowsTx(tx, clinicId, conversationId);
      if (!found) return null;

      // Decifra DEPOIS de existir a conversa e ANTES do INSERT do evento: o
      // mesmo rollback que desfaz a trilha impede o texto de sair da função.
      let decryptFailures = 0;
      const messages = await Promise.all(
        found.rows.map(async (row) => {
          let text: string;
          try {
            text = await decryptForTenant(clinicId, row.contentEncrypted);
          } catch {
            // Nunca expõe o ciphertext nem o motivo; conta para o evento.
            decryptFailures += 1;
            text = UNAVAILABLE_TEXT;
          }
          return { ...toMessageMeta(row), text };
        }),
      );

      const conversation: ConversationContentDTO = {
        id: found.conversation.id,
        clinicId,
        clinicNome: found.conversation.clinicNome,
        status: found.conversation.status,
        messages,
      };
      return { conversation, decryptFailures };
    },
  );

  if (!read) return { kind: 'not_found' };
  return { kind: 'content', conversation: read.conversation };
}
