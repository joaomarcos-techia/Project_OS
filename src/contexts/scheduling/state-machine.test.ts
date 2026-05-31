import { describe, expect, it } from 'vitest';

import {
  allowedTransitions,
  APPOINTMENT_STATES,
  assertTransition,
  canTransition,
  InvalidTransitionError,
  isTerminal,
  TERMINAL_STATES,
  TRANSITION_EVENT,
  type AppointmentState,
} from './state-machine';

// The frozen truth table, duplicated here so the test fails loudly if anyone
// edits VALID_TRANSITIONS without updating the spec.
const VALID: Record<AppointmentState, AppointmentState[]> = {
  agendado: ['confirmado', 'chegou', 'cancelado', 'faltou'],
  confirmado: ['chegou', 'cancelado', 'faltou'],
  chegou: ['em_atendimento', 'cancelado'],
  em_atendimento: ['atendido'],
  atendido: [],
  cancelado: [],
  faltou: [],
};

describe('state-machine — valid transitions', () => {
  for (const from of APPOINTMENT_STATES) {
    for (const to of VALID[from]) {
      it(`allows ${from} → ${to}`, () => {
        expect(canTransition(from, to)).toBe(true);
        expect(() => assertTransition(from, to)).not.toThrow();
      });
    }
  }
});

describe('state-machine — invalid transitions', () => {
  for (const from of APPOINTMENT_STATES) {
    for (const to of APPOINTMENT_STATES) {
      if (VALID[from].includes(to)) continue;
      it(`rejects ${from} → ${to}`, () => {
        expect(canTransition(from, to)).toBe(false);
        expect(() => assertTransition(from, to)).toThrow(InvalidTransitionError);
      });
    }
  }
});

describe('state-machine — specific spec cases (6.6.3)', () => {
  it('atendido is terminal — cannot cancel or restart', () => {
    expect(canTransition('atendido', 'cancelado')).toBe(false);
    expect(canTransition('atendido', 'em_atendimento')).toBe(false);
  });

  it('cancelado cannot go back to agendado', () => {
    expect(canTransition('cancelado', 'agendado')).toBe(false);
  });

  it('confirmado cannot regress to agendado', () => {
    expect(canTransition('confirmado', 'agendado')).toBe(false);
  });

  it('em_atendimento cannot be cancelled (handler R6 relies on this)', () => {
    expect(canTransition('em_atendimento', 'cancelado')).toBe(false);
    expect(allowedTransitions('em_atendimento')).toEqual(['atendido']);
  });
});

describe('state-machine — terminals', () => {
  it('all terminal states have zero outgoing transitions', () => {
    for (const t of TERMINAL_STATES) {
      expect(allowedTransitions(t)).toHaveLength(0);
      expect(isTerminal(t)).toBe(true);
    }
  });

  it('non-terminal states are not terminal', () => {
    for (const s of ['agendado', 'confirmado', 'chegou', 'em_atendimento'] as const) {
      expect(isTerminal(s)).toBe(false);
    }
  });
});

describe('state-machine — TRANSITION_EVENT mapping', () => {
  it('maps each target to its scheduling event', () => {
    expect(TRANSITION_EVENT.confirmado).toBe('scheduling.appointment.confirmed');
    expect(TRANSITION_EVENT.chegou).toBe('scheduling.appointment.checked_in');
    expect(TRANSITION_EVENT.em_atendimento).toBe('scheduling.appointment.started');
    expect(TRANSITION_EVENT.atendido).toBe('scheduling.appointment.completed');
    expect(TRANSITION_EVENT.cancelado).toBe('scheduling.appointment.cancelled');
    expect(TRANSITION_EVENT.faltou).toBe('scheduling.appointment.no_show');
  });
});
