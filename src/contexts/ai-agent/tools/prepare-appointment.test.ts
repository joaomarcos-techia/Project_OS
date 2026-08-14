/**
 * Matching tolerante de procedimento (prepare_appointment) — cobre o bug real
 * do teste ao vivo: paciente diz "cardiologia", procedimento é "Consulta
 * Cardiológica"; substring simples não casava e o agendamento falhava.
 */
import { describe, expect, it } from 'vitest';

import type { Tx } from '@/lib/db';

import { __testing__ } from './prepare-appointment';
import { getTool, type ToolContext } from './registry';

const { matchesProcedure } = __testing__;
const cardio = { descricao: 'Consulta Cardiológica', categoria: 'consulta' };
const dermato = { descricao: 'Consulta Dermatológica', categoria: 'consulta' };

const unregisteredPatientContext: ToolContext = {
  tx: {} as Tx,
  clinicId: '11111111-1111-1111-1111-111111111111',
  conversationId: '22222222-2222-2222-2222-222222222222',
  eventId: '33333333-3333-3333-3333-333333333333',
  aiRequestId: '44444444-4444-4444-4444-444444444444',
  patientId: null,
  patientNome: null,
  identityAmbiguous: false,
  verifiedPhone: '+5511999990000',
  currentMessage: 'Quero marcar uma consulta',
  canScheduleAnonymous: false,
  maxDaysAhead: 30,
  clinicTimeZone: 'America/Sao_Paulo',
  pendingAppointmentProcedureName: null,
  canDisclosePayments: false,
};

describe('matchesProcedure (tolerante a especialidade vs nome)', () => {
  it('casa especialidade com o nome do procedimento (cardiologia ↔ Cardiológica)', () => {
    expect(matchesProcedure('cardiologia', cardio)).toBe(true);
    expect(matchesProcedure('dermatologia', dermato)).toBe(true);
  });

  it('casa por nome parcial e por categoria', () => {
    expect(matchesProcedure('cardio', cardio)).toBe(true);
    expect(matchesProcedure('consulta', cardio)).toBe(true);
    expect(matchesProcedure('Consulta Cardiológica', cardio)).toBe(true);
  });

  it('NÃO casa especialidade de outro procedimento', () => {
    expect(matchesProcedure('cardiologia', dermato)).toBe(false);
    expect(matchesProcedure('ortopedia', cardio)).toBe(false);
  });
});

describe('horário relativo no fuso da clínica', () => {
  // A resolução em si mora em internal/relative-datetime.test.ts (55 casos).
  // Aqui fica só o que esta tool ainda faz: apresentar o horário ao paciente.
  it('mostra o horário preparado no fuso da clínica', () => {
    expect(
      __testing__.appointmentTimeForPatient('2026-08-14T12:00:00.000Z', 'America/Sao_Paulo'),
    ).toBe('14/08/2026 às 09:00');
  });
});

describe('prepare_appointment para contato sem cadastro', () => {
  it('orienta o cadastro em vez de falhar e disparar o fallback operacional', async () => {
    const tool = getTool('prepare_appointment');
    expect(tool).toBeDefined();

    const response = await tool!.handler({}, unregisteredPatientContext);

    expect(response).toEqual({
      status: 'patient_registration_required',
      required_fields: ['nome', 'cpf', 'motivo'],
    });
  });
});
