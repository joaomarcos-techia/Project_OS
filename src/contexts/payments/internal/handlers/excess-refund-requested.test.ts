import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  registerDetachedHandler: vi.fn(),
  queueManualExcessRefund: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/outbox/registry', () => ({
  registerDetachedHandler: mocks.registerDetachedHandler,
}));
vi.mock('@/contexts/financial', () => ({
  FINANCIAL_EVENTS: { EXCESS_REFUND_REQUESTED: 'financial.patient_refund.requested' },
}));
vi.mock('../excess-refund', () => ({ queueManualExcessRefund: mocks.queueManualExcessRefund }));

import './excess-refund-requested';

type Handler = (ctx: {
  clinicId: string;
  payload: Record<string, unknown>;
  eventId: string;
}) => Promise<void>;
const registration = mocks.registerDetachedHandler.mock.calls[0]!;
const handler = registration[1] as Handler;

describe('handler financial.patient_refund.requested', () => {
  it('encaminha o evento e sua identidade para a intenção idempotente', async () => {
    const payload = {
      clinicId: 'clinic-1',
      appointmentId: 'apt-1',
      chargeId: 'charge-1',
      amount: 30,
      requestedAt: '2026-08-29T12:00:00.000Z',
    };
    await handler({ clinicId: 'clinic-1', payload, eventId: 'event-1' });
    expect(registration[0]).toBe('financial.patient_refund.requested');
    expect(mocks.queueManualExcessRefund).toHaveBeenCalledWith({
      clinicId: 'clinic-1',
      payload,
      sourceEventId: 'event-1',
    });
  });
});
