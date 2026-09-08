import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  registerDetachedHandler: vi.fn(),
  withTenant: vi.fn(),
  scheduleNoShowFollowup: vi.fn(),
  handleAppointmentNoShowPayment: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/outbox/registry', () => ({
  registerDetachedHandler: mocks.registerDetachedHandler,
}));
vi.mock('@/lib/db/tenant', () => ({ withTenant: mocks.withTenant }));
vi.mock('@/contexts/scheduling', () => ({
  SCHEDULING_EVENTS: { NO_SHOW: 'scheduling.appointment.no_show' },
}));
vi.mock('@/contexts/ai-agent/proactive-jobs/internal/handlers/appointment-no-show', () => ({
  scheduleNoShowFollowup: mocks.scheduleNoShowFollowup,
}));
vi.mock('@/contexts/payments/internal/handlers/appointment-no-show', () => ({
  handleAppointmentNoShowPayment: mocks.handleAppointmentNoShowPayment,
}));

import './appointment-no-show-handler';

const registration = mocks.registerDetachedHandler.mock.calls[0]!;
type Handler = (ctx: {
  clinicId: string;
  payload: Record<string, unknown>;
  eventId: string;
  attempt: number;
}) => Promise<void>;
const handler = registration[1] as Handler;

const ctx = {
  clinicId: '11111111-1111-1111-1111-111111111111',
  payload: {
    appointmentId: '22222222-2222-2222-2222-222222222222',
    clinicId: 'clinic-INTRUSA',
    patientId: '33333333-3333-3333-3333-333333333333',
    fromStatus: 'confirmado',
    toStatus: 'faltou',
    noShowAt: '2026-09-04T15:00:00.000Z',
  },
  eventId: 'evt-1',
  attempt: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.withTenant.mockImplementation(async (_clinicId, fn) => fn('TX'));
});

describe('composição do no-show no outbox', () => {
  it('registra um único handler detached para o evento existente', () => {
    expect(registration[0]).toBe('scheduling.appointment.no_show');
  });

  it('persiste a C14 em TX tenant-scoped antes da fase externa de Payments', async () => {
    await handler(ctx);

    expect(mocks.withTenant).toHaveBeenCalledWith(ctx.clinicId, expect.any(Function));
    expect(mocks.scheduleNoShowFollowup).toHaveBeenCalledWith({ ...ctx, tx: 'TX' });
    expect(mocks.handleAppointmentNoShowPayment).toHaveBeenCalledWith(ctx);
    expect(mocks.scheduleNoShowFollowup.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.handleAppointmentNoShowPayment.mock.invocationCallOrder[0]!,
    );
  });

  it('não chama o Asaas se a persistência tenant-scoped falhar', async () => {
    mocks.withTenant.mockRejectedValueOnce(new Error('db unavailable'));

    await expect(handler(ctx)).rejects.toThrow('db unavailable');
    expect(mocks.handleAppointmentNoShowPayment).not.toHaveBeenCalled();
  });
});
