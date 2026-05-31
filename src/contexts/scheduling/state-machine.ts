/**
 * Appointment state machine (C6) — the SINGLE source of truth for status
 * transitions. PlanoAção §6.2 / §6.9 (REGRA 3): NO `if (status === ...)` or
 * `switch (status)` for transition logic anywhere else in the system. Every
 * Server Action / handler that changes status MUST call `assertTransition`
 * BEFORE the UPDATE.
 *
 * States (português, per spec):
 *   agendado → confirmado → chegou → em_atendimento → atendido
 *                  ↓            ↓
 *              cancelado    cancelado
 *                  ↓
 *               faltou (no-show)
 *
 * Terminal states (atendido / cancelado / faltou) have NO outgoing transitions.
 * `em_atendimento` can ONLY go to `atendido` — an appointment in progress can
 * never be cancelled (relevant to the patient-deleted handler, which skips it).
 */

export const APPOINTMENT_STATES = [
  'agendado',
  'confirmado',
  'chegou',
  'em_atendimento',
  'atendido',
  'cancelado',
  'faltou',
] as const;

export type AppointmentState = (typeof APPOINTMENT_STATES)[number];

/** Terminal states: no outgoing transition is ever valid. */
export const TERMINAL_STATES = ['atendido', 'cancelado', 'faltou'] as const;
export type TerminalState = (typeof TERMINAL_STATES)[number];

/**
 * The frozen transition table. Adding a transition here is a deliberate
 * architectural change — update `state-machine.test.ts` in the same commit.
 */
const VALID_TRANSITIONS: Record<AppointmentState, readonly AppointmentState[]> = {
  agendado: ['confirmado', 'chegou', 'cancelado', 'faltou'], // walk-in/quick check-in skips confirmação
  confirmado: ['chegou', 'cancelado', 'faltou'],
  chegou: ['em_atendimento', 'cancelado'],
  em_atendimento: ['atendido'], // única saída
  atendido: [], // terminal
  cancelado: [], // terminal
  faltou: [], // terminal
};

export function isTerminal(state: AppointmentState): state is TerminalState {
  return (TERMINAL_STATES as readonly string[]).includes(state);
}

export function canTransition(from: AppointmentState, to: AppointmentState): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Allowed next states from `from` (for UI affordances / introspection). */
export function allowedTransitions(from: AppointmentState): readonly AppointmentState[] {
  return VALID_TRANSITIONS[from] ?? [];
}

/**
 * Throws InvalidTransitionError when `from → to` is not in the frozen table.
 * The ONLY sanctioned way to gate a status change.
 */
export function assertTransition(from: AppointmentState, to: AppointmentState): void {
  if (!canTransition(from, to)) {
    throw new InvalidTransitionError(from, to);
  }
}

/**
 * Maps each target state to the scheduling event emitted when an appointment
 * transitions INTO it. Keeps the action layer from re-deriving "which event"
 * with a parallel switch (REGRA 3). `null` = no domain event for that target
 * (none today; kept exhaustive for the type checker).
 */
export const TRANSITION_EVENT: Record<AppointmentState, string | null> = {
  agendado: 'scheduling.appointment.created',
  confirmado: 'scheduling.appointment.confirmed',
  chegou: 'scheduling.appointment.checked_in',
  em_atendimento: 'scheduling.appointment.started',
  atendido: 'scheduling.appointment.completed',
  cancelado: 'scheduling.appointment.cancelled',
  faltou: 'scheduling.appointment.no_show',
};

/** Domain error for an illegal transition. Mapped to HTTP 409 by callers/UI. */
export class InvalidTransitionError extends Error {
  readonly code = 'appointment_invalid_transition';
  readonly httpStatus = 409;
  readonly from: AppointmentState;
  readonly to: AppointmentState;
  constructor(from: AppointmentState, to: AppointmentState) {
    super(`transição inválida de agendamento: '${from}' → '${to}'`);
    this.name = 'InvalidTransitionError';
    this.from = from;
    this.to = to;
  }
}
