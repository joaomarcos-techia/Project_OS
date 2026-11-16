/**
 * Trilha da CLÍNICA para a leitura de conversa da IA pelo suporte do Qoro
 * (S-01b, decidida em 15/11/2026; console da plataforma: ADR-073).
 *
 * Regra: UMA linha em `audit_events` por conversa por sessão de suporte, com o
 * super_admin como `user_id` e a ação `ai_agent.conversation.support_viewed`.
 * O nome da ação diz que foi o suporte porque o CSV da clínica
 * (`tenant-export.ts`) mostra `acao`, `usuario_id` e `recurso_*`, mas não o
 * `after`.
 *
 * Por que não uma linha por leitura, como no prontuário: a tela de conversas
 * da clínica se refaz a cada 10 s. Uma linha por render daria ~360 por hora por
 * aba aberta e enterraria a trilha (o export da clínica tem teto de 5.000
 * linhas). "Na sessão de suporte Y, a conversa X foi aberta" é a pergunta que
 * a trilha precisa responder; o horário é o da primeira abertura na sessão.
 *
 * Fail-closed: roda DENTRO da tx da leitura. Se o INSERT falhar, a leitura
 * falha junto e o conteúdo não sai. Duas aberturas simultâneas da mesma
 * conversa podem gravar duas linhas — duplicata aceita, nunca lacuna.
 *
 * O `after` leva só metadado (tela, sessão, contagem). Nunca texto, telefone,
 * nome nem ciphertext.
 *
 * Server-only.
 */
import 'server-only';

import { and, eq, gte } from 'drizzle-orm';

import type { Tx } from '@/lib/db';
import { auditEvents } from '@/lib/db/schema/infra/audit';

import { logAudit } from './log';
import type { RequestContext } from './types';

export const SUPPORT_CONVERSATION_VIEWED = 'ai_agent.conversation.support_viewed';

/** Tela de origem — valor nomeado no servidor, não string do cliente. */
export type SupportConversationSurface =
  | 'admin_conversas_ia'
  | 'conversas_inbox'
  | 'conversa_direta';

export interface SupportConversationViewArgs {
  clinicId: string;
  conversationId: string;
  /** `user_id` da linha: o super_admin da sessão (vem de `requireUser()`). */
  superAdminId: string;
  impersonationId: string;
  /** ISO — início da sessão de suporte; delimita "já registrada nesta sessão". */
  sessionStartedAt: string;
  surface: SupportConversationSurface;
  messageCount: number;
  requestContext: RequestContext;
}

/**
 * Grava a abertura na trilha da clínica, se esta sessão ainda não a gravou.
 * Devolve o id da linha nova (para o cross-reference em `super_admin_actions`)
 * ou `null` quando a sessão já tinha registrado esta conversa.
 *
 * Uma sessão de suporte por super_admin por vez (`createSessionTx` revoga a
 * anterior), então "desde o início desta sessão, por este super_admin" é
 * exatamente "nesta sessão".
 */
export async function recordSupportConversationView(
  tx: Tx,
  args: SupportConversationViewArgs,
): Promise<string | null> {
  const [already] = await tx
    .select({ id: auditEvents.id })
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.clinicId, args.clinicId),
        // Também poda as partições mensais de `audit_events`.
        gte(auditEvents.createdAt, new Date(args.sessionStartedAt)),
        eq(auditEvents.action, SUPPORT_CONVERSATION_VIEWED),
        eq(auditEvents.resourceType, 'ai_conversation'),
        eq(auditEvents.resourceId, args.conversationId),
        eq(auditEvents.userId, args.superAdminId),
      ),
    )
    .limit(1);
  if (already) return null;

  return logAudit(tx, {
    clinicId: args.clinicId,
    userId: args.superAdminId,
    action: SUPPORT_CONVERSATION_VIEWED,
    resourceType: 'ai_conversation',
    resourceId: args.conversationId,
    before: null,
    after: {
      surface: args.surface,
      impersonationId: args.impersonationId,
      messageCount: args.messageCount,
    },
    requestContext: args.requestContext,
  });
}
