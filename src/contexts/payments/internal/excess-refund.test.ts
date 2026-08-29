import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  client: {
    listPaymentRefunds: vi.fn(),
    refundPayment: vi.fn(),
  },
  getClinicAsaasClient: vi.fn(),
  publishEvent: vi.fn(),
  withTenant: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/payments/account-store', () => ({
  getClinicAsaasClient: mocks.getClinicAsaasClient,
}));
vi.mock('@/lib/outbox/publish', () => ({ publishEvent: mocks.publishEvent }));
vi.mock('@/lib/db/tenant', () => ({ withTenant: mocks.withTenant }));
vi.mock('@/lib/observability/metrics', () => ({ metrics: { emit: vi.fn() } }));

import { BillingProviderError, BillingProviderUnreachableError } from '@/lib/payments/asaas';

import { patientCharges, patientRefundIntents } from '../schema';
import {
  confirmRefundIntentFromReadback,
  confirmedRefundTotal,
  reconcileRefundIntentsForPayment,
  requestExcessRefund,
} from './excess-refund';

const CLINIC = '11111111-1111-4111-8111-111111111111';
const CHARGE = '22222222-2222-4222-8222-222222222222';
const APPOINTMENT = '33333333-3333-4333-8333-333333333333';
const EVENT = '44444444-4444-4444-8444-444444444444';
const INTENT = '55555555-5555-4555-8555-555555555555';

interface IntentState {
  id: string;
  patientChargeId: string;
  amount: string;
  providerPaymentId: string;
  providerRefundId: string | null;
  baselineRefundedAmount: string | null;
  status: 'pending' | 'submitting' | 'confirmation_pending' | 'confirmed' | 'failed';
  failureCode?: string | null;
}

let intent: IntentState | null;

function resultWithReturning(result: () => unknown[]) {
  return {
    then(resolve: (value: unknown) => unknown) {
      result();
      return Promise.resolve(resolve(undefined));
    },
    returning: async () => result(),
  };
}

function installStatefulTx(): void {
  const tx = {
    insert: (table: unknown) => ({
      values: (value: Record<string, unknown>) => {
        if (table === patientRefundIntents && !intent) {
          intent = {
            id: INTENT,
            patientChargeId: String(value.patientChargeId),
            amount: String(value.amount),
            providerPaymentId: String(value.providerPaymentId),
            providerRefundId: null,
            baselineRefundedAmount: null,
            status: 'pending',
          };
        }
        return {
          onConflictDoNothing: async () => undefined,
        };
      },
    }),
    select: () => ({
      from: (table: unknown) => ({
        where: () => {
          const rows =
            table === patientCharges
              ? [{ id: CHARGE, providerPaymentId: 'pay_1', appointmentId: APPOINTMENT }]
              : intent
                ? [{ ...intent }]
                : [];
          return {
            limit: async () => rows,
            for: () => ({ limit: async () => rows }),
          };
        },
      }),
    }),
    update: (table: unknown) => ({
      set: (value: Record<string, unknown>) => ({
        where: () =>
          resultWithReturning(() => {
            if (table !== patientRefundIntents || !intent) return [];
            intent = { ...intent, ...value } as IntentState;
            return [{ id: INTENT }];
          }),
      }),
    }),
  };
  mocks.withTenant.mockImplementation(
    async (_clinicId: string, operation: (innerTx: typeof tx) => unknown) => operation(tx),
  );
}

const payload = {
  clinicId: CLINIC,
  appointmentId: APPOINTMENT,
  chargeId: CHARGE,
  amount: 30,
  requestedAt: '2026-08-29T12:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  intent = null;
  installStatefulTx();
  mocks.getClinicAsaasClient.mockResolvedValue(mocks.client);
});

describe('D50 — estorno exato do excedente', () => {
  it('soma somente estornos autoritativamente confirmados', () => {
    expect(
      confirmedRefundTotal([
        { refundId: 'a', status: 'REFUNDED', value: 10 },
        { refundId: 'b', status: 'PENDING', value: 50 },
        { refundId: 'c', status: 'DONE', value: 20 },
      ]),
    ).toBe(30);
  });

  it('webhook sem intenção D50 aberta não faz outra chamada ao provider', async () => {
    mocks.withTenant.mockResolvedValueOnce([]);
    const loadRefunds = vi.fn();
    await expect(
      reconcileRefundIntentsForPayment({
        clinicId: CLINIC,
        providerPaymentId: 'pay_1',
        loadRefunds,
      }),
    ).resolves.toBe(0);
    expect(loadRefunds).not.toHaveBeenCalled();
  });

  it('persiste antes do POST, envia o valor exato e confirma por read-back', async () => {
    mocks.client.listPaymentRefunds
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ refundId: 'ref_1', status: 'REFUNDED', value: 30 }]);
    mocks.client.refundPayment.mockResolvedValue({
      refundId: 'ref_1',
      status: 'PENDING',
      value: 30,
    });

    await expect(
      requestExcessRefund({ clinicId: CLINIC, payload, sourceEventId: EVENT }),
    ).resolves.toBe('submitted');

    expect(mocks.client.refundPayment).toHaveBeenCalledWith('pay_1', {
      value: 30,
      description: 'Estorno de valor pago acima do saldo do atendimento',
    });
    expect(intent).toMatchObject({
      status: 'confirmed',
      baselineRefundedAmount: '0.00',
      providerRefundId: 'ref_1',
    });
    expect(mocks.publishEvent).toHaveBeenCalledOnce();
  });

  it('timeout depois do POST não repete cegamente o estorno', async () => {
    mocks.client.listPaymentRefunds.mockResolvedValue([]);
    mocks.client.refundPayment.mockRejectedValue(new BillingProviderUnreachableError('timeout'));

    await expect(
      requestExcessRefund({ clinicId: CLINIC, payload, sourceEventId: EVENT }),
    ).resolves.toBe('submitted');
    await expect(
      requestExcessRefund({ clinicId: CLINIC, payload, sourceEventId: EVENT }),
    ).resolves.toBe('already_started');

    expect(mocks.client.refundPayment).toHaveBeenCalledTimes(1);
    expect(intent).toMatchObject({ status: 'confirmation_pending' });
  });

  it('recusa definitivamente 4xx e não publica confirmação falsa', async () => {
    mocks.client.listPaymentRefunds.mockResolvedValue([]);
    mocks.client.refundPayment.mockRejectedValue(
      new BillingProviderError('recusado', 'billing_provider_error', 400, ['invalid_value']),
    );

    await expect(
      requestExcessRefund({ clinicId: CLINIC, payload, sourceEventId: EVENT }),
    ).resolves.toBe('failed');
    expect(intent).toMatchObject({ status: 'failed', failureCode: 'invalid_value' });
    expect(mocks.publishEvent).not.toHaveBeenCalled();
  });

  it('read-back negado encerra a intenção sem confirmar o ledger', async () => {
    intent = {
      id: INTENT,
      patientChargeId: CHARGE,
      amount: '30.00',
      providerPaymentId: 'pay_1',
      providerRefundId: 'ref_denied',
      baselineRefundedAmount: '0.00',
      status: 'confirmation_pending',
    };

    await expect(
      confirmRefundIntentFromReadback({
        clinicId: CLINIC,
        intentId: INTENT,
        refunds: [{ refundId: 'ref_denied', status: 'DENIED', value: 30 }],
      }),
    ).resolves.toBe(false);
    expect(intent).toMatchObject({ status: 'failed', failureCode: 'refund_denied' });
    expect(mocks.publishEvent).not.toHaveBeenCalled();
  });
});
