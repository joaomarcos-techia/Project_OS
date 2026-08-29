import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  publishEvent: vi.fn(),
  withTenant: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db/tenant', () => ({ withTenant: mocks.withTenant }));
vi.mock('@/lib/outbox/publish', () => ({ publishEvent: mocks.publishEvent }));

import type { ProviderPayment } from '@/lib/payments/asaas';

import { patientCharges } from '../schema';
import { classifyPatientPaymentRisk, reconcilePatientPaymentRisk } from './patient-payment-risk';

const CLINIC = '11111111-1111-4111-8111-111111111111';
const CHARGE = '22222222-2222-4222-8222-222222222222';
const APPOINTMENT = '33333333-3333-4333-8333-333333333333';

const payment = (overrides: Partial<ProviderPayment> = {}): ProviderPayment => ({
  paymentId: 'pay_1',
  status: 'CONFIRMED',
  value: 100,
  dueDate: '2026-08-29',
  invoiceUrl: null,
  subscriptionId: null,
  billingType: 'CREDIT_CARD',
  externalReference: null,
  checkoutSessionId: null,
  deleted: false,
  ...overrides,
});

function installTx(opts: { dedup?: boolean; disputeStatus?: string | null } = {}): void {
  let currentDispute = opts.disputeStatus ?? null;
  const tx = {
    insert: () => ({
      values: () => ({
        onConflictDoNothing: () => ({
          returning: async () => (opts.dedup === false ? [] : [{ id: 'webhook-row' }]),
        }),
      }),
    }),
    select: () => ({
      from: (table: unknown) => ({
        where: () => ({
          for: () => ({
            limit: async () =>
              table === patientCharges
                ? [
                    {
                      id: CHARGE,
                      appointmentId: APPOINTMENT,
                      amount: '100.00',
                      disputeStatus: currentDispute,
                    },
                  ]
                : [],
          }),
        }),
      }),
    }),
    update: () => ({
      set: (value: { disputeStatus?: string }) => ({
        where: async () => {
          if (value.disputeStatus) currentDispute = value.disputeStatus;
        },
      }),
    }),
  };
  mocks.withTenant.mockImplementation(
    async (_clinicId: string, operation: (innerTx: typeof tx) => unknown) => operation(tx),
  );
}

beforeEach(() => vi.clearAllMocks());

describe('classifyPatientPaymentRisk', () => {
  it.each([
    ['REQUESTED', 'requested'],
    ['IN_DISPUTE', 'in_dispute'],
    ['DISPUTE_LOST', 'lost'],
  ] as const)('normaliza chargeback %s', (chargebackStatus, expected) => {
    expect(
      classifyPatientPaymentRisk('PAYMENT_CHARGEBACK_DISPUTE', payment({ chargebackStatus })),
    ).toBe(expected);
  });

  it('só confirma reversão quando o dinheiro voltou ao estado pago', () => {
    expect(
      classifyPatientPaymentRisk(
        'PAYMENT_CONFIRMED',
        payment({ chargebackStatus: 'REVERSED', status: 'CONFIRMED' }),
      ),
    ).toBe('reversed');
    expect(
      classifyPatientPaymentRisk(
        'PAYMENT_AWAITING_CHARGEBACK_REVERSAL',
        payment({ chargebackStatus: 'REVERSED', status: 'PENDING' }),
      ),
    ).toBe('awaiting_reversal');
  });

  it('dinheiro desfeito exige estado autoritativo não pago', () => {
    expect(
      classifyPatientPaymentRisk(
        'PAYMENT_RECEIVED_IN_CASH_UNDONE',
        payment({ status: 'PENDING', billingType: 'UNDEFINED' }),
      ),
    ).toBe('cash_undone');
    expect(
      classifyPatientPaymentRisk(
        'PAYMENT_RECEIVED_IN_CASH_UNDONE',
        payment({ status: 'RECEIVED_IN_CASH' }),
      ),
    ).toBeNull();
  });
});

describe('reconcilePatientPaymentRisk', () => {
  const input = {
    clinicId: CLINIC,
    providerPaymentId: 'pay_1',
    asaasEventId: 'evt_1',
    eventType: 'PAYMENT_CHARGEBACK_REQUESTED',
    state: 'requested' as const,
    changedAt: new Date('2026-08-29T12:00:00.000Z'),
  };

  it('grava estado e publica contrato sem dado sensível', async () => {
    installTx();

    await expect(reconcilePatientPaymentRisk(input)).resolves.toBe('changed');
    expect(mocks.publishEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventType: 'payments.patient_payment.risk_changed',
        idempotencyKey: `patient-payment-risk:${CHARGE}:requested`,
        payload: expect.objectContaining({
          clinicId: CLINIC,
          appointmentId: APPOINTMENT,
          chargeId: CHARGE,
          state: 'requested',
        }),
      }),
    );
  });

  it('replay do mesmo webhook não publica novamente', async () => {
    installTx({ dedup: false });
    await expect(reconcilePatientPaymentRisk(input)).resolves.toBe('ignored');
    expect(mocks.publishEvent).not.toHaveBeenCalled();
  });

  it('estado terminal não regride com evento fora de ordem', async () => {
    installTx({ disputeStatus: 'lost' });
    await expect(reconcilePatientPaymentRisk({ ...input, state: 'in_dispute' })).resolves.toBe(
      'unchanged',
    );
    expect(mocks.publishEvent).not.toHaveBeenCalled();
  });
});
