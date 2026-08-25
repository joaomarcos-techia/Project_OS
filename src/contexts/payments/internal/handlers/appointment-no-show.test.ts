/**
 * Handler `scheduling.appointment.no_show` → sinal retido (1.5, ramo A).
 *
 * Fiação apenas — a regra de retenção vive em `charge-closeout.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  registerDetachedHandler: vi.fn(),
  registerHandler: vi.fn(),
  closeChargeForNoShow: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/outbox/registry', () => ({
  registerDetachedHandler: mocks.registerDetachedHandler,
  registerHandler: mocks.registerHandler,
}));
vi.mock('@/contexts/scheduling', () => ({
  SCHEDULING_EVENTS: { NO_SHOW: 'scheduling.appointment.no_show' },
}));
vi.mock('../charge-closeout', () => ({ closeChargeForNoShow: mocks.closeChargeForNoShow }));

import './appointment-no-show';

const registration = mocks.registerDetachedHandler.mock.calls[0]!;
type Handler = (ctx: { clinicId: string; payload: Record<string, unknown> }) => Promise<void>;
const handler = registration[1] as Handler;

beforeEach(() => {
  mocks.closeChargeForNoShow.mockClear();
});

describe('handler de falta', () => {
  it('registra-se no evento de no-show do Scheduling', () => {
    expect(registration[0]).toBe('scheduling.appointment.no_show');
  });

  it('é DETACHED: nunca chama o Asaas dentro da transação do worker', () => {
    expect(mocks.registerHandler).not.toHaveBeenCalled();
  });

  it('usa o clinicId do worker (contexto RLS), não o do payload', async () => {
    await handler({
      clinicId: 'clinic-1',
      payload: {
        appointmentId: 'apt-1',
        clinicId: 'clinic-INTRUSA',
        patientId: 'pac-1',
        fromStatus: 'agendado',
        toStatus: 'faltou',
      },
    });

    expect(mocks.closeChargeForNoShow).toHaveBeenCalledWith({
      clinicId: 'clinic-1',
      appointmentId: 'apt-1',
    });
  });
});
