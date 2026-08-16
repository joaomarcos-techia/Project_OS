/** Patient context domain errors. Mapped to HTTP status by callers/UI. */

export class PatientValidationError extends Error {
  readonly code = 'patient_validation';
  readonly httpStatus = 422;
  constructor(message: string) {
    super(message);
    this.name = 'PatientValidationError';
  }
}

export class PatientNotFoundError extends Error {
  readonly code = 'patient_not_found';
  readonly httpStatus = 404;
  constructor(id: string) {
    super(`patient not found: ${id}`);
    this.name = 'PatientNotFoundError';
  }
}

export class PatientConflictError extends Error {
  readonly code = 'patient_conflict';
  readonly httpStatus = 409;
  constructor(message: string) {
    super(message);
    this.name = 'PatientConflictError';
  }
}

/**
 * DATA-002 — escrita sobre estado OBSOLETO (concorrência otimista).
 *
 * Dois atores abriram o mesmo paciente, partiram do mesmo estado e enviaram
 * valores diferentes. As duas Server Actions eram aceitas, geravam duas
 * auditorias e o último commit sobrescrevia o primeiro em silêncio: o perdedor
 * recebia sucesso e acreditava que sua edição valia.
 *
 * Erro dedicado (409) para a UI poder dizer "recarregue e reaplique" — que é a
 * única saída que preserva as duas intenções.
 */
export class StaleWriteError extends Error {
  readonly code = 'stale_write';
  readonly httpStatus = 409;
  constructor(
    message = 'Este cadastro foi alterado em outra janela. Recarregue e refaça a edição.',
  ) {
    super(message);
    this.name = 'StaleWriteError';
  }
}
