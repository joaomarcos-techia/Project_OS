import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  registerHandler: vi.fn(),
  publishEvent: vi.fn(),
  logAppointmentStateChange: vi.fn(),
  emit: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/outbox/registry', () => ({ registerHandler: mocks.registerHandler }));
vi.mock('@/lib/outbox/publish', () => ({ publishEvent: mocks.publishEvent }));
vi.mock('@/lib/observability/metrics', () => ({ metrics: { emit: mocks.emit } }));
vi.mock('../state-log', () => ({
  logAppointmentStateChange: mocks.logAppointmentStateChange,
}));

import { appointments, waitlistEntries } from '../../schema';

import './patient-deleted';

type Handler = (ctx: {
  tx: unknown;
  clinicId: string;
  eventId: string;
  payload: { clinicId: string; patientId: string };
}) => Promise<void>;

const registrations = mocks.registerHandler.mock.calls as [string, Handler][];
const deletedHandler = registrations.find(([event]) => event === 'patient.core.deleted')![1];
const deceasedHandler = registrations.find(([event]) => event === 'patient.core.deceased')![1];

function transactionMock(
  future: { id: string; status: 'agendado' | 'confirmado' | 'chegou' }[],
  inProgress: { id: string }[] = [],
) {
  const selectResults = [future, inProgress];
  let selectIndex = 0;
  const select = vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn().mockImplementation(async () => selectResults[selectIndex++] ?? []),
    })),
  }));
  const where = vi.fn().mockResolvedValue(undefined);
  const set = vi.fn().mockReturnValue({ where });
  const update = vi.fn().mockReturnValue({ set });
  return { tx: { select, update }, update, set, where };
}

const context = (tx: unknown) => ({
  tx,
  clinicId: 'clinic-1',
  eventId: 'event-1',
  payload: { clinicId: 'clinic-1', patientId: 'patient-1' },
});

beforeEach(() => {
  mocks.publishEvent.mockReset().mockResolvedValue(undefined);
  mocks.logAppointmentStateChange.mockReset().mockResolvedValue(undefined);
  mocks.emit.mockClear();
});

describe('handlers de exclusão/falecimento do paciente', () => {
  it('registra os dois eventos canônicos do Patient', () => {
    expect(registrations.map(([event]) => event)).toEqual([
      'patient.core.deleted',
      'patient.core.deceased',
    ]);
  });

  it('cancela consulta futura e publica o motivo financeiro explícito', async () => {
    const { tx, update, set } = transactionMock([{ id: 'appointment-1', status: 'confirmado' }]);

    await deletedHandler(context(tx));

    expect(mocks.logAppointmentStateChange).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        clinicId: 'clinic-1',
        appointmentId: 'appointment-1',
        fromStatus: 'confirmado',
        toStatus: 'cancelado',
        reason: 'patient_deleted',
        sourceEventId: 'event-1',
      }),
    );
    expect(update).toHaveBeenNthCalledWith(1, appointments);
    expect(set).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ status: 'cancelado', updatedAt: expect.anything() }),
    );
    expect(update).toHaveBeenNthCalledWith(2, waitlistEntries);
    expect(mocks.publishEvent).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        clinicId: 'clinic-1',
        eventType: 'scheduling.appointment.cancelled',
        idempotencyKey: 'patient_deleted:event-1:appointment-1',
        correlationId: 'event-1',
        payload: expect.objectContaining({
          appointmentId: 'appointment-1',
          cancelReason: 'patient_deleted',
          reason: 'patient_deleted',
        }),
      }),
    );
  });

  it('não cancela atendimento em curso e emite a métrica correspondente', async () => {
    const { tx } = transactionMock([], [{ id: 'appointment-in-progress' }]);

    await deceasedHandler(context(tx));

    expect(mocks.logAppointmentStateChange).not.toHaveBeenCalled();
    expect(mocks.publishEvent).not.toHaveBeenCalled();
    expect(mocks.emit).toHaveBeenCalledWith('scheduling.patient_deceased.in_progress_skipped', {
      clinicId: 'clinic-1',
      patientId: 'patient-1',
      count: 1,
    });
  });
});
