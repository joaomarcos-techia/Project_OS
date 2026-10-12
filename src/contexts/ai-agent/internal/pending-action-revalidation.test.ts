/**
 * A confirmação ("SIM") re-checa identidade, posse da consulta e a política de
 * sinal no instante da execução — o resumo foi preparado num turno anterior e o
 * estado pode ter mudado no meio (08/10/2026).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Tx } from '@/lib/db';

import type { ToolContext } from '../tools/registry';
import { executePendingAction, type PendingActionPayload } from './pending-action';

const mocks = vi.hoisted(() => ({
  decryptForTenant: vi.fn(),
  getDepositPolicy: vi.fn(),
  scheduleAsAgent: vi.fn(),
  cancelAsAgent: vi.fn(),
  lookupAppointment: vi.fn(),
}));

vi.mock('@/lib/crypto', () => ({
  decryptForTenant: mocks.decryptForTenant,
  encryptForTenant: vi.fn(),
}));
vi.mock('@/contexts/payments', () => ({ getDepositPolicy: mocks.getDepositPolicy }));
vi.mock('@/contexts/scheduling', () => ({
  schedulingApiV1: {
    scheduleAsAgent: mocks.scheduleAsAgent,
    cancelAsAgent: mocks.cancelAsAgent,
    lookupAppointment: mocks.lookupAppointment,
  },
}));

const CLINIC = '11111111-1111-1111-1111-111111111111';
const PATIENT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PATIENT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const APPOINTMENT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const DOCTOR = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const PROCEDURE = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const PENDING = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

/** tx mínima: a linha pendente sob lock e UPDATEs que não importam aqui. */
function txWithPending(actionName: PendingActionPayload['type']): Tx {
  const row = {
    id: PENDING,
    actionName,
    payloadEncrypted: 'cifrado',
    expiresAt: new Date(Date.now() + 60_000),
  };
  const query = {
    from: () => query,
    where: () => query,
    orderBy: () => query,
    limit: () => query,
    for: async () => [row],
  };
  return {
    select: () => query,
    update: () => ({ set: () => ({ where: async () => [] }) }),
  } as unknown as Tx;
}

function ctxFor(actionName: PendingActionPayload['type'], overrides: Partial<ToolContext> = {}) {
  return {
    tx: txWithPending(actionName),
    clinicId: CLINIC,
    conversationId: '22222222-2222-2222-2222-222222222222',
    eventId: '33333333-3333-3333-3333-333333333333',
    aiRequestId: '44444444-4444-4444-4444-444444444444',
    patientId: PATIENT_A,
    patientNome: 'Paciente A',
    identityAmbiguous: false,
    verifiedPhone: '558897168587',
    currentMessage: 'SIM',
    canScheduleAnonymous: false,
    maxDaysAhead: 30,
    clinicTimeZone: 'America/Sao_Paulo',
    pendingAppointmentProcedureName: null,
    canDisclosePayments: false,
    ...overrides,
  } satisfies ToolContext;
}

function preparedPayload(payload: PendingActionPayload): void {
  mocks.decryptForTenant.mockResolvedValue(JSON.stringify(payload));
}

const schedule = (patientId: string | null): PendingActionPayload => ({
  type: 'schedule_appointment',
  patientId,
  doctorId: DOCTOR,
  procedureId: PROCEDURE,
  scheduledAt: new Date(Date.now() + 86_400_000).toISOString(),
});

const appointmentResult = {
  id: APPOINTMENT,
  status: 'agendado',
  scheduledAt: new Date(Date.now() + 86_400_000).toISOString(),
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getDepositPolicy.mockResolvedValue({ enabled: false });
  mocks.scheduleAsAgent.mockResolvedValue(appointmentResult);
  mocks.cancelAsAgent.mockResolvedValue({ ...appointmentResult, status: 'cancelado' });
});

describe('agendamento: quem confirma é quem preparou', () => {
  it('telefone passou a casar com OUTRO cadastro → recusa, nada é criado', async () => {
    preparedPayload(schedule(PATIENT_A));

    await expect(
      executePendingAction(ctxFor('schedule_appointment', { patientId: PATIENT_B })),
    ).rejects.toThrow('identidade do contato mudou');
    expect(mocks.scheduleAsAgent).not.toHaveBeenCalled();
  });

  it('preparado anônimo e o contato agora é paciente → prepara de novo, com o paciente', async () => {
    preparedPayload(schedule(null));

    await expect(
      executePendingAction(ctxFor('schedule_appointment', { canScheduleAnonymous: true })),
    ).rejects.toThrow('identidade do contato mudou');
    expect(mocks.scheduleAsAgent).not.toHaveBeenCalled();
  });

  it('mesmo paciente → executa', async () => {
    preparedPayload(schedule(PATIENT_A));

    const result = await executePendingAction(ctxFor('schedule_appointment'));

    expect(result).toMatchObject({ action: 'schedule_appointment', appointmentId: APPOINTMENT });
    expect(mocks.scheduleAsAgent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ patientId: PATIENT_A }),
      expect.any(String),
    );
  });
});

describe('agendamento anônimo re-checa o sinal na confirmação', () => {
  const anonymous = { patientId: null, patientNome: null, canScheduleAnonymous: true };

  it('sinal ligado entre preparar e confirmar → recusa a marcação sem cadastro', async () => {
    preparedPayload(schedule(null));
    mocks.getDepositPolicy.mockResolvedValue({ enabled: true });

    await expect(executePendingAction(ctxFor('schedule_appointment', anonymous))).rejects.toThrow(
      'paciente não identificado',
    );
    expect(mocks.scheduleAsAgent).not.toHaveBeenCalled();
  });

  it('clínica desligou o agendamento sem cadastro no meio → recusa', async () => {
    preparedPayload(schedule(null));

    await expect(
      executePendingAction(
        ctxFor('schedule_appointment', { ...anonymous, canScheduleAnonymous: false }),
      ),
    ).rejects.toThrow('paciente não identificado');
    expect(mocks.scheduleAsAgent).not.toHaveBeenCalled();
  });

  it('sinal desligado e opção ligada → executa sem paciente', async () => {
    preparedPayload(schedule(null));

    await executePendingAction(ctxFor('schedule_appointment', anonymous));

    expect(mocks.scheduleAsAgent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ patientId: null }),
      expect.any(String),
    );
  });
});

describe('ações sobre consulta existente re-checam a posse', () => {
  const cancel: PendingActionPayload = { type: 'cancel_appointment', appointmentId: APPOINTMENT };

  it('consulta passou a ser de outro paciente → recusa o cancelamento', async () => {
    preparedPayload(cancel);
    mocks.lookupAppointment.mockResolvedValue({ id: APPOINTMENT, patientId: PATIENT_B });

    await expect(executePendingAction(ctxFor('cancel_appointment'))).rejects.toThrow(
      'não pertence ao paciente verificado',
    );
    expect(mocks.cancelAsAgent).not.toHaveBeenCalled();
  });

  it('contato deixou de ser identificado → recusa', async () => {
    preparedPayload(cancel);
    mocks.lookupAppointment.mockResolvedValue({ id: APPOINTMENT, patientId: PATIENT_A });

    await expect(
      executePendingAction(ctxFor('cancel_appointment', { patientId: null, patientNome: null })),
    ).rejects.toThrow('não pertence ao paciente verificado');
    expect(mocks.cancelAsAgent).not.toHaveBeenCalled();
  });

  it('telefone ficou compartilhado → recusa antes de olhar a consulta', async () => {
    preparedPayload(cancel);

    await expect(
      executePendingAction(ctxFor('cancel_appointment', { identityAmbiguous: true })),
    ).rejects.toThrow('mais de um paciente');
    expect(mocks.lookupAppointment).not.toHaveBeenCalled();
    expect(mocks.cancelAsAgent).not.toHaveBeenCalled();
  });

  it('consulta do próprio paciente → cancela', async () => {
    preparedPayload(cancel);
    mocks.lookupAppointment.mockResolvedValue({ id: APPOINTMENT, patientId: PATIENT_A });

    const result = await executePendingAction(ctxFor('cancel_appointment'));

    expect(result).toMatchObject({ action: 'cancel_appointment', status: 'cancelado' });
    expect(mocks.cancelAsAgent).toHaveBeenCalledTimes(1);
  });
});
