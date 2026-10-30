import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Tx } from '@/lib/db';

import { executePendingAction } from './pending-action';
import type { ToolContext } from '../tools/registry';

const mocks = vi.hoisted(() => ({
  decryptForTenant: vi.fn(),
  scheduleAsAgent: vi.fn(),
}));

vi.mock('@/lib/crypto', () => ({
  decryptForTenant: mocks.decryptForTenant,
  encryptForTenant: vi.fn(),
}));
vi.mock('@/contexts/scheduling', () => ({
  schedulingApiV1: { scheduleAsAgent: mocks.scheduleAsAgent },
}));

const legacyPayload = {
  type: 'schedule_appointment',
  patientId: '33333333-3333-3333-8333-333333333333',
  doctorId: '44444444-4444-4444-8444-444444444444',
  procedureId: '55555555-5555-5555-8555-555555555555',
  scheduledAt: '2026-10-04T12:00:00.000Z',
};

const pendingRow = {
  id: '66666666-6666-6666-8666-666666666666',
  actionName: 'schedule_appointment',
  expiresAt: new Date(Date.now() + 600_000),
  payloadEncrypted: 'encrypted-payload',
};

const tx = {
  select: () => ({
    from: () => ({
      where: () => ({
        orderBy: () => ({
          limit: () => ({ for: async () => [pendingRow] }),
        }),
      }),
    }),
  }),
  update: () => ({ set: () => ({ where: async () => undefined }) }),
} as unknown as Tx;

const context: ToolContext = {
  tx,
  clinicId: '11111111-1111-1111-8111-111111111111',
  conversationId: '22222222-2222-2222-8222-222222222222',
  eventId: '77777777-7777-7777-8777-777777777777',
  aiRequestId: '88888888-8888-8888-8888-888888888888',
  patientId: legacyPayload.patientId,
  patientNome: 'Ana',
  identityAmbiguous: false,
  verifiedPhone: '+5511999990000',
  currentMessage: 'SIM',
  canScheduleAnonymous: false,
  maxDaysAhead: 30,
  clinicTimeZone: 'America/Sao_Paulo',
  pendingAppointmentProcedureName: null,
  canDisclosePayments: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  pendingRow.expiresAt = new Date(Date.now() + 600_000);
  mocks.scheduleAsAgent.mockResolvedValue({
    id: '99999999-9999-4999-9999-999999999999',
    status: 'agendado',
    scheduledAt: legacyPayload.scheduledAt,
  });
});

describe('ações pendentes após a retirada do preço por meio', () => {
  it('recusa preço antigo e exige novo resumo antes de criar a consulta', async () => {
    mocks.decryptForTenant.mockResolvedValue(
      JSON.stringify({
        ...legacyPayload,
        commercialPrice: {
          paymentMethod: 'pix',
          installmentCount: null,
          priceId: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
          grossAmount: 180,
        },
      }),
    );

    await expect(executePendingAction(context)).rejects.toThrow('peça um novo agendamento');
    expect(mocks.scheduleAsAgent).not.toHaveBeenCalled();
  });

  it('continua executando payloads antigos com os argumentos originais', async () => {
    mocks.decryptForTenant.mockResolvedValue(JSON.stringify(legacyPayload));

    await executePendingAction(context);

    expect(mocks.scheduleAsAgent).toHaveBeenCalledWith(
      expect.objectContaining({ clinicId: context.clinicId }),
      {
        doctorId: legacyPayload.doctorId,
        procedureId: legacyPayload.procedureId,
        patientId: legacyPayload.patientId,
        scheduledAt: legacyPayload.scheduledAt,
      },
      expect.any(String),
    );
  });
});
