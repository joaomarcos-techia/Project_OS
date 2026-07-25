import { describe, expect, it } from 'vitest';

import {
  assertAgentSchedulePolicy,
  assertAgentSchedulingIdentity,
  isExplicitConfirmation,
  parsePendingActionPayload,
} from './pending-action';

describe('confirmação server-side de ações da IA', () => {
  it.each(['SIM', 'confirmo', 'Pode confirmar!', 'autorizo', 'sim, confirmo'])(
    'aceita confirmação inequívoca: %s',
    (message) => expect(isExplicitConfirmation(message)).toBe(true),
  );

  it.each([
    'posso confirmar?',
    'e se eu cancelar?',
    'talvez',
    'não',
    'sim, mas mude o horário',
    'quero informações',
  ])('rejeita pergunta, negação ou confirmação condicionada: %s', (message) => {
    expect(isExplicitConfirmation(message)).toBe(false);
  });

  it('valida payloads persistidos e rejeita ação fora da whitelist', () => {
    expect(
      parsePendingActionPayload({
        type: 'cancel_appointment',
        appointmentId: '11111111-1111-1111-1111-111111111111',
      }),
    ).toMatchObject({ type: 'cancel_appointment' });
    expect(() =>
      parsePendingActionPayload({ type: 'delete_patient', patientId: 'x' }),
    ).toThrow();
  });
});

describe('maxDaysAhead autoritativo', () => {
  const now = new Date('2026-07-24T12:00:00.000Z');

  it('permite data dentro do limite configurado', () => {
    expect(() =>
      assertAgentSchedulePolicy({
        scheduledAt: '2026-08-23T12:00:00.000Z',
        now,
        maxDaysAhead: 30,
      }),
    ).not.toThrow();
  });

  it('rejeita data além do limite mesmo que o modelo tente chamar a tool', () => {
    expect(() =>
      assertAgentSchedulePolicy({
        scheduledAt: '2026-08-24T12:00:00.000Z',
        now,
        maxDaysAhead: 30,
      }),
    ).toThrow(/excede o limite de 30 dias/);
  });
});

describe('canScheduleAnonymous autoritativo', () => {
  it('bloqueia paciente ausente quando a clínica desativou agendamento anônimo', () => {
    expect(() =>
      assertAgentSchedulingIdentity({
        patientId: null,
        identityAmbiguous: false,
        canScheduleAnonymous: false,
      }),
    ).toThrow(/paciente não identificado/);
  });

  it('permite paciente ausente somente quando a clínica habilitou a opção', () => {
    expect(() =>
      assertAgentSchedulingIdentity({
        patientId: null,
        identityAmbiguous: false,
        canScheduleAnonymous: true,
      }),
    ).not.toThrow();
  });

  it('telefone ambíguo permanece bloqueado mesmo com agendamento anônimo habilitado', () => {
    expect(() =>
      assertAgentSchedulingIdentity({
        patientId: null,
        identityAmbiguous: true,
        canScheduleAnonymous: true,
      }),
    ).toThrow(/mais de um paciente/);
  });
});
