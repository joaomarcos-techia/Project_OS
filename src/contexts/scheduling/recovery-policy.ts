import { SchedulingValidationError } from './errors';
import type { AppointmentState } from './state-machine';

export type AppointmentRecoveryKind = 'interrupt' | 'exceptional_cancel' | 'reopen' | 'transfer';

export interface AppointmentRecoveryDecision {
  target: AppointmentState;
  requiresNewDoctor: boolean;
}

export function listAppointmentRecoveryKinds(from: AppointmentState): AppointmentRecoveryKind[] {
  if (from === 'em_atendimento') return ['interrupt', 'exceptional_cancel', 'transfer'];
  if (from === 'cancelado' || from === 'faltou') return ['reopen'];
  if (from === 'agendado' || from === 'confirmado' || from === 'chegou') return ['transfer'];
  return [];
}

export function decideAppointmentRecovery(
  from: AppointmentState,
  kind: AppointmentRecoveryKind,
): AppointmentRecoveryDecision {
  if (kind === 'interrupt' && from === 'em_atendimento') {
    return { target: 'chegou', requiresNewDoctor: false };
  }
  if (kind === 'exceptional_cancel' && from === 'em_atendimento') {
    return { target: 'cancelado', requiresNewDoctor: false };
  }
  if (kind === 'reopen' && (from === 'cancelado' || from === 'faltou')) {
    return { target: 'agendado', requiresNewDoctor: false };
  }
  if (
    kind === 'transfer' &&
    (from === 'agendado' || from === 'confirmado' || from === 'chegou' || from === 'em_atendimento')
  ) {
    return { target: from === 'em_atendimento' ? 'chegou' : from, requiresNewDoctor: true };
  }
  throw new SchedulingValidationError(`recuperacao '${kind}' invalida para status '${from}'`);
}
