/**
 * Matching tolerante de procedimento (prepare_appointment) — cobre o bug real
 * do teste ao vivo: paciente diz "cardiologia", procedimento é "Consulta
 * Cardiológica"; substring simples não casava e o agendamento falhava.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Tx } from '@/lib/db';
import type * as PendingActionModule from '../internal/pending-action';

import { __testing__ } from './prepare-appointment';
import { getTool, type ToolContext } from './registry';

const mocks = vi.hoisted(() => ({
  listProcedures: vi.fn(),
  listSlots: vi.fn(),
  getDepositPolicy: vi.fn(),
  previewDepositForBooking: vi.fn(),
  proposePendingAction: vi.fn(),
}));

vi.mock('@/contexts/scheduling', () => ({
  schedulingApiV1: { listProcedures: mocks.listProcedures, listSlots: mocks.listSlots },
}));
vi.mock('@/contexts/payments', () => ({
  getDepositPolicy: mocks.getDepositPolicy,
  paymentsApiV1: { previewDepositForBooking: mocks.previewDepositForBooking },
}));
vi.mock('../internal/pending-action', async (importOriginal) => ({
  ...(await importOriginal<typeof PendingActionModule>()),
  proposePendingAction: mocks.proposePendingAction,
}));

const { matchesProcedure } = __testing__;
const cardio = { descricao: 'Consulta Cardiológica', categoria: 'consulta' };
const dermato = { descricao: 'Consulta Dermatológica', categoria: 'consulta' };
const PROCEDURE_ID = '55555555-5555-5555-5555-555555555555';
const DOCTOR_ID = '66666666-6666-6666-6666-666666666666';
const APPOINTMENT_ACTION_ID = '88888888-8888-8888-8888-888888888888';

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

const registeredPatientContext: ToolContext = {
  ...unregisteredPatientContext,
  patientId: '99999999-9999-9999-9999-999999999999',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listProcedures.mockResolvedValue([
    {
      id: PROCEDURE_ID,
      descricao: 'Consulta Cardiológica',
      categoria: 'consulta',
      valorPadrao: 250,
    },
  ]);
  mocks.listSlots.mockImplementation(async () => [
    { startAt: new Date(Date.now() + 86_400_000).toISOString(), doctorId: DOCTOR_ID },
  ]);
  mocks.getDepositPolicy.mockResolvedValue({ enabled: false });
  mocks.previewDepositForBooking.mockResolvedValue(null);
  mocks.proposePendingAction.mockImplementation(async (_tx, args: { summary: string }) => ({
    id: APPOINTMENT_ACTION_ID,
    action: 'schedule_appointment',
    summary: args.summary,
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
  }));
});

describe('prepare_appointment com preço único', () => {
  it('prepara agendamento sem pedir a forma de pagamento', async () => {
    const response = await getTool('prepare_appointment')!.handler({}, registeredPatientContext);
    expect(response).toMatchObject({ status: 'appointment_prepared' });
    expect(mocks.proposePendingAction).toHaveBeenCalledWith(
      registeredPatientContext.tx,
      expect.objectContaining({
        payload: expect.not.objectContaining({ commercialPrice: expect.anything() }),
      }),
    );
    expect(mocks.previewDepositForBooking).toHaveBeenCalledWith(
      expect.objectContaining({ basePrice: 250 }),
    );
  });

  it('mantém o sinal calculado a partir do preço padrão', async () => {
    mocks.previewDepositForBooking.mockResolvedValue({ amount: 125 });
    const response = await getTool('prepare_appointment')!.handler({}, registeredPatientContext);
    expect(response).toMatchObject({ status: 'appointment_prepared' });
    expect(mocks.proposePendingAction).toHaveBeenCalledWith(
      registeredPatientContext.tx,
      expect.objectContaining({
        payload: expect.objectContaining({ depositAmount: 125 }),
      }),
    );
  });
});

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

describe('nome exato do procedimento vence o matching tolerante', () => {
  it('compara sem caixa, acento nem espaço extra', () => {
    expect(__testing__.isSameProcedureName('  consulta ', { descricao: 'Consulta' })).toBe(true);
    expect(
      __testing__.isSameProcedureName('Consulta [demo]', { descricao: 'Consulta [demo]' }),
    ).toBe(true);
    expect(__testing__.isSameProcedureName('Consulta', { descricao: 'Consulta [demo]' })).toBe(
      false,
    );
  });

  it('com "Consulta" e "Consulta [demo]", pedir "Consulta" escolhe a primeira em vez de travar', async () => {
    // Caso do DEV em 08/10/2026: o tolerante casava os dois e o paciente recebia
    // "Encontrei mais de um atendimento parecido" para sempre.
    mocks.listProcedures.mockResolvedValue([
      { id: PROCEDURE_ID, descricao: 'Consulta', categoria: null, valorPadrao: 150 },
      {
        id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        descricao: 'Consulta [demo]',
        categoria: null,
        valorPadrao: 380,
      },
    ]);

    const response = await getTool('prepare_appointment')!.handler(
      { procedure_name: 'Consulta' },
      registeredPatientContext,
    );

    expect(response.patient_message ?? '').not.toContain('mais de um atendimento');
    expect(mocks.listSlots).toHaveBeenCalledWith(
      expect.objectContaining({ procedureId: PROCEDURE_ID }),
    );
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

describe('com o sinal ligado exige o cadastro (decisão de 08/10/2026)', () => {
  const anonymousAllowedContext: ToolContext = {
    ...unregisteredPatientContext,
    canScheduleAnonymous: true,
    currentMessage: 'Quero marcar uma consulta amanhã, pago no pix',
  };

  it('contato sem cadastro e sinal ligado: pede o cadastro mesmo com agendamento anônimo permitido', async () => {
    // Antes: a marcação anônima era preparada e o sinal nunca era cobrado, porque
    // createDepositCharge sai sem paciente.
    mocks.getDepositPolicy.mockResolvedValue({ enabled: true });

    const response = await getTool('prepare_appointment')!.handler({}, anonymousAllowedContext);

    expect(response).toEqual({
      status: 'patient_registration_required',
      required_fields: ['nome', 'cpf', 'motivo'],
    });
    expect(mocks.getDepositPolicy).toHaveBeenCalledWith(anonymousAllowedContext.clinicId);
    expect(mocks.listSlots).not.toHaveBeenCalled();
    expect(mocks.proposePendingAction).not.toHaveBeenCalled();
  });

  it('contato sem cadastro e sinal desligado: segue a opção da clínica e prepara sem paciente', async () => {
    mocks.getDepositPolicy.mockResolvedValue({ enabled: false });

    const response = await getTool('prepare_appointment')!.handler({}, anonymousAllowedContext);

    expect(response).toMatchObject({ status: 'appointment_prepared' });
    expect(mocks.proposePendingAction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        payload: expect.objectContaining({ type: 'schedule_appointment', patientId: null }),
      }),
    );
  });

  it('paciente identificado não depende da política de sinal para agendar', async () => {
    mocks.getDepositPolicy.mockResolvedValue({ enabled: true });

    const response = await getTool('prepare_appointment')!.handler(
      {},
      { ...registeredPatientContext, currentMessage: 'Quero marcar amanhã, pago no pix' },
    );

    expect(response).toMatchObject({ status: 'appointment_prepared' });
    expect(mocks.getDepositPolicy).not.toHaveBeenCalled();
  });

  it('telefone compartilhado continua bloqueado, com ou sem sinal', async () => {
    mocks.getDepositPolicy.mockResolvedValue({ enabled: false });

    await expect(
      getTool('prepare_appointment')!.handler(
        {},
        { ...anonymousAllowedContext, identityAmbiguous: true },
      ),
    ).rejects.toThrow('mais de um paciente');
    expect(mocks.proposePendingAction).not.toHaveBeenCalled();
  });
});
