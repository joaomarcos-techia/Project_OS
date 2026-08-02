import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));

vi.mock('@/lib/env', () => ({
  assertBillingRuntimeReady: vi.fn(),
  env: {
    ASAAS_BASE_URL: 'https://sandbox.asaas.com/api/v3',
    ASAAS_API_KEY: 'test-key',
    ASAAS_HTTP_TIMEOUT_MS: 1_000,
    ASAAS_WEBHOOK_TOKEN: 'webhook-token',
  },
}));
vi.mock('@/lib/observability/metrics', () => ({ metrics: { emit: vi.fn() } }));

import { __testing__, asaasProvider } from './asaas';

beforeEach(() => {
  __testing__.resetCircuit();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('listSubscriptionPayments', () => {
  it('lê cobranças da assinatura e preserva o vínculo do endpoint', async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        data: [
          {
            id: 'pay_1',
            status: 'CONFIRMED',
            value: 149,
            dueDate: '2026-08-02',
            invoiceUrl: 'https://asaas.test/invoice',
            billingType: 'CREDIT_CARD',
          },
        ],
      }),
    );

    await expect(asaasProvider.listSubscriptionPayments('sub_1', { attempts: 1 })).resolves.toEqual(
      [
        {
          paymentId: 'pay_1',
          status: 'CONFIRMED',
          value: 149,
          dueDate: '2026-08-02',
          invoiceUrl: 'https://asaas.test/invoice',
          subscriptionId: 'sub_1',
          billingType: 'CREDIT_CARD',
        },
      ],
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'https://sandbox.asaas.com/api/v3/subscriptions/sub_1/payments',
      expect.objectContaining({ method: 'GET' }),
    );
  });
});
