/**
 * P11.1 — o "SIM" de uma marcação pelo convênio: a escolha é conferida de novo no instante da execução (a operadora
 * pode ter sido desativada entre os turnos), o atendimento nasce convênio pela agenda (sem sinal) e a cobertura é
 * registrada logo depois, como automação (o agente não tem pessoa na sessão). O particular não muda.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Tx } from '@/lib/db';

import type { ToolContext } from '../tools/registry';
import { executePendingAction, type PendingActionPayload } from './pending-action';

const mocks = vi.hoisted(() => ({
  decryptForTenant: vi.fn(),
  getDepositPolicy: vi.fn(),
  scheduleAsAgent: vi.fn(),
  checkSchedulingChoice: vi.fn(),
  recordSchedulingCoverage: vi.fn(),
}));

vi.mock('@/lib/crypto', () => ({
  decryptForTenant: mocks.decryptForTenant,
  encryptForTenant: vi.fn(),
}));
vi.mock('@/contexts/payments', () => ({ getDepositPolicy: mocks.getDepositPolicy }));
vi.mock('@/contexts/scheduling', () => ({
  schedulingApiV1: { scheduleAsAgent: mocks.scheduleAsAgent },
}));
vi.mock('@/contexts/health-insurance', () => ({
  checkSchedulingChoice: mocks.checkSchedulingChoice,
  recordSchedulingCoverage: mocks.recordSchedulingCoverage,
}));

const CLINIC = '11111111-1111-1111-1111-111111111111';
const PATIENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const APPOINTMENT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const DOCTOR = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const PROCEDURE = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const PENDING = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const INSURER = '12121212-1212-4212-8212-121212121212';
const PLAN = '34343434-3434-4434-8434-343434343434';
// 23:30 de 12/10 em São Paulo = 02:30 de 13/10 em UTC: a data da cobertura é a da clínica.
const AT = '2026-10-13T02:30:00.000Z';

function tx(): Tx {
  const row = {
    id: PENDING,
    actionName: 'schedule_appointment',
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

const ctx = (): ToolContext => ({
  tx: tx(),
  clinicId: CLINIC,
  conversationId: '22222222-2222-2222-2222-222222222222',
  eventId: '33333333-3333-3333-3333-333333333333',
  aiRequestId: '44444444-4444-4444-4444-444444444444',
  patientId: PATIENT,
  patientNome: 'Paciente Sintético',
  identityAmbiguous: false,
  verifiedPhone: '5511999990000',
  currentMessage: 'SIM',
  canScheduleAnonymous: false,
  maxDaysAhead: 30,
  clinicTimeZone: 'America/Sao_Paulo',
  pendingAppointmentProcedureName: null,
  canDisclosePayments: false,
});

const insurance = {
  insurerId: INSURER,
  planId: PLAN,
  membershipId: null,
  guideType: 'consulta' as const,
};
/** A operadora dita pelo paciente (o prepare recusa a que só o modelo propôs). */
const insuranceSource = { insurer: 'patient_text' as const, plan: 'patient_text' as const };

const prepared = (
  extra: Partial<Extract<PendingActionPayload, { type: 'schedule_appointment' }>>,
) =>
  mocks.decryptForTenant.mockResolvedValue(
    JSON.stringify({
      type: 'schedule_appointment',
      patientId: PATIENT,
      doctorId: DOCTOR,
      procedureId: PROCEDURE,
      scheduledAt: new Date(Date.now() + 86_400_000).toISOString(),
      ...extra,
    }),
  );

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getDepositPolicy.mockResolvedValue({ enabled: false });
  mocks.scheduleAsAgent.mockResolvedValue({ id: APPOINTMENT, status: 'agendado', scheduledAt: AT });
  mocks.checkSchedulingChoice.mockResolvedValue(null);
  mocks.recordSchedulingCoverage.mockResolvedValue({
    recorded: 1,
    status: 'pending',
    issues: [],
    error: null,
  });
});

describe('P11.1 — execução da marcação pelo convênio', () => {
  it('reconfere a escolha, cria como convênio e registra a cobertura como automação, na data da clínica', async () => {
    prepared({ insurance, insuranceSource });
    const result = await executePendingAction(ctx());

    expect(mocks.checkSchedulingChoice).toHaveBeenCalledWith(CLINIC, PATIENT, insurance);
    expect(mocks.scheduleAsAgent).toHaveBeenCalledWith(
      expect.objectContaining({ clinicId: CLINIC }),
      expect.objectContaining({ billingMode: 'convenio', patientId: PATIENT }),
      expect.any(String),
    );
    expect(mocks.recordSchedulingCoverage).toHaveBeenCalledWith(
      expect.objectContaining({
        clinicId: CLINIC,
        userId: null,
        patientId: PATIENT,
        procedureId: PROCEDURE,
        appointments: [{ id: APPOINTMENT, date: '2026-10-12' }],
        choice: insurance,
      }),
    );
    expect(result).toMatchObject({ billingMode: 'convenio', appointmentId: APPOINTMENT });
    expect(result).not.toHaveProperty('depositAmount');
  });

  it('operadora desativada entre o resumo e o SIM: recusa, nada é criado nem registrado', async () => {
    prepared({ insurance, insuranceSource });
    mocks.checkSchedulingChoice.mockResolvedValue(
      'A operadora não está ativa no cadastro da clínica.',
    );
    await expect(executePendingAction(ctx())).rejects.toThrow(
      'o convênio escolhido não está mais disponível',
    );
    expect(mocks.scheduleAsAgent).not.toHaveBeenCalled();
    expect(mocks.recordSchedulingCoverage).not.toHaveBeenCalled();
  });

  it('falha ao registrar a cobertura não desfaz o atendimento (vira pendência da recepção)', async () => {
    prepared({ insurance, insuranceSource });
    mocks.recordSchedulingCoverage.mockResolvedValue({
      recorded: 0,
      status: null,
      issues: [],
      error: 'A cobertura não foi registrada agora.',
    });
    await expect(executePendingAction(ctx())).resolves.toMatchObject({ billingMode: 'convenio' });
  });

  it.each([
    ['com sinal', { insurance, insuranceSource, depositAmount: 50 }],
    ['sem paciente identificado', { insurance, insuranceSource, patientId: null }],
    ['sem a origem da escolha', { insurance }],
    [
      'com origem de operadora que não veio do paciente',
      { insurance, insuranceSource: { ...insuranceSource, insurer: 'model' } },
    ],
    ['com origem e sem convênio', { insuranceSource }],
  ])('payload de convênio %s é inválido: nada é criado', async (_l, extra) => {
    prepared(extra as never);
    await expect(executePendingAction(ctx())).rejects.toThrow();
    expect(mocks.scheduleAsAgent).not.toHaveBeenCalled();
  });

  it('particular não muda: nenhuma consulta ao Convênios, nenhuma modalidade enviada', async () => {
    prepared({});
    const result = await executePendingAction(ctx());
    expect(mocks.checkSchedulingChoice).not.toHaveBeenCalled();
    expect(mocks.recordSchedulingCoverage).not.toHaveBeenCalled();
    expect(mocks.scheduleAsAgent.mock.calls[0]![1]).not.toHaveProperty('billingMode');
    expect(result).not.toHaveProperty('billingMode');
  });
});
