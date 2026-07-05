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
