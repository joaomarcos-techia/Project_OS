/** Identity context domain errors. `code` + `httpStatus` para o caller/UI mapear. */

/** Convite tenta atribuir uma função não permitida ao convidante (anti-escalonamento). */
export class RoleAssignmentError extends Error {
  readonly code = 'role_assignment_forbidden';
  readonly httpStatus = 403;
  constructor(message: string) {
    super(message);
    this.name = 'RoleAssignmentError';
  }
}

/** E-mail já tem conta (um user = um clinic_id — ADR-008). Não vaza de qual clínica. */
export class EmailAlreadyMemberError extends Error {
  readonly code = 'email_already_member';
  readonly httpStatus = 409;
  constructor(message = 'Este e-mail já tem uma conta no Qoro.') {
    super(message);
    this.name = 'EmailAlreadyMemberError';
  }
}

/**
 * Teto de usuários do plano atingido, detectado ATOMICAMENTE sob advisory lock
 * (a checagem barata do action pode ter passado numa corrida). `limit` é o teto
 * do plano vigente. O caller mapeia para o CTA de upgrade.
 */
export class UserQuotaExceededError extends Error {
  readonly code = 'user_quota_exceeded';
  readonly httpStatus = 409;
  constructor(public readonly limit: number) {
    super(`Limite de ${limit} usuário(s) do plano atingido.`);
    this.name = 'UserQuotaExceededError';
  }
}

/** CRM já cadastrado nesta clínica (UNIQUE(clinic_id, crm) — ADR-032 §5). */
export class CrmConflictError extends Error {
  readonly code = 'crm_conflict';
  readonly httpStatus = 409;
  constructor(message = 'Este CRM já está cadastrado nesta clínica.') {
    super(message);
    this.name = 'CrmConflictError';
  }
}

/** Alvo (funcionário) não existe na clínica (reenviar/cancelar convite — ADR-032 Fase 2). */
export class MemberNotFoundError extends Error {
  readonly code = 'member_not_found';
  readonly httpStatus = 404;
  constructor(message = 'Funcionário não encontrado.') {
    super(message);
    this.name = 'MemberNotFoundError';
  }
}

/** Convite já foi aceito (ou já removido) — não é mais reenviável/cancelável (ADR-032 Fase 2). */
export class InviteAlreadyAcceptedError extends Error {
  readonly code = 'invite_already_accepted';
  readonly httpStatus = 409;
  constructor(message = 'Este convite já foi aceito.') {
    super(message);
    this.name = 'InviteAlreadyAcceptedError';
  }
}

/**
 * O ator tenta alterar o PRÓPRIO acesso/função (I-2). Bloqueado: ninguém se
 * desativa, se rebaixa, nem se auto-concede override. Evita o gestor se trancar
 * para fora e o "auto-promoção acidental".
 */
export class SelfMutationError extends Error {
  readonly code = 'self_mutation_forbidden';
  readonly httpStatus = 403;
  constructor(message = 'Você não pode alterar o próprio acesso ou função por aqui.') {
    super(message);
    this.name = 'SelfMutationError';
  }
}

/**
 * O alvo é `owner`/`super_admin` (I-2). Owner é único por clínica (ADR-032) e
 * super_admin é papel de plataforma (P7) — nenhum dos dois é desativável/editável
 * pelo canal tenant. Protege contra "clínica sem dono".
 */
export class ProtectedRoleError extends Error {
  readonly code = 'protected_role';
  readonly httpStatus = 403;
  constructor(message = 'Este papel não pode ser alterado pela gestão da equipe.') {
    super(message);
    this.name = 'ProtectedRoleError';
  }
}

/**
 * A desativação foi bloqueada porque o médico tem agenda futura/consulta aberta
 * (ADR-032 §4). Carrega os números para a UI explicar o que remanejar. Não é
 * intransponível: a action aceita `force` (override auditado).
 */
export class MemberHasActiveCommitmentsError extends Error {
  readonly code = 'member_has_active_commitments';
  readonly httpStatus = 409;
  constructor(
    readonly futureCount: number,
    readonly openCount: number,
    readonly nextAt: string | null,
    message = 'Este médico tem agenda futura ou consulta aberta.',
  ) {
    super(message);
    this.name = 'MemberHasActiveCommitmentsError';
  }
}
