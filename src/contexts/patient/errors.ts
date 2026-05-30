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
