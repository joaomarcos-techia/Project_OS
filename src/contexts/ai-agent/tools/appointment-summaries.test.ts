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
  lookupAppointment: vi.fn(),
  listPatientAppointments: vi.fn(),
  proposePendingAction: vi.fn(),
  findPendingActionSummary: vi.fn(),
}));

vi.mock('@/contexts/scheduling', () => ({
  schedulingApiV1: {
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

const upcoming = {
  id: APPOINTMENT,
  patientId: PATIENT,
  scheduledAt: TEN_AM_SAO_PAULO,
  status: 'agendado',
  currentDoctorNome: 'Dra. Ana',
  snapshotDoctorNome: 'Dra. Ana',
  snapshotProcedureName: 'Consulta',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.lookupAppointment.mockResolvedValue(upcoming);
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
        id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
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
