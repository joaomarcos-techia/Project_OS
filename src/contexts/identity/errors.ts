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
