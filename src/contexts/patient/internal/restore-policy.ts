/**
 * PAT-001 — quando um paciente soft-deletado PODE voltar.
 *
 * A UI informa "soft delete agora; remoção definitiva em 30 dias", sugerindo uma
 * janela de arrependimento, mas nenhum controle, rota ou action de restauração
 * existia: um erro operacional só era reversível com intervenção direta no
 * banco, sem workflow nem auditoria.
 *
 * A decisão é PURA de propósito: "esta remoção ainda é reversível?" precisa ser
 * testável nos casos que NUNCA podem voltar, sem depender de banco. Restaurar
 * indevidamente é pior do que não restaurar — um registro eliminado por LGPD que
 * reaparece é violação de direito do titular, não conveniência de operação.
 */

/** Mesma janela do cron `patient-hard-delete` (30 dias). */
export const PATIENT_RESTORE_WINDOW_DAYS = 30;

export interface RestoreCandidate {
  /** `null` = paciente ativo (nada a restaurar). */
  deletedAt: Date | null;
  /** Anonimização é IRREVERSÍVEL: os dados não existem mais. */
  anonymizedAt: Date | null;
  /** Existe pedido LGPD de eliminação em aberto para este titular. */
  hasOpenErasureRequest: boolean;
}

export type RestoreDecision =
  | { allowed: true }
  /** Já está ativo — replay do restore. Sucesso sem efeito, não erro. */
  | { allowed: false; reason: 'not_deleted'; idempotent: true }
  | {
      allowed: false;
      reason: 'retention_expired' | 'anonymized' | 'lgpd_erasure_pending';
      idempotent?: false;
    };

const DAY_MS = 24 * 60 * 60 * 1000;

export function decidePatientRestore(
  candidate: RestoreCandidate,
  now: Date = new Date(),
): RestoreDecision {
  // Replay do restore: idempotente por contrato, não erro.
  if (candidate.deletedAt === null)
    return { allowed: false, reason: 'not_deleted', idempotent: true };

  // Ordem importa: os impedimentos IRREVERSÍVEIS vêm antes do prazo, porque um
  // registro anonimizado dentro da janela continua sendo irrecuperável.
  if (candidate.anonymizedAt !== null) return { allowed: false, reason: 'anonymized' };

  // Eliminação por LGPD em andamento: restaurar aqui desfaria um direito do
  // titular exercido formalmente, não um clique errado do operador.
  if (candidate.hasOpenErasureRequest) {
    return { allowed: false, reason: 'lgpd_erasure_pending' };
  }

  const elapsed = now.getTime() - candidate.deletedAt.getTime();
  if (elapsed > PATIENT_RESTORE_WINDOW_DAYS * DAY_MS) {
    // Fora da janela o hard-delete já pode ter rodado; e mesmo que ainda não
    // tenha, o contrato exibido ao operador diz 30 dias.
    return { allowed: false, reason: 'retention_expired' };
  }

  return { allowed: true };
}

export type RestoreRefusalReason = Exclude<RestoreDecision, { allowed: true }>['reason'];

/** Mensagem para o operador — explica por que não dá, sem jargão interno. */
export function describeRestoreRefusal(reason: RestoreRefusalReason): string {
  switch (reason) {
    case 'not_deleted':
      return 'Este paciente já está ativo.';
    case 'retention_expired':
      return `A janela de ${PATIENT_RESTORE_WINDOW_DAYS} dias para desfazer a remoção expirou.`;
    case 'anonymized':
      return 'Os dados deste paciente já foram eliminados definitivamente e não podem ser recuperados.';
    case 'lgpd_erasure_pending':
      return 'Há um pedido de eliminação de dados (LGPD) em andamento para este titular.';
  }
}
