/**
 * O paciente lê o horário no fuso da clínica (08/10/2026).
 *
 * Os resumos de cancelar, reagendar e confirmar presença traziam o ISO em UTC:
 * uma consulta às 10:00 em São Paulo aparecia como "...T13:00:00.000Z", e o
 * "SIM" do paciente confirmava um horário que ele leu errado.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Tx } from '@/lib/db';
import type * as PendingActionModule from '../internal/pending-action';

import { getTool, type ToolContext } from './registry';
import './register';

const mocks = vi.hoisted(() => ({
  listSlots: vi.fn(),
  lookupAppointment: vi.fn(),
  listPatientAppointments: vi.fn(),
  proposePendingAction: vi.fn(),
  findPendingActionSummary: vi.fn(),
}));

vi.mock('@/contexts/scheduling', () => ({
  schedulingApiV1: {
    listSlots: mocks.listSlots,
    lookupAppointment: mocks.lookupAppointment,
    listPatientAppointments: mocks.listPatientAppointments,
  },
}));
vi.mock('../internal/pending-action', async (importOriginal) => ({
  ...(await importOriginal<typeof PendingActionModule>()),
  proposePendingAction: mocks.proposePendingAction,
  findPendingActionSummary: mocks.findPendingActionSummary,
}));

const PATIENT = '99999999-9999-4999-8999-999999999999';
const APPOINTMENT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const PENDING = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
// 10:00 em São Paulo (UTC-3, sem horário de verão desde 2019).
const TEN_AM_SAO_PAULO = '2026-10-09T13:00:00.000Z';

const ctx: ToolContext = {
  tx: {} as Tx,
  clinicId: '11111111-1111-1111-1111-111111111111',
  conversationId: '22222222-2222-2222-2222-222222222222',
  eventId: '33333333-3333-3333-3333-333333333333',
  aiRequestId: '44444444-4444-4444-4444-444444444444',
  patientId: PATIENT,
  patientNome: 'Paciente',
  identityAmbiguous: false,
  verifiedPhone: '558897168587',
  currentMessage: 'quero mexer na minha consulta',
  canScheduleAnonymous: false,
  maxDaysAhead: 30,
  clinicTimeZone: 'America/Sao_Paulo',
  pendingAppointmentProcedureName: null,
  canDisclosePayments: false,
};

const DOCTOR = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const PROCEDURE = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

const upcoming = {
  id: APPOINTMENT,
  patientId: PATIENT,
  doctorId: DOCTOR,
  procedureId: PROCEDURE,
  scheduledAt: TEN_AM_SAO_PAULO,
  status: 'agendado',
  currentDoctorNome: 'Dra. Ana',
  snapshotDoctorNome: 'Dra. Ana',
  snapshotProcedureName: 'Consulta',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.lookupAppointment.mockResolvedValue(upcoming);
  // 10/10/2026 17:30 em São Paulo, livre na agenda do mesmo profissional.
  mocks.listSlots.mockResolvedValue([{ startAt: '2026-10-10T20:30:00.000Z', doctorId: DOCTOR }]);
  mocks.listPatientAppointments.mockResolvedValue([upcoming]);
  mocks.findPendingActionSummary.mockResolvedValue(null);
  mocks.proposePendingAction.mockImplementation(
    async (_tx: unknown, args: { summary: string; payload: { type: string } }) => ({
      id: PENDING,
      action: args.payload.type,
      summary: args.summary,
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
    }),
  );
});

describe('resumos que o paciente confirma usam o fuso da clínica', () => {
  it('cancelar', async () => {
    const response = await getTool('cancel_appointment')!.handler(
      { appointment_id: APPOINTMENT },
      ctx,
    );
    expect(response.summary).toBe('Cancelar consulta de 09/10/2026 às 10:00');
  });

  it('reagendar (origem e destino)', async () => {
    const response = await getTool('reschedule_appointment')!.handler(
      { appointment_id: APPOINTMENT, new_scheduled_at: '2026-10-10T17:30:00-03:00' },
      ctx,
    );
    expect(response.summary).toBe(
      'Reagendar consulta de 09/10/2026 às 10:00 para 10/10/2026 às 17:30',
    );
  });

  it('confirmar presença', async () => {
    const response = await getTool('confirm_appointment')!.handler({}, ctx);
    expect(response.summary).toBe('Confirmar presença na consulta de 09/10/2026 às 10:00');
  });

  it('nenhum resumo carrega ISO em UTC', async () => {
    const summaries = [
      (await getTool('cancel_appointment')!.handler({ appointment_id: APPOINTMENT }, ctx)).summary,
      (await getTool('confirm_appointment')!.handler({}, ctx)).summary,
    ];
    for (const summary of summaries) expect(summary).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
  });
});

describe('reagendar confere o novo horário na agenda real (08/10/2026)', () => {
  const reschedule = (newAt: string, message = 'pode ser no sábado?') =>
    getTool('reschedule_appointment')!.handler(
      { appointment_id: APPOINTMENT, new_scheduled_at: newAt },
      { ...ctx, currentMessage: message },
    );

  it('horário sem vaga na agenda do profissional → indisponível, nada é preparado', async () => {
    mocks.listSlots.mockResolvedValue([]);
    await expect(reschedule('2026-10-11T03:00:00-03:00')).resolves.toEqual({
      status: 'appointment_unavailable',
      patient_message:
        'Esse horário não está disponível para essa consulta. Informe outra data ou horário.',
    });
    expect(mocks.proposePendingAction).not.toHaveBeenCalled();
  });

  it('vaga de OUTRO profissional não serve: o reagendamento mantém o médico', async () => {
    mocks.listSlots.mockResolvedValue([
      { startAt: '2026-10-10T20:30:00.000Z', doctorId: 'ffffffff-0000-4000-8000-000000000000' },
    ]);
    await expect(reschedule('2026-10-10T17:30:00-03:00')).resolves.toMatchObject({
      status: 'appointment_unavailable',
    });
    expect(mocks.proposePendingAction).not.toHaveBeenCalled();
  });

  it('consulta a agenda do mesmo profissional e procedimento, sem slots já começados', async () => {
    await reschedule('2026-10-10T17:30:00-03:00');
    expect(mocks.listSlots).toHaveBeenCalledWith(
      expect.objectContaining({
        doctorId: DOCTOR,
        procedureId: PROCEDURE,
        notBefore: expect.any(Date),
      }),
    );
  });

  it('vaga confirmada → resumo com o horário da agenda', async () => {
    await expect(reschedule('2026-10-10T17:30:00-03:00')).resolves.toMatchObject({
      status: 'appointment_prepared',
      summary: 'Reagendar consulta de 09/10/2026 às 10:00 para 10/10/2026 às 17:30',
    });
  });

  it('frase com origem E destino ("de sexta às 10h para sábado às 17h30") usa o destino', async () => {
    // Ao vivo em 08/10/2026 o resolvedor leu o PRIMEIRO horário da frase — o da
    // própria consulta, ocupado — e o paciente recebeu "indisponível".
    vi.useFakeTimers({ now: new Date('2026-10-08T10:03:00.000Z'), toFake: ['Date'] });
    try {
      await expect(
        reschedule(
          '2026-10-10T17:30:00-03:00',
          'quero remarcar a consulta de sexta às 10h para sábado às 17h30',
        ),
      ).resolves.toMatchObject({
        status: 'appointment_prepared',
        summary: 'Reagendar consulta de 09/10/2026 às 10:00 para 10/10/2026 às 17:30',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('mesmo dia na origem e no destino ("de sexta às 10h para sexta às 11h") — o caso ao vivo', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-08T10:03:00.000Z'), toFake: ['Date'] });
    mocks.listSlots.mockResolvedValue([{ startAt: '2026-10-09T14:00:00.000Z', doctorId: DOCTOR }]);
    try {
      await expect(
        reschedule(
          '2026-10-09T11:00:00-03:00',
          'quero remarcar a consulta de sexta às 10h para sexta às 11h',
        ),
      ).resolves.toMatchObject({
        status: 'appointment_prepared',
        summary: 'Reagendar consulta de 09/10/2026 às 10:00 para 09/10/2026 às 11:00',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('o destino nunca é a própria origem', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-08T10:03:00.000Z'), toFake: ['Date'] });
    try {
      await expect(
        reschedule('2026-10-09T10:00:00-03:00', 'pode ser sexta às 10h?'),
      ).resolves.toMatchObject({ status: 'appointment_information_required' });
      expect(mocks.proposePendingAction).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a consulta de outro paciente continua recusada antes de olhar a agenda', async () => {
    mocks.lookupAppointment.mockResolvedValue({ ...upcoming, patientId: 'outro' });
    await expect(reschedule('2026-10-10T17:30:00-03:00')).rejects.toThrow('não pertence');
    expect(mocks.listSlots).not.toHaveBeenCalled();
  });
});

describe('listas de consultas trazem o horário local ao lado do UTC', () => {
  it('list_my_appointments', async () => {
    const response = await getTool('list_my_appointments')!.handler({}, ctx);
    expect(response.appointments[0]).toMatchObject({
      scheduled_at: TEN_AM_SAO_PAULO,
      scheduled_at_local: '09/10/2026 às 10:00',
    });
  });

  it('confirm_appointment com várias consultas devolve opções com horário local', async () => {
    mocks.listPatientAppointments.mockResolvedValue([
      upcoming,
      {
        ...upcoming,
        id: 'abababab-abab-4bab-8bab-abababababab',
        scheduledAt: '2026-10-12T19:00:00.000Z',
      },
    ]);
    const response = await getTool('confirm_appointment')!.handler({}, ctx);
    expect(response.requires_selection).toBe(true);
    const options = response.appointments as Array<{ scheduled_at_local: string }>;
    expect(options.map((option) => option.scheduled_at_local)).toEqual([
      '09/10/2026 às 10:00',
      '12/10/2026 às 16:00',
    ]);
  });
});
