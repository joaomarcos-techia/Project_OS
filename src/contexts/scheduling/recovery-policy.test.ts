import { describe, expect, it } from 'vitest';

import { SchedulingValidationError } from './errors';
import { decideAppointmentRecovery, listAppointmentRecoveryKinds } from './recovery-policy';

describe('appointment recovery policy', () => {
  it('interrompe ou cancela excepcionalmente um atendimento em andamento', () => {
    expect(decideAppointmentRecovery('em_atendimento', 'interrupt')).toEqual({
      target: 'chegou',
      requiresNewDoctor: false,
    });
    expect(decideAppointmentRecovery('em_atendimento', 'exceptional_cancel')).toEqual({
      target: 'cancelado',
      requiresNewDoctor: false,
    });
  });

  it('reabre falta/cancelamento e transfere atendimento ativo', () => {
    expect(decideAppointmentRecovery('faltou', 'reopen').target).toBe('agendado');
    expect(decideAppointmentRecovery('em_atendimento', 'transfer')).toEqual({
      target: 'chegou',
      requiresNewDoctor: true,
    });
  });

  it('nao altera atendimento concluido sem fluxo financeiro compensatorio', () => {
    expect(() => decideAppointmentRecovery('atendido', 'reopen')).toThrow(
      SchedulingValidationError,
    );
  });

  it('expõe à interface somente correções válidas para o status atual', () => {
    expect(listAppointmentRecoveryKinds('em_atendimento')).toEqual([
      'interrupt',
      'exceptional_cancel',
      'transfer',
    ]);
    expect(listAppointmentRecoveryKinds('cancelado')).toEqual(['reopen']);
    expect(listAppointmentRecoveryKinds('atendido')).toEqual([]);
  });
});
