/**
 * Leitura de conversa da IA pelas telas da clínica (S-01b, ADR-074).
 *
 * ===================================================================
 * Por que este arquivo existe
 * ===================================================================
 * Numa sessão de suporte, o super_admin usa o app da clínica com todas as
 * permissões e lia todas as conversas sem deixar rastro: ficava registrado só
 * o início da sessão. `/conversas` ainda abria sozinha a primeira conversa, a
 * lista decifrava a prévia de até 30 conversas e a tela se refaz a cada 10 s.
 *
 * Regra (decidida em 15/11/2026):
 *  1. Na sessão de suporte, a LISTA mostra só metadado: sem prévia da última
 *     mensagem e com o telefone mascarado (`listConversationsForViewer`). A
 *     inbox não abre conversa sozinha — a página consulta `supportSession`.
 *  2. Abrir uma conversa na sessão de suporte grava
 *     `ai_agent.conversation.support_viewed` na trilha DA CLÍNICA
 *     (`audit_events`), NA MESMA TRANSAÇÃO da leitura, uma vez por conversa por
 *     sessão (`recordSupportConversationView`). Se o INSERT falhar, a leitura
 *     falha junto e o histórico não sai daqui (fail-closed).
 *  3. A trilha da plataforma recebe o cross-reference (`recordImpersonationAudit`,
 *     best-effort depois do commit) — o mesmo padrão do prontuário.
 *  4. A equipe da própria clínica segue como sempre: sem trilha de leitura
 *     (fora do escopo desta decisão).
 *
 * IDENTIDADE VEM DA SESSÃO, NUNCA DO CALLER: `userId` e a sessão de suporte
 * saem de `requireUser()`. O `clinicId` vem do gate da página, a mesma fonte da
 * consulta.
 *
 * Server-only. As telas leem conversa SÓ por aqui — trava estática em
 * `conversation-access.test.ts`.
 */
import 'server-only';

import { recordImpersonationAudit } from '@/lib/audit/impersonation-extra';
import { requestContext } from '@/lib/audit/request-context-from-headers';
import {
  recordSupportConversationView,
  SUPPORT_CONVERSATION_VIEWED,
} from '@/lib/audit/support-conversation-view';
import { requireUser } from '@/lib/auth/tenant-context';
import { withTenant } from '@/lib/db/tenant';

import { listConversations, loadConversationThreadTx, type ListConversationsOpts } from './queries';
import type { AIConversationListResult, AIConversationThread } from './types';

/** Tela que abriu a conversa — valor nomeado no servidor, não string do cliente. */
export type ConversationReadSurface = 'conversas_inbox' | 'conversa_direta';

export interface ViewerConversationList extends AIConversationListResult {
  /** `true` quando quem vê a lista está numa sessão de suporte (prévia oculta). */
  supportSession: boolean;
}

/**
 * Lista da inbox para QUEM está logado. Na sessão de suporte, a prévia não é
 * decifrada e o telefone sai mascarado; para a equipe, nada muda.
 */
export async function listConversationsForViewer(
  clinicId: string,
  opts: Omit<ListConversationsOpts, 'redactForSupport'> = {},
): Promise<ViewerConversationList> {
  const user = await requireUser();
  const supportSession = Boolean(user.session?.impersonation);
  const result = await listConversations(clinicId, {
    ...opts,
    ...(supportSession ? { redactForSupport: true } : {}),
  });
  return { ...result, supportSession };
}

/**
 * Abre a conversa. Na sessão de suporte, a abertura fica na trilha da clínica
 * (uma vez por conversa por sessão) na mesma tx da leitura. `null` quando a
 * conversa não existe nessa clínica — nada lido, nada registrado.
 */
export async function readConversationThread(
  clinicId: string,
  conversationId: string,
  surface: ConversationReadSurface,
): Promise<AIConversationThread | null> {
  const user = await requireUser();
  const impersonation = user.session?.impersonation ?? null;

  if (!impersonation) {
    return withTenant(clinicId, (tx) => loadConversationThreadTx(tx, clinicId, conversationId));
  }

  const context = await requestContext();
  const { thread, auditEventId } = await withTenant(clinicId, async (tx) => {
    const loaded = await loadConversationThreadTx(tx, clinicId, conversationId);
    if (!loaded) return { thread: null, auditEventId: null };
    // Mesma tx: se a trilha da clínica não grava, o histórico não sai.
    const id = await recordSupportConversationView(tx, {
      clinicId,
      conversationId: loaded.id,
      superAdminId: user.userId,
      impersonationId: impersonation.impersonationId,
      sessionStartedAt: impersonation.startedAt,
      surface,
      messageCount: loaded.messages.length,
      requestContext: context,
    });
    return { thread: loaded, auditEventId: id };
  });

  // Só quando a linha é nova: reabrir na mesma sessão não repete nada.
  if (thread && auditEventId) {
    await recordImpersonationAudit({
      impersonationId: impersonation.impersonationId,
      auditEventId,
      superAdminId: user.userId,
      clinicId,
      action: SUPPORT_CONVERSATION_VIEWED,
      resourceType: 'ai_conversation',
      resourceId: thread.id,
      requestContext: context,
    });
  }

  return thread;
}
