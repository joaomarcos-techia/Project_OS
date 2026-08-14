import { beforeEach, describe, expect, it, vi } from 'vitest';

const { transactionMock, createUserMock, provider, BillingProviderErrorMock } = vi.hoisted(() => {
  class BillingProviderErrorMock extends Error {}
  return {
    transactionMock: vi.fn(),
    createUserMock: vi.fn(),
    provider: {
      findSubscriptionByExternalReference: vi.fn(),
      createCustomer: vi.fn(),
      createSubscriptionWithCard: vi.fn(),
      deleteCustomer: vi.fn(),
      cancelSubscription: vi.fn(),
    },
    BillingProviderErrorMock,
  };
});

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', () => ({ dbAdmin: { transaction: transactionMock } }));
vi.mock('@/lib/auth/supabase-admin', () => ({
  createAdminClient: () => ({ auth: { admin: { createUser: createUserMock } } }),
}));
vi.mock('@/contexts/billing/internal/providers/asaas', () => ({
  asaasProvider: provider,
  BillingProviderError: BillingProviderErrorMock,
  BillingProviderUnreachableError: class BillingProviderUnreachableError extends Error {},
  BillingCircuitOpenError: class BillingCircuitOpenError extends Error {},
}));

import { runCheckout } from './saga';

const args = {
  invite: { id: '00000000-0000-0000-0000-000000000001', version: 3 },
  clinic: { nome: 'Clínica Teste', slug: 'clinica-teste' },
  owner: { nome: 'Gestora Teste', email: 'gestora@example.test' },
  password: 'Senha!123',
  card: {
    number: '4111111111111111',
    holderName: 'GESTORA TESTE',
    expiryMonth: '12',
    expiryYear: '2030',
    ccv: '123',
  },
  billingContact: {
    name: 'Titular da Cobrança',
    email: 'titular@example.test',
    phone: '11990000000',
    cpfCnpj: '12345678901',
    postalCode: '01001000',
    addressNumber: '10',
  },
  plan: {
    planId: '00000000-0000-0000-0000-000000000002',
    code: 'pro',
    priceId: '00000000-0000-0000-0000-000000000003',
    amountReais: 149,
    cycle: 'monthly',
  },
  trialDays: 14,
  remoteIp: '127.0.0.1',
} as const;

describe('runCheckout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    transactionMock.mockResolvedValue({ clinicId: '00000000-0000-0000-0000-000000000004' });
    createUserMock.mockResolvedValue({ data: { user: { id: 'owner_1' } }, error: null });
  });

  it('retoma uma assinatura confirmada antes de um timeout sem reenviar o cartão', async () => {
    provider.findSubscriptionByExternalReference.mockResolvedValue({
      subscriptionId: 'sub_existing',
      customerId: 'cus_existing',
      status: 'ACTIVE',
      value: 149,
      externalReference: 'onboarding:00000000-0000-0000-0000-000000000001',
    });

    await expect(runCheckout(args)).resolves.toEqual({
      clinicId: '00000000-0000-0000-0000-000000000004',
    });

    expect(provider.findSubscriptionByExternalReference).toHaveBeenCalledWith(
      'onboarding:00000000-0000-0000-0000-000000000001',
    );
    expect(provider.createCustomer).not.toHaveBeenCalled();
    expect(provider.createSubscriptionWithCard).not.toHaveBeenCalled();
  });

  it('falha de forma segura quando a assinatura encontrada não traz cliente', async () => {
    provider.findSubscriptionByExternalReference.mockResolvedValue({
      subscriptionId: 'sub_without_customer',
      customerId: null,
      status: 'ACTIVE',
      value: 149,
      externalReference: 'onboarding:00000000-0000-0000-0000-000000000001',
    });

    await expect(runCheckout(args)).rejects.toMatchObject({ code: 'provider_unreachable' });

    expect(provider.createCustomer).not.toHaveBeenCalled();
    expect(provider.createSubscriptionWithCard).not.toHaveBeenCalled();
  });

  it('marca a nova assinatura com referência estável para reconciliação', async () => {
    provider.findSubscriptionByExternalReference.mockResolvedValue(null);
    provider.createCustomer.mockResolvedValue({ customerId: 'cus_new' });
    provider.createSubscriptionWithCard.mockResolvedValue({
      subscriptionId: 'sub_new',
      creditCardToken: null,
    });

    await runCheckout(args);

    expect(provider.createSubscriptionWithCard).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: 'cus_new',
        externalReference: 'onboarding:00000000-0000-0000-0000-000000000001',
      }),
    );
  });

  it('usa somente o titular informado para o cliente e o holder do Asaas', async () => {
    provider.findSubscriptionByExternalReference.mockResolvedValue(null);
    provider.createCustomer.mockResolvedValue({ customerId: 'cus_billing_holder' });
    provider.createSubscriptionWithCard.mockResolvedValue({
      subscriptionId: 'sub_billing_holder',
      creditCardToken: null,
    });

    await runCheckout(args);

    expect(provider.createCustomer).toHaveBeenCalledWith({
      name: 'Titular da Cobrança',
      email: 'titular@example.test',
      cpfCnpj: '12345678901',
      phone: '11990000000',
    });
    expect(provider.createSubscriptionWithCard).toHaveBeenCalledWith(
      expect.objectContaining({
        holderInfo: {
          name: 'Titular da Cobrança',
          email: 'titular@example.test',
          cpfCnpj: '12345678901',
          postalCode: '01001000',
          addressNumber: '10',
          phone: '11990000000',
        },
      }),
    );
  });

  it('compensa somente o cliente criado nesta tentativa quando a assinatura recebe 4xx', async () => {
    provider.findSubscriptionByExternalReference.mockResolvedValue(null);
    provider.createCustomer.mockResolvedValue({ customerId: 'cus_to_compensate' });
    provider.createSubscriptionWithCard.mockRejectedValue(
      new BillingProviderErrorMock('invalid card'),
    );
    provider.deleteCustomer.mockResolvedValue(undefined);

    await expect(runCheckout(args)).rejects.toMatchObject({ code: 'card_declined' });

    expect(provider.deleteCustomer).toHaveBeenCalledWith('cus_to_compensate');
    expect(provider.cancelSubscription).not.toHaveBeenCalled();
  });

  it('preserva a recusa segura se a compensacao do cliente falhar', async () => {
    provider.findSubscriptionByExternalReference.mockResolvedValue(null);
    provider.createCustomer.mockResolvedValue({ customerId: 'cus_cleanup_failure' });
    provider.createSubscriptionWithCard.mockRejectedValue(
      new BillingProviderErrorMock('invalid card'),
    );
    provider.deleteCustomer.mockRejectedValue(new Error('network unavailable'));

    await expect(runCheckout(args)).rejects.toMatchObject({ code: 'card_declined' });
    expect(provider.deleteCustomer).toHaveBeenCalledWith('cus_cleanup_failure');
  });
});
