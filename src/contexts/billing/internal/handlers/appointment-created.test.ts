import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  registerHandler: vi.fn(),
  currentPeriod: vi.fn(() => '2026-08'),
  recordUsage: vi.fn(),
  ledgerKeyFor: vi.fn(() => ({
    metric: 'agendamentos',
    subjectId: 'appointment-1',
    dedupKey: 'appointment-1',
  })),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/outbox/registry', () => ({ registerHandler: mocks.registerHandler }));
vi.mock('@/contexts/scheduling', () => ({
  SCHEDULING_EVENTS: { CREATED: 'scheduling.appointment.created' },
}));
vi.mock('../quota', () => ({
  currentPeriod: mocks.currentPeriod,
  recordUsage: mocks.recordUsage,
}));
vi.mock('../quota-policy', () => ({ ledgerKeyFor: mocks.ledgerKeyFor }));

import './appointment-created';

type Handler = (ctx: {
  tx: unknown;
  clinicId: string;
  payload: { appointmentId: string; createdVia?: string };
}) => Promise<void>;

const registration = mocks.registerHandler.mock.calls[0]!;
const handler = registration[1] as Handler;

beforeEach(() => {
  mocks.currentPeriod.mockClear();
  mocks.recordUsage.mockReset().mockResolvedValue(true);
  mocks.ledgerKeyFor.mockClear();
});

describe('handler de uso por agendamento', () => {
  it('registra-se no evento público da agenda', () => {
    expect(registration[0]).toBe('scheduling.appointment.created');
  });

  it('conta uma vez usando a chave idempotente do appointment', async () => {
    await handler({
      tx: 'TX',
      clinicId: 'clinic-1',
      payload: { appointmentId: 'appointment-1', createdVia: 'ui' },
    });

    expect(mocks.ledgerKeyFor).toHaveBeenCalledWith('agendamento', {
      appointmentId: 'appointment-1',
    });
    expect(mocks.recordUsage).toHaveBeenCalledWith(
      'TX',
      'clinic-1',
      { metric: 'agendamentos', subjectId: 'appointment-1', dedupKey: 'appointment-1' },
      '2026-08',
    );
  });

  it('não mede carga histórica importada', async () => {
    await handler({
      tx: 'TX',
      clinicId: 'clinic-1',
      payload: { appointmentId: 'appointment-1', createdVia: 'import' },
    });

    expect(mocks.ledgerKeyFor).not.toHaveBeenCalled();
    expect(mocks.recordUsage).not.toHaveBeenCalled();
  });
});
