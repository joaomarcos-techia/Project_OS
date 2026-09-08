/**
 * Handler `scheduling.appointment.no_show` → sinal retido (1.5, ramo A).
 *
 * Fase Payments apenas — a composição detached vive no app e a regra de
 * retenção permanece em `charge-closeout.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  closeChargeForNoShow: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('../charge-closeout', () => ({ closeChargeForNoShow: mocks.closeChargeForNoShow }));

import { handleAppointmentNoShowPayment } from './appointment-no-show';

beforeEach(() => {
  mocks.closeChargeForNoShow.mockClear();
});

describe('handler de falta', () => {
  it('usa o clinicId do worker (contexto RLS), não o do payload', async () => {
    await handleAppointmentNoShowPayment({
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
