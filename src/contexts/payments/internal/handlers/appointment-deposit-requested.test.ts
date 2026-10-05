import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  registerDetachedHandler: vi.fn(),
  lookupDepositCandidate: vi.fn(),
  createDepositCharge: vi.fn(),
  emit: vi.fn(),
}));

vi.mock('@/lib/outbox/registry', () => ({
  registerDetachedHandler: mocks.registerDetachedHandler,
}));
vi.mock('@/lib/observability/metrics', () => ({ metrics: { emit: mocks.emit } }));
vi.mock('@/contexts/scheduling', () => ({
  SCHEDULING_EVENTS: { DEPOSIT_REQUESTED: 'scheduling.appointment.deposit_requested' },
  schedulingApiV1: { lookupDepositCandidate: mocks.lookupDepositCandidate },
}));
vi.mock('../deposit-charge', () => ({ createDepositCharge: mocks.createDepositCharge }));

import './appointment-deposit-requested';

const CLINIC = '11111111-1111-4111-8111-111111111111';
const APPOINTMENT = '22222222-2222-4222-8222-222222222222';
const candidate = {
  clinicId: CLINIC,
  appointmentId: APPOINTMENT,
  patientId: '33333333-3333-4333-8333-333333333333',
  scheduledAt: '2026-10-10T12:00:00.000Z',
  valor: 180,
  commercialPaymentMethod: 'pix',
  commercialInstallmentCount: null,
};
const handler = mocks.registerDetachedHandler.mock.calls[0]?.[1];
const context = {
  clinicId: CLINIC,
  payload: { clinicId: CLINIC, appointmentId: APPOINTMENT },
  eventId: '44444444-4444-4444-8444-444444444444',
  attempt: 1,
};

beforeEach(() => {
  mocks.lookupDepositCandidate.mockReset();
  mocks.createDepositCharge.mockReset();
  mocks.emit.mockReset();
  mocks.lookupDepositCandidate.mockResolvedValue(candidate);
});

describe('pedido acelerado de sinal da IA', () => {
  it('registra um consumidor detached e usa o snapshot da agenda no tenant', async () => {
    expect(mocks.registerDetachedHandler).toHaveBeenCalledWith(
      'scheduling.appointment.deposit_requested',
      expect.any(Function),
    );
    await handler(context);
    expect(mocks.lookupDepositCandidate).toHaveBeenCalledWith(CLINIC, APPOINTMENT);
    expect(mocks.createDepositCharge).toHaveBeenCalledWith({
      clinicId: CLINIC,
      appointment: candidate,
    });
  });

  it('não cobra agendamento cancelado, passado ou de outro tenant', async () => {
    mocks.lookupDepositCandidate.mockResolvedValue(null);
    await handler(context);
    expect(mocks.createDepositCharge).not.toHaveBeenCalled();
    expect(mocks.emit).toHaveBeenCalledWith('payments.deposit.request_skipped_ineligible', {
      clinicId: CLINIC,
      appointmentId: APPOINTMENT,
    });
  });

  it('rejeita divergência entre tenant do evento e payload antes da leitura', async () => {
    await expect(
      handler({ ...context, payload: { ...context.payload, clinicId: 'outro-tenant' } }),
    ).rejects.toThrow('clínica do pedido de sinal difere do evento');
    expect(mocks.lookupDepositCandidate).not.toHaveBeenCalled();
    expect(mocks.createDepositCharge).not.toHaveBeenCalled();
  });
});
