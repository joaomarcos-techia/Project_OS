import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  registerHandler: vi.fn(),
  recordExcessRefund: vi.fn(),
  applyPatientPaymentRisk: vi.fn(),
  refreshProfessionalPayout: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/outbox/registry', () => ({ registerHandler: mocks.registerHandler }));
vi.mock('@/contexts/payments', () => ({
  PAYMENTS_EVENTS: {
    EXCESS_REFUND_CONFIRMED: 'payments.patient_refund.confirmed',
    PATIENT_PAYMENT_RISK_CHANGED: 'payments.patient_payment.risk_changed',
  },
}));
vi.mock('../patient-credit-adjustment', () => ({
  recordExcessRefund: mocks.recordExcessRefund,
  applyPatientPaymentRisk: mocks.applyPatientPaymentRisk,
}));
vi.mock('../professional-payout', () => ({
  refreshProfessionalPayout: mocks.refreshProfessionalPayout,
}));

import { PoisonPillError } from '@/lib/outbox/errors';

import './excess-refund-confirmed';
import './patient-payment-risk-changed';

const registrations = mocks.registerHandler.mock.calls.map((call) => [...call]);

type Handler = (ctx: {
  tx: unknown;
  clinicId: string;
  payload: Record<string, unknown>;
  eventId: string;
}) => Promise<void>;

function handlerFor(eventType: string): Handler {
  const registration = registrations.find(([event]) => event === eventType);
  if (!registration) throw new Error(`handler ${eventType} não registrado`);
  return registration[1] as Handler;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.recordExcessRefund.mockResolvedValue('recorded');
  mocks.applyPatientPaymentRisk.mockResolvedValue('loss_recorded');
});

describe('handlers de ajuste financeiro do paciente', () => {
  it('confirma D50 dentro da transação do outbox', async () => {
    const payload = {
      clinicId: 'clinic-1',
      appointmentId: 'apt-1',
      chargeId: 'charge-1',
      refundIntentId: 'intent-1',
      amount: 30,
      confirmedAt: '2026-08-29T12:00:00.000Z',
    };
    await handlerFor('payments.patient_refund.confirmed')({
      tx: 'TX',
      clinicId: 'clinic-1',
      payload,
      eventId: 'event-1',
    });
    expect(mocks.recordExcessRefund).toHaveBeenCalledWith('TX', {
      clinicId: 'clinic-1',
      appointmentId: 'apt-1',
      patientChargeId: 'charge-1',
      amount: 30,
      sourceEventId: 'event-1',
      occurredAt: new Date('2026-08-29T12:00:00.000Z'),
    });
    expect(mocks.refreshProfessionalPayout).toHaveBeenCalledWith('TX', {
      clinicId: 'clinic-1',
      appointmentId: 'apt-1',
    });
  });

  it('projeta D27 dentro da transação do outbox', async () => {
    const payload = {
      clinicId: 'clinic-1',
      appointmentId: 'apt-1',
      chargeId: 'charge-1',
      amount: 100,
      state: 'lost',
      reason: 'COMMERCIAL_DISAGREEMENT',
      changedAt: '2026-08-29T12:00:00.000Z',
    };
    await handlerFor('payments.patient_payment.risk_changed')({
      tx: 'TX',
      clinicId: 'clinic-1',
      payload,
      eventId: 'event-2',
    });
    expect(mocks.applyPatientPaymentRisk).toHaveBeenCalledWith('TX', {
      clinicId: 'clinic-1',
      payload,
      sourceEventId: 'event-2',
    });
    expect(mocks.refreshProfessionalPayout).toHaveBeenCalledWith('TX', {
      clinicId: 'clinic-1',
      appointmentId: 'apt-1',
    });
  });

  it('reentrega de estorno e disputa aberta não recalculam repasse', async () => {
    mocks.recordExcessRefund.mockResolvedValue('duplicate');
    await handlerFor('payments.patient_refund.confirmed')({
      tx: 'TX',
      clinicId: 'clinic-1',
      payload: {
        clinicId: 'clinic-1',
        appointmentId: 'apt-1',
        chargeId: 'charge-1',
        amount: 30,
        confirmedAt: '2026-08-29T12:00:00.000Z',
      },
      eventId: 'event-1',
    });
    mocks.applyPatientPaymentRisk.mockResolvedValue('dispute_opened');
    await handlerFor('payments.patient_payment.risk_changed')({
      tx: 'TX',
      clinicId: 'clinic-1',
      payload: { clinicId: 'clinic-1', appointmentId: 'apt-1' },
      eventId: 'event-2',
    });
    expect(mocks.refreshProfessionalPayout).not.toHaveBeenCalled();
  });

  it.each(['payments.patient_refund.confirmed', 'payments.patient_payment.risk_changed'])(
    '%s rejeita clínica divergente como poison pill',
    async (eventType) => {
      const error = await handlerFor(eventType)({
        tx: 'TX',
        clinicId: 'clinic-1',
        payload: { clinicId: 'clinic-2' },
        eventId: 'event-3',
      }).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(PoisonPillError);
    },
  );
});
