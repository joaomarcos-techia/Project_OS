/**
 * Leitura AUDITADA do número da carteirinha (requisito 85 do Componente de
 * Segurança e Privacidade da ANS, parte do módulo; seção N do plano mestre).
 *
 * Padrão de `clinical/prontuario-access.ts`:
 *  - a identidade vem da sessão (`requireUser`), nunca do chamador;
 *  - a FINALIDADE é uma constante da operação do servidor que chama (nunca
 *    entrada do usuário) e só existe no catálogo abaixo; cada finalidade exige
 *    uma permissão, conferida de forma fresca. A finalidade complementa a
 *    permissão: não autoriza nada sozinha;
 *  - fail-closed: o registro em `audit_events` vai na MESMA transação da
 *    leitura; se ele falhar, o número não sai;
 *  - o log guarda só metadado (finalidade e superfície). Nunca o número, nem os
 *    4 últimos, nem o hash;
 *  - a busca é por id E clínica, sob RLS: id de outra clínica devolve `null`
 *    sem registrar leitura de dado alheio.
 *
 * Todo leitor do número decifrado fora deste arquivo é proibido (teste de
 * invariante em `membership-access.test.ts`).
 */
import 'server-only';

import { and, eq } from 'drizzle-orm';

import { logAudit } from '@/lib/audit/log';
import { recordImpersonationAudit } from '@/lib/audit/impersonation-extra';
import { requestContext } from '@/lib/audit/request-context-from-headers';
import { PERMISSIONS, type Permission } from '@/lib/auth/permissions';
import { requireFreshPermission, requireUser } from '@/lib/auth/tenant-context';
import { decryptForTenant } from '@/lib/crypto/encryption';
import { withTenant } from '@/lib/db/tenant';

import { hiMemberships } from '../schema-clinic';

/**
 * Finalidades declaradas, ligadas à operação e à permissão exigida.
 * Permissões próprias do convênio (matriz I.2, P1.12-b, aprovada em 16/11): a recepção
 * (`operate:convenios`) no atendimento e na autorização; o faturamento nas demais.
 */
export const CARD_ACCESS_PURPOSES = {
  /** Recepção confere a carteirinha completa no atendimento. */
  atendimento: { permission: PERMISSIONS.OPERATE_CONVENIOS },
  /** Pedido de autorização à operadora. */
  autorizacao: { permission: PERMISSIONS.OPERATE_CONVENIOS },
  /** Montagem da guia (Consulta ou SP/SADT). */
  geracao_guia: { permission: PERMISSIONS.MANAGE_FATURAMENTO_CONVENIO },
  /** Lote, envio e conferência de faturamento. */
  faturamento: { permission: PERMISSIONS.MANAGE_FATURAMENTO_CONVENIO },
  /** Exportação de dados do paciente (LGPD ou pedido da clínica). */
  exportacao: { permission: PERMISSIONS.EXPORT_PATIENT },
} as const satisfies Record<string, { permission: Permission }>;

export type CardAccessPurpose = keyof typeof CARD_ACCESS_PURPOSES;

export const CARD_NUMBER_VIEWED_ACTION = 'health_insurance.membership.card_number_viewed';

export class CardAccessPurposeError extends Error {
  constructor(purpose: string) {
    super(`finalidade de acesso à carteirinha desconhecida: ${purpose}`);
    this.name = 'CardAccessPurposeError';
  }
}

export interface CardNumberRead {
  membershipId: string;
  cardNumber: string;
  auditEventId: string;
}

/**
 * Decifra o número da carteirinha para a finalidade declarada pela operação.
 * Lança se a finalidade não existir ou se faltar a permissão; devolve `null` se
 * a carteirinha não for da clínica.
 */
export async function readMembershipCardNumberAudited(
  clinicId: string,
  membershipId: string,
  purpose: CardAccessPurpose,
  surface: string,
): Promise<CardNumberRead | null> {
  const spec = (CARD_ACCESS_PURPOSES as Record<string, { permission: Permission }>)[purpose];
  if (!spec) throw new CardAccessPurposeError(purpose);
  await requireFreshPermission(spec.permission);
  const user = await requireUser();
  const context = await requestContext();

  const result = await withTenant(clinicId, async (tx) => {
    const [row] = await tx
      .select({
        id: hiMemberships.id,
        clinicId: hiMemberships.clinicId,
        cardNumberEncrypted: hiMemberships.cardNumberEncrypted,
        status: hiMemberships.status,
      })
      .from(hiMemberships)
      .where(and(eq(hiMemberships.clinicId, clinicId), eq(hiMemberships.id, membershipId)))
      .limit(1);
    if (!row) return null;
    const cardNumber = await decryptForTenant(clinicId, row.cardNumberEncrypted);
    const auditEventId = await logAudit(tx, {
      clinicId,
      userId: user.userId,
      action: CARD_NUMBER_VIEWED_ACTION,
      resourceType: 'hi_membership',
      resourceId: row.id,
      before: null,
      after: { purpose, surface, membershipStatus: row.status },
      requestContext: context,
    });
    return { membershipId: row.id, cardNumber, auditEventId };
  });

  const impersonation = user.session?.impersonation;
  if (impersonation && result) {
    await recordImpersonationAudit({
      impersonationId: impersonation.impersonationId,
      auditEventId: result.auditEventId,
      superAdminId: user.userId,
      clinicId,
      action: CARD_NUMBER_VIEWED_ACTION,
      resourceType: 'hi_membership',
      resourceId: result.membershipId,
      requestContext: context,
    });
  }
  return result;
}
