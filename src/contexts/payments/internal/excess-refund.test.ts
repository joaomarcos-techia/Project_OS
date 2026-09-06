import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  client: {
    listPaymentRefunds: vi.fn(),
    refundPayment: vi.fn(),
  },
  closeChargeInTransaction: vi.fn(),
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
vi.mock('./charge-store', () => ({
  closeChargeInTransaction: mocks.closeChargeInTransaction,
}));

import { BillingProviderError, BillingProviderUnreachableError } from '@/lib/payments/asaas';

import { patientCharges, patientRefundIntents } from '../schema';
import {
  confirmRefundIntentFromReadback,
  confirmedRefundTotal,
  reconcileRefundIntentsForPayment,
  rejectedRefundCount,
  requestDepositRefund,
  requestExcessRefund,
} from './excess-refund';

const CLINIC = '11111111-1111-4111-8111-111111111111';
const CHARGE = '22222222-2222-4222-8222-222222222222';
const APPOINTMENT = '33333333-3333-4333-8333-333333333333';
const EVENT = '44444444-4444-4444-8444-444444444444';
const INTENT = '55555555-5555-4555-8555-555555555555';

type IntentStatus = 'pending' | 'submitting' | 'confirmation_pending' | 'confirmed' | 'failed';

interface IntentState {
  id: string;
  patientChargeId: string;
  amount: string;
  purpose: string;
  providerPaymentId: string;
  providerRefundId: string | null;
  baselineRefundedAmount: string | null;
  baselineRefundCount: number | null;
  baselineRejectedRefundCount: number | null;
  status: IntentStatus;
  failureCode?: string | null;
  confirmedAt?: Date | null;
}

let intent: IntentState | null;
let chargeKind: 'deposit' | 'remainder';
let chargeAmount: string;

function transitionAllowed(current: IntentStatus, next: IntentStatus): boolean {
  if (next === 'submitting') return current === 'pending';
  if (next === 'confirmation_pending') {
    return current === 'submitting' || current === 'confirmation_pending';
  }
  if (next === 'confirmed') {
    return current === 'submitting' || current === 'confirmation_pending';
  }
  if (next === 'failed') {
    return current === 'pending' || current === 'submitting' || current === 'confirmation_pending';
  }
  return current === 'submitting';
}

function resultWithReturning(result: () => unknown[]) {
  return {
    then(resolve: (value: unknown) => unknown) {
      result();
      return Promise.resolve(resolve(undefined));
    },
    returning: async () => result(),
  };
}

function rowsResult(rows: unknown[]) {
  return {
    then(resolve: (value: unknown) => unknown) {
      return Promise.resolve(resolve(rows));
    },
    limit: async () => rows,
    for: () => ({ limit: async () => rows }),
    orderBy: () => ({ limit: async () => rows }),
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
            purpose: String(value.purpose),
            providerPaymentId: String(value.providerPaymentId),
            providerRefundId: null,
            baselineRefundedAmount: null,
            baselineRefundCount: null,
            baselineRejectedRefundCount: null,
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
              ? [
                  {
                    id: CHARGE,
                    providerPaymentId: 'pay_1',
                    appointmentId: APPOINTMENT,
                    kind: chargeKind,
                    amount: chargeAmount,
                  },
                ]
              : intent
                ? [{ ...intent }]
                : [];
          return rowsResult(rows);
        },
      }),
    }),
    update: (table: unknown) => ({
      set: (value: Record<string, unknown>) => ({
        where: () =>
          resultWithReturning(() => {
            if (table !== patientRefundIntents || !intent) return [];
            const next = value.status as IntentStatus | undefined;
            if (next && !transitionAllowed(intent.status, next)) return [];
            const defined = Object.fromEntries(
              Object.entries(value).filter(([, field]) => field !== undefined),
            );
            intent = { ...intent, ...defined } as IntentState;
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

function pendingIntent(over: Partial<IntentState> = {}): IntentState {
  return {
    id: INTENT,
    patientChargeId: CHARGE,
    amount: '30.00',
    purpose: 'excess',
    providerPaymentId: 'pay_1',
    providerRefundId: 'ref_1',
    baselineRefundedAmount: '0.00',
    baselineRefundCount: 0,
    baselineRejectedRefundCount: 0,
    status: 'confirmation_pending',
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  intent = null;
  chargeKind = 'remainder';
  chargeAmount = '130.00';
  installStatefulTx();
  mocks.getClinicAsaasClient.mockResolvedValue(mocks.client);
  mocks.closeChargeInTransaction.mockResolvedValue(true);
});

describe('contrato autoritativo do estorno', () => {
  it('soma somente DONE; a existência do refund ou status parecido não confirma devolução', () => {
    expect(
      confirmedRefundTotal([
        { refundId: 'a', status: 'REFUNDED', value: 10 },
        { refundId: 'b', status: 'PENDING', value: 50 },
        { refundId: 'c', status: 'DONE', value: 20 },
      ]),
    ).toBe(20);
  });

  it('conta CANCELLED e recusas como terminais sem confundi-las com DONE', () => {
    expect(
      rejectedRefundCount([
        { refundId: null, status: 'CANCELLED', value: 10 },
        { refundId: 'b', status: 'FAILED', value: 10 },
        { refundId: 'c', status: 'DONE', value: 10 },
      ]),
    ).toBe(2);
  });

  it('webhook sem intenção aberta não faz outra chamada ao provider', async () => {
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
});

describe('D50 — estorno exato do excedente', () => {
  it('persiste antes do POST, grava baseline e confirma por DONE no read-back', async () => {
    mocks.client.listPaymentRefunds
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ refundId: 'ref_1', status: 'DONE', value: 30 }]);
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
      baselineRefundCount: 0,
      baselineRejectedRefundCount: 0,
      providerRefundId: 'ref_1',
    });
    expect(mocks.publishEvent).toHaveBeenCalledOnce();
  });

  it('falha no GET anterior ao POST deixa pending e permite retry seguro', async () => {
    mocks.client.listPaymentRefunds
      .mockRejectedValueOnce(new Error('get timeout'))
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    mocks.client.refundPayment.mockResolvedValue({
      refundId: 'ref_1',
      status: 'PENDING',
      value: 30,
    });

    await expect(
      requestExcessRefund({ clinicId: CLINIC, payload, sourceEventId: EVENT }),
    ).rejects.toThrow('get timeout');
    expect(intent).toMatchObject({ status: 'pending', baselineRefundedAmount: null });

    await expect(
      requestExcessRefund({ clinicId: CLINIC, payload, sourceEventId: EVENT }),
    ).resolves.toBe('submitted');
    expect(mocks.client.refundPayment).toHaveBeenCalledTimes(1);
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
    expect(intent).toMatchObject({
      status: 'confirmation_pending',
      baselineRefundCount: 0,
      baselineRejectedRefundCount: 0,
    });
  });

  it('recusa 4xx encerra a intenção sem publicar confirmação falsa', async () => {
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
});

describe('D77 — estado terminal e closeout do sinal', () => {
  it('PENDING não fecha cobrança nem publica liberação', async () => {
    intent = pendingIntent();

    await expect(
      confirmRefundIntentFromReadback({
        clinicId: CLINIC,
        intentId: INTENT,
        refunds: [{ refundId: 'ref_1', status: 'PENDING', value: 30 }],
      }),
    ).resolves.toBe('pending');

    expect(intent).toMatchObject({ status: 'confirmation_pending' });
    expect(mocks.closeChargeInTransaction).not.toHaveBeenCalled();
    expect(mocks.publishEvent).not.toHaveBeenCalled();
  });

  it('CANCELLED por id encerra como falha e não fecha cobrança', async () => {
    intent = pendingIntent({ purpose: 'deposit_closeout', amount: '150.00' });
    chargeKind = 'deposit';
    chargeAmount = '150.00';

    await expect(
      confirmRefundIntentFromReadback({
        clinicId: CLINIC,
        intentId: INTENT,
        refunds: [{ refundId: 'ref_1', status: 'CANCELLED', value: 150 }],
      }),
    ).resolves.toBe('failed');

    expect(intent).toMatchObject({ status: 'failed', failureCode: 'refund_cancelled' });
    expect(mocks.closeChargeInTransaction).not.toHaveBeenCalled();
    expect(mocks.publishEvent).not.toHaveBeenCalled();
  });

  it('intent legado sem contadores confirma DONE pelo id exato', async () => {
    intent = pendingIntent({
      purpose: 'deposit_closeout',
      amount: '150.00',
      baselineRefundCount: null,
      baselineRejectedRefundCount: null,
    });
    chargeKind = 'deposit';
    chargeAmount = '150.00';

    await expect(
      confirmRefundIntentFromReadback({
        clinicId: CLINIC,
        intentId: INTENT,
        refunds: [{ refundId: 'ref_1', status: 'DONE', value: 150 }],
      }),
    ).resolves.toBe('confirmed');

    expect(intent).toMatchObject({ status: 'confirmed' });
    expect(mocks.closeChargeInTransaction).toHaveBeenCalledOnce();
  });

  it('intent legado sem contadores encerra CANCELLED pelo id exato', async () => {
    intent = pendingIntent({
      purpose: 'deposit_closeout',
      amount: '150.00',
      baselineRefundCount: null,
      baselineRejectedRefundCount: null,
    });
    chargeKind = 'deposit';
    chargeAmount = '150.00';

    await expect(
      confirmRefundIntentFromReadback({
        clinicId: CLINIC,
        intentId: INTENT,
        refunds: [{ refundId: 'ref_1', status: 'CANCELLED', value: 150 }],
      }),
    ).resolves.toBe('failed');

    expect(intent).toMatchObject({ status: 'failed', failureCode: 'refund_cancelled' });
    expect(mocks.closeChargeInTransaction).not.toHaveBeenCalled();
  });

  it('intent legado sem id nem contadores mantém CANCELLED ambíguo pendente', async () => {
    intent = pendingIntent({
      purpose: 'deposit_closeout',
      amount: '150.00',
      providerRefundId: null,
      baselineRefundCount: null,
      baselineRejectedRefundCount: null,
    });
    chargeKind = 'deposit';
    chargeAmount = '150.00';

    await expect(
      confirmRefundIntentFromReadback({
        clinicId: CLINIC,
        intentId: INTENT,
        refunds: [{ refundId: null, status: 'CANCELLED', value: 150 }],
      }),
    ).resolves.toBe('pending');

    expect(intent).toMatchObject({ status: 'confirmation_pending' });
    expect(mocks.closeChargeInTransaction).not.toHaveBeenCalled();
  });

  it('refund sem id usa os contadores do baseline para reconhecer novo CANCELLED', async () => {
    intent = pendingIntent({
      purpose: 'deposit_closeout',
      amount: '150.00',
      providerRefundId: null,
      baselineRefundCount: 1,
      baselineRejectedRefundCount: 1,
    });
    chargeKind = 'deposit';
    chargeAmount = '150.00';

    await expect(
      confirmRefundIntentFromReadback({
        clinicId: CLINIC,
        intentId: INTENT,
        refunds: [
          { refundId: null, status: 'CANCELLED', value: 20 },
          { refundId: null, status: 'CANCELLED', value: 150 },
        ],
      }),
    ).resolves.toBe('failed');

    expect(intent).toMatchObject({ status: 'failed', failureCode: 'refund_cancelled' });
    expect(mocks.closeChargeInTransaction).not.toHaveBeenCalled();
  });

  it('DONE fecha cobrança e libera crédito atomicamente pelo charge-store', async () => {
    intent = pendingIntent({ purpose: 'deposit_closeout', amount: '150.00' });
    chargeKind = 'deposit';
    chargeAmount = '150.00';

    await expect(
      confirmRefundIntentFromReadback({
        clinicId: CLINIC,
        intentId: INTENT,
        refunds: [{ refundId: 'ref_1', status: 'DONE', value: 150 }],
        confirmedAt: new Date('2026-09-05T12:00:00.000Z'),
      }),
    ).resolves.toBe('confirmed');

    expect(intent).toMatchObject({ status: 'confirmed' });
    expect(mocks.closeChargeInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        clinicId: CLINIC,
        chargeId: CHARGE,
        from: 'paid',
        outcome: 'refunded',
        amount: 150,
      }),
    );
    expect(mocks.publishEvent).not.toHaveBeenCalled();
  });

  it('payment REFUNDED confirma mesmo se o array ainda estiver defasado', async () => {
    intent = pendingIntent({ purpose: 'deposit_closeout', amount: '150.00' });
    chargeKind = 'deposit';
    chargeAmount = '150.00';

    await expect(
      confirmRefundIntentFromReadback({
        clinicId: CLINIC,
        intentId: INTENT,
        refunds: [{ refundId: 'ref_1', status: 'PENDING', value: 150 }],
        providerPaymentStatus: 'REFUNDED',
      }),
    ).resolves.toBe('confirmed');

    expect(mocks.closeChargeInTransaction).toHaveBeenCalledOnce();
  });

  it('dois workers concorrentes produzem no máximo um POST', async () => {
    chargeKind = 'deposit';
    chargeAmount = '150.00';
    mocks.client.listPaymentRefunds.mockResolvedValue([]);
    mocks.client.refundPayment.mockResolvedValue({
      refundId: null,
      status: 'PENDING',
      value: 150,
    });

    const results = await Promise.all([
      requestDepositRefund({
        clinicId: CLINIC,
        chargeId: CHARGE,
        amount: 150,
        sourceEventId: EVENT,
        client: mocks.client,
      }),
      requestDepositRefund({
        clinicId: CLINIC,
        chargeId: CHARGE,
        amount: 150,
        sourceEventId: EVENT,
        client: mocks.client,
      }),
    ]);

    expect(results).toContain('already_started');
    expect(mocks.client.refundPayment).toHaveBeenCalledTimes(1);
  });

  it('replay após CANCELLED não dispara segundo POST', async () => {
    chargeKind = 'deposit';
    chargeAmount = '150.00';
    mocks.client.listPaymentRefunds
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ refundId: null, status: 'CANCELLED', value: 150 }]);
    mocks.client.refundPayment.mockResolvedValue({
      refundId: null,
      status: 'PENDING',
      value: 150,
    });

    await expect(
      requestDepositRefund({
        clinicId: CLINIC,
        chargeId: CHARGE,
        amount: 150,
        sourceEventId: EVENT,
        client: mocks.client,
      }),
    ).resolves.toBe('failed');
    await expect(
      requestDepositRefund({
        clinicId: CLINIC,
        chargeId: CHARGE,
        amount: 150,
        sourceEventId: EVENT,
        client: mocks.client,
      }),
    ).resolves.toBe('failed');

    expect(mocks.client.refundPayment).toHaveBeenCalledTimes(1);
    expect(mocks.closeChargeInTransaction).not.toHaveBeenCalled();
  });
});
