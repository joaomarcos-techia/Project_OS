import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createAsaasClient } from './index';

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Asaas Checkout recorrente', () => {
  it('envia RECURRENT de cartão e monta o link quando a API devolve só o id', async () => {
    fetchMock.mockResolvedValue(Response.json({ id: 'checkout_recorrente' }));
    const client = createAsaasClient({
      apiKey: 'k',
      baseUrl: 'https://sandbox.asaas.com/api/v3',
    });

    await expect(
      client.createCheckout({
        kind: 'recurrent',
        value: 149,
        itemName: 'Qoro · solo',
        description: 'Qoro plano Essencial para uma clínica com nome comprido',
        externalReference: 'signup:session-1',
        minutesToExpire: 60,
        callback: {
          successUrl: 'https://app.qoro.dev/cadastro/pagamento?resultado=success',
          cancelUrl: 'https://app.qoro.dev/cadastro/pagamento?resultado=cancelled',
          expiredUrl: 'https://app.qoro.dev/cadastro/pagamento?resultado=expired',
        },
        subscription: { cycle: 'MONTHLY', nextDueDate: '2026-10-03' },
      }),
    ).resolves.toEqual({
      checkoutId: 'checkout_recorrente',
      status: 'UNKNOWN',
      link: 'https://sandbox.asaas.com/checkoutSession/show?id=checkout_recorrente',
      externalReference: null,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://sandbox.asaas.com/api/v3/checkouts',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          billingTypes: ['CREDIT_CARD'],
          chargeTypes: ['RECURRENT'],
          minutesToExpire: 60,
          externalReference: 'signup:session-1',
          callback: {
            successUrl: 'https://app.qoro.dev/cadastro/pagamento?resultado=success',
            cancelUrl: 'https://app.qoro.dev/cadastro/pagamento?resultado=cancelled',
            expiredUrl: 'https://app.qoro.dev/cadastro/pagamento?resultado=expired',
          },
          items: [
            {
              name: 'Qoro · solo',
              description: 'Qoro plano Essencial para uma clínica com nome comprido',
              quantity: 1,
              value: 149,
            },
          ],
          subscription: { cycle: 'MONTHLY', nextDueDate: '2026-10-03' },
        }),
      }),
    );
  });

  it('relê o customer criado pelo Checkout', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ id: 'cus_1', cpfCnpj: '24971563792' }));
    const client = createAsaasClient({
      apiKey: 'k',
      baseUrl: 'https://sandbox.asaas.com/api/v3',
    });

    await expect(client.getCustomer('cus_1', { attempts: 1 })).resolves.toEqual({
      customerId: 'cus_1',
      cpfCnpj: '24971563792',
    });
  });
});
