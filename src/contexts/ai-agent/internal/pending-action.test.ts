import { describe, expect, it } from 'vitest';

import {
  assertAgentSchedulePolicy,
  assertAgentSchedulingIdentity,
  isExplicitConfirmation,
  parsePendingActionPayload,
  pendingActionIdemKey,
  type PendingActionPayload,
} from './pending-action';

describe('confirmação server-side de ações da IA', () => {
  it.each([
    'SIM',
    'confirmo',
    'Pode confirmar!',
    'autorizo',
    'sim, confirmo',
    // Linguagem natural do paciente real (antes falhava por exigir match exato):
    'SIM, confirmo o agendamento',
    'SIM, pode reagendar',
    'sim, confirmo o cancelamento',
    'pode agendar sim',
    'ok, confirmado',
  ])('aceita confirmação inequívoca: %s', (message) =>
    expect(isExplicitConfirmation(message)).toBe(true),
  );

  it.each([
    'posso confirmar?',
    'e se eu cancelar?',
    'talvez',
    'não',
    'sim, mas mude o horário',
    'quero informações',
    'não, deixa pra lá',
    'espera, ainda não',
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

describe('idempotência da execução por CONTEÚDO (R1)', () => {
  const conv = '22222222-2222-2222-2222-222222222222';
  const schedule = (scheduledAt: string): PendingActionPayload => ({
    type: 'schedule_appointment',
    patientId: '33333333-3333-3333-3333-333333333333',
    doctorId: '44444444-4444-4444-4444-444444444444',
    procedureId: '55555555-5555-5555-5555-555555555555',
    scheduledAt,
  });

  it('duas preparações equivalentes → MESMA chave (não duplica no core)', () => {
    // Duas preparações distintas geram pendingActionIds diferentes; a chave de
    // execução NÃO pode depender disso — senão o core cria duas consultas.
    const at = '2026-08-01T12:00:00.000Z';
    expect(pendingActionIdemKey(conv, schedule(at))).toBe(
      pendingActionIdemKey(conv, schedule(at)),
    );
  });

  it('formato compatível com o idemKey() dos contextos (^[a-f0-9]{8,}$)', () => {
    expect(pendingActionIdemKey(conv, schedule('2026-08-01T12:00:00.000Z'))).toMatch(
      /^[a-f0-9]{8,}$/,
    );
  });

  it('argumentos diferentes → chaves diferentes (não colapsa ações distintas)', () => {
    const k1 = pendingActionIdemKey(conv, schedule('2026-08-01T12:00:00.000Z'));
    const k2 = pendingActionIdemKey(conv, schedule('2026-08-02T12:00:00.000Z'));
    expect(k1).not.toBe(k2);
  });

  it('a chave independe do tipo de ação e da conversa', () => {
    const cancel: PendingActionPayload = {
      type: 'cancel_appointment',
      appointmentId: '66666666-6666-6666-6666-666666666666',
    };
    expect(pendingActionIdemKey(conv, cancel)).not.toBe(
      pendingActionIdemKey(conv, schedule('2026-08-01T12:00:00.000Z')),
    );
    expect(pendingActionIdemKey(conv, cancel)).not.toBe(
      pendingActionIdemKey('77777777-7777-7777-7777-777777777777', cancel),
    );
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
