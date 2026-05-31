/** Scheduling context domain errors. Mapped to HTTP status by callers/UI. */

export class SchedulingValidationError extends Error {
  readonly code = 'scheduling_validation';
  readonly httpStatus = 422;
  constructor(message: string) {
    super(message);
    this.name = 'SchedulingValidationError';
  }
}

export class AppointmentNotFoundError extends Error {
  readonly code = 'appointment_not_found';
  readonly httpStatus = 404;
  constructor(id: string) {
    super(`appointment not found: ${id}`);
    this.name = 'AppointmentNotFoundError';
  }
}

export class ProcedureNotFoundError extends Error {
  readonly code = 'procedure_not_found';
  readonly httpStatus = 404;
  constructor(id: string) {
    super(`procedure not found: ${id}`);
    this.name = 'ProcedureNotFoundError';
  }
}

/**
 * Raised when a slot is already taken: exact-instant collision (UNIQUE / 23505)
 * OR time-range overlap (EXCLUDE / 23P01). Both surface to the user as
 * "horário ocupado". See isUniqueViolation / isExclusionViolation.
 */
export class SchedulingConflictError extends Error {
  readonly code = 'scheduling_conflict';
  readonly httpStatus = 409;
  constructor(message: string) {
    super(message);
    this.name = 'SchedulingConflictError';
  }
}

// InvalidTransitionError lives in state-machine.ts (co-located with the rules
// that throw it) and is re-exported by the context barrel.
