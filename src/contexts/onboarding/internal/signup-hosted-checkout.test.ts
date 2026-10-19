import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  BillingProviderError,
  BillingProviderUnreachableError,
  type PaymentProvider,
  type ProviderSubscription,
} from '@/lib/payments/asaas';

const mocks = vi.hoisted(() => ({
  env: {
    APP_BASE_URL: 'https://app.qoro.test',
    NODE_ENV: 'test',
  },
  reserve: vi.fn(),
  record: vi.fn(),
  activate: vi.fn(),
  reset: vi.fn(),
  mark: vi.fn(),
  target: vi.fn(),
  provision: vi.fn(),
}));

vi.mock('@/lib/env', () => ({ env: mocks.env }));
vi.mock('./signup-billing', () => ({
  reserveSignupBillingAttempt: mocks.reserve,
  recordSignupHostedCheckout: mocks.record,
  activateSignupHostedCheckout: mocks.activate,
  resetSignupHostedCheckout: mocks.reset,
  markSignupBillingIssue: mocks.mark,
  readSignupHostedCheckoutTarget: mocks.target,
  centsToReais: (cents: number) => Number((cents / 100).toFixed(2)),
}));
vi.mock('./signup-provision', () => ({ provisionTenantFromSignup: mocks.provision }));

import {
  abandonSignupHostedCheckout,
  completeSignupHostedCheckout,
  startSignupHostedCheckout,
} from './signup-hosted-checkout';

const USER = '11111111-1111-4111-8111-111111111111';
const EMAIL = 'dona@example.invalid';
const CPF = '24971563792';
const CHECKOUT_URL = 'https://sandbox.asaas.com/checkoutSession/show?id=checkout_1';
const INTENT = {
  externalReference: 'signup:aaaaaaaa-0000-4000-8000-000000000001',
  planId: 'bbbbbbbb-0000-4000-8000-000000000002',
  planCode: 'essencial',
  priceId: 'cccccccc-0000-4000-8000-000000000003',
  priceCents: 34_900,
  clinicName: 'Clínica Aurora',
  ownerName: 'Ana Prado',
  trialDays: 7,
  nextDueDate: '2026-10-03',
};
const TARGET = {
  state: 'checkout_pending' as const,
  rowVersion: 8,
  externalReference: INTENT.externalReference,
  priceCents: INTENT.priceCents,
  trialDays: 7,
  attemptedOn: '2026-09-26',
  nextDueDate: INTENT.nextDueDate,
  asaasCustomerId: null,
  asaasCheckoutId: 'checkout_1',
  asaasSubscriptionId: null,
};
const PAYMENT = {
  paymentId: 'pay_1',
  status: 'PENDING',
  value: 349,
  dueDate: INTENT.nextDueDate,
  invoiceUrl: null,
  subscriptionId: 'sub_1',
  billingType: 'CREDIT_CARD',
  externalReference: null,
  checkoutSessionId: 'checkout_1',
  deleted: false,
};
const SUBSCRIPTION: ProviderSubscription = {
  subscriptionId: 'sub_1',
  status: 'ACTIVE',
  value: 349,
  customerId: 'cus_1',
  externalReference: INTENT.externalReference,
  cycle: 'MONTHLY',
  nextDueDate: INTENT.nextDueDate,
  billingType: 'CREDIT_CARD',
};

function fakeProvider(overrides: Partial<PaymentProvider> = {}): PaymentProvider {
  const unexpected = (name: string) => () => {
    throw new Error(`[test] chamada inesperada: ${name}`);
  };
  return new Proxy(
    {
      createCheckout: vi.fn().mockResolvedValue({
        checkoutId: 'checkout_1',
        status: 'ACTIVE',
        link: CHECKOUT_URL,
        externalReference: INTENT.externalReference,
      }),
      cancelCheckout: vi.fn().mockResolvedValue(undefined),
      findPaymentByCheckoutSession: vi.fn().mockResolvedValue(PAYMENT),
      getSubscription: vi.fn().mockResolvedValue(SUBSCRIPTION),
      getCustomer: vi.fn().mockResolvedValue({ customerId: 'cus_1', cpfCnpj: CPF }),
      ...overrides,
    } as unknown as PaymentProvider,
    {
      get(target, prop: string) {
        return Reflect.get(target, prop) ?? unexpected(prop);
      },
    },
  );
}

beforeEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  mocks.reserve.mockResolvedValue({ ok: true, rowVersion: 7, intent: INTENT });
  mocks.record.mockResolvedValue({ ok: true, rowVersion: 8 });
  mocks.activate.mockResolvedValue({ ok: true, rowVersion: 9 });
  mocks.reset.mockResolvedValue({ ok: true, rowVersion: 9 });
  mocks.mark.mockResolvedValue({ ok: true, rowVersion: 8 });
  mocks.target.mockResolvedValue(TARGET);
  mocks.provision.mockResolvedValue({ ok: true, clinicId: 'clinic_1' });
});

describe('Checkout hospedado do cadastro', () => {
  it('reserva, cria uma recorrência hospedada e persiste antes de devolver a URL', async () => {
    const client = fakeProvider();

    await expect(startSignupHostedCheckout({ userId: USER, client })).resolves.toEqual({
      ok: true,
      state: 'checkout_pending',
      checkoutUrl: CHECKOUT_URL,
    });

    expect(client.createCheckout).toHaveBeenCalledWith({
      kind: 'recurrent',
      value: 349,
      itemName: 'Qoro · essencial',
      description: expect.stringContaining('essencial'),
      externalReference: INTENT.externalReference,
      minutesToExpire: 60,
      callback: {
        successUrl: 'https://app.qoro.test/cadastro/pagamento?resultado=success',
        cancelUrl: 'https://app.qoro.test/cadastro/pagamento?resultado=cancelled',
        expiredUrl: 'https://app.qoro.test/cadastro/pagamento?resultado=expired',
      },
      subscription: { cycle: 'MONTHLY', nextDueDate: INTENT.nextDueDate },
    });
    expect(mocks.record).toHaveBeenCalledWith({
      userId: USER,
      reservedVersion: 7,
      asaasCheckoutId: 'checkout_1',
      checkoutUrl: CHECKOUT_URL,
    });
    expect(mocks.reserve.mock.invocationCallOrder[0]).toBeLessThan(
      (client.createCheckout as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]!,
    );
  });

  it('usa a origem Preview validada nos tres retornos do Checkout', async () => {
    const client = fakeProvider();
    const publicOrigin = 'https://project-os-git-branch-owner.vercel.app';

    await expect(
      startSignupHostedCheckout({ userId: USER, publicOrigin, client }),
    ).resolves.toMatchObject({ ok: true, state: 'checkout_pending' });

    expect(client.createCheckout).toHaveBeenCalledWith(
      expect.objectContaining({
        callback: {
          successUrl: `${publicOrigin}/cadastro/pagamento?resultado=success`,
          cancelUrl: `${publicOrigin}/cadastro/pagamento?resultado=cancelled`,
          expiredUrl: `${publicOrigin}/cadastro/pagamento?resultado=expired`,
        },
      }),
    );
  });

  it('reabre a mesma URL persistida sem criar outro Checkout', async () => {
    mocks.reserve.mockResolvedValue({
      ok: false,
      reason: 'checkout_pending',
      checkoutUrl: CHECKOUT_URL,
    });
    const client = fakeProvider();

    await expect(startSignupHostedCheckout({ userId: USER, client })).resolves.toEqual({
      ok: true,
      state: 'checkout_pending',
      checkoutUrl: CHECKOUT_URL,
    });
    expect(client.createCheckout).not.toHaveBeenCalled();
  });

  it('timeout do POST congela a tentativa e não faz retry cego', async () => {
    const client = fakeProvider({
      createCheckout: vi
        .fn()
        .mockRejectedValue(new BillingProviderUnreachableError('timeout sintético')),
    });

    await expect(startSignupHostedCheckout({ userId: USER, client })).resolves.toEqual({
      ok: false,
      reason: 'provider_unreachable',
    });
    expect(mocks.mark).toHaveBeenCalledWith({
      userId: USER,
      reservedVersion: 7,
      outcome: 'creation_unknown',
      failureCode: 'checkout_creation_unknown',
    });
  });

  it('retorno sem assinatura confirmada permanece pendente e não provisiona', async () => {
    const client = fakeProvider({ findPaymentByCheckoutSession: vi.fn().mockResolvedValue(null) });

    await expect(
      completeSignupHostedCheckout({ userId: USER, verifiedEmail: EMAIL, client }),
    ).resolves.toEqual({ ok: true, state: 'pending' });
    expect(mocks.activate).not.toHaveBeenCalled();
    expect(mocks.provision).not.toHaveBeenCalled();
  });

  it('cancela no provider antes de liberar uma nova tentativa', async () => {
    const client = fakeProvider({ findPaymentByCheckoutSession: vi.fn().mockResolvedValue(null) });

    await expect(
      abandonSignupHostedCheckout({ userId: USER, reason: 'cancelled', client }),
    ).resolves.toEqual({ ok: true, state: 'reset' });
    expect(client.cancelCheckout).toHaveBeenCalledWith('checkout_1');
    expect(mocks.reset).toHaveBeenCalledWith({
      userId: USER,
      expectedVersion: 8,
      asaasCheckoutId: 'checkout_1',
      reason: 'cancelled',
    });
    expect(
      (client.cancelCheckout as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0],
    ).toBeLessThan(mocks.reset.mock.invocationCallOrder[0]!);
  });

  it('não cancela nem limpa se a assinatura já apareceu', async () => {
    const client = fakeProvider();

    await expect(
      abandonSignupHostedCheckout({ userId: USER, reason: 'expired', client }),
    ).resolves.toEqual({ ok: true, state: 'already_completed' });
    expect(client.cancelCheckout).not.toHaveBeenCalled();
    expect(mocks.reset).not.toHaveBeenCalled();
  });

  it('relê o provider após cancelamento já fechado antes de limpar', async () => {
    const findPayment = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    const client = fakeProvider({
      findPaymentByCheckoutSession: findPayment,
      cancelCheckout: vi
        .fn()
        .mockRejectedValue(new BillingProviderError('já fechado', 'provider_error', 400)),
    });

    await expect(
      abandonSignupHostedCheckout({ userId: USER, reason: 'expired', client }),
    ).resolves.toEqual({ ok: true, state: 'reset' });
    expect(findPayment).toHaveBeenCalledTimes(2);
    expect(mocks.reset).toHaveBeenCalledTimes(1);
  });

  it('não limpa o banco quando o cancelamento fica indeterminado', async () => {
    const client = fakeProvider({
      findPaymentByCheckoutSession: vi.fn().mockResolvedValue(null),
      cancelCheckout: vi
        .fn()
        .mockRejectedValue(new BillingProviderUnreachableError('timeout sintético')),
    });

    await expect(
      abandonSignupHostedCheckout({ userId: USER, reason: 'cancelled', client }),
    ).resolves.toEqual({ ok: false, reason: 'provider_unreachable' });
    expect(mocks.reset).not.toHaveBeenCalled();
  });

  it('confere a assinatura e o customer antes de provisionar', async () => {
    const client = fakeProvider();

    await expect(
      completeSignupHostedCheckout({ userId: USER, verifiedEmail: EMAIL, client }),
    ).resolves.toEqual({ ok: true, state: 'provisioned' });
    expect(mocks.activate).toHaveBeenCalledWith({
      userId: USER,
      expectedVersion: 8,
      asaasCheckoutId: 'checkout_1',
      asaasCustomerId: 'cus_1',
      asaasSubscriptionId: 'sub_1',
    });
    expect(client.getCustomer).toHaveBeenCalledWith('cus_1', { attempts: 1 });
    expect(client.findPaymentByCheckoutSession).toHaveBeenCalledWith('checkout_1', {
      attempts: 1,
      createdSince: '2026-09-26',
    });
    expect(mocks.provision).toHaveBeenCalledWith({
      userId: USER,
      verifiedEmail: EMAIL,
      cpfCnpj: CPF,
    });
  });

  it('recusa valor divergente sem ativar nem provisionar', async () => {
    const client = fakeProvider({
      findPaymentByCheckoutSession: vi.fn().mockResolvedValue({ ...PAYMENT, value: 1 }),
    });

    await expect(
      completeSignupHostedCheckout({ userId: USER, verifiedEmail: EMAIL, client }),
    ).resolves.toEqual({ ok: false, reason: 'conflict' });
    expect(mocks.activate).not.toHaveBeenCalled();
    expect(mocks.provision).not.toHaveBeenCalled();
  });

  it('recusa vencimento que encurta o trial sem ativar nem provisionar', async () => {
    const client = fakeProvider({
      findPaymentByCheckoutSession: vi
        .fn()
        .mockResolvedValue({ ...PAYMENT, dueDate: '2026-09-27' }),
    });

    await expect(
      completeSignupHostedCheckout({ userId: USER, verifiedEmail: EMAIL, client }),
    ).resolves.toEqual({ ok: false, reason: 'conflict' });
    expect(mocks.activate).not.toHaveBeenCalled();
    expect(mocks.provision).not.toHaveBeenCalled();
  });

  it('aceita a assinatura avançada para o ciclo seguinte após gerar a primeira cobrança', async () => {
    const client = fakeProvider({
      getSubscription: vi.fn().mockResolvedValue({
        ...SUBSCRIPTION,
        nextDueDate: '2026-11-03',
      }),
    });

    await expect(
      completeSignupHostedCheckout({ userId: USER, verifiedEmail: EMAIL, client }),
    ).resolves.toEqual({ ok: true, state: 'provisioned' });
    expect(mocks.activate).toHaveBeenCalledTimes(1);
    expect(mocks.provision).toHaveBeenCalledTimes(1);
  });

  it('não provisiona após o trial com cobrança ainda pendente', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-19T12:00:00.000Z'));
    mocks.target.mockResolvedValue({
      ...TARGET,
      strictTrialDeadline: true,
      trialEndsAt: '2026-10-18T12:00:00.000Z',
      nextDueDate: '2026-10-19',
    });
    const client = fakeProvider({
      findPaymentByCheckoutSession: vi.fn().mockResolvedValue({
        ...PAYMENT,
        dueDate: '2026-10-19',
        status: 'PENDING',
      }),
      getSubscription: vi.fn().mockResolvedValue({
        ...SUBSCRIPTION,
        nextDueDate: '2026-11-19',
      }),
    });

    await expect(
      completeSignupHostedCheckout({ userId: USER, verifiedEmail: EMAIL, client }),
    ).resolves.toEqual({ ok: true, state: 'pending' });
    expect(mocks.activate).not.toHaveBeenCalled();
    expect(mocks.provision).not.toHaveBeenCalled();
  });

  it('provisiona após o trial apenas com pagamento confirmado e próximo período vigente', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-19T12:00:00.000Z'));
    mocks.target.mockResolvedValue({
      ...TARGET,
      strictTrialDeadline: true,
      trialEndsAt: '2026-10-18T12:00:00.000Z',
      nextDueDate: '2026-10-19',
    });
    const client = fakeProvider({
      findPaymentByCheckoutSession: vi.fn().mockResolvedValue({
        ...PAYMENT,
        dueDate: '2026-10-19',
        status: 'CONFIRMED',
      }),
      getSubscription: vi.fn().mockResolvedValue({
        ...SUBSCRIPTION,
        nextDueDate: '2026-11-19',
      }),
    });

    await expect(
      completeSignupHostedCheckout({ userId: USER, verifiedEmail: EMAIL, client }),
    ).resolves.toEqual({ ok: true, state: 'provisioned' });
    expect(mocks.provision).toHaveBeenCalledWith({
      userId: USER,
      verifiedEmail: EMAIL,
      cpfCnpj: CPF,
      paidCheckout: {
        payment: { ...PAYMENT, dueDate: '2026-10-19', status: 'CONFIRMED' },
        through: new Date('2026-11-19T00:00:00.000Z'),
      },
    });
  });

  it('aguarda a atualização do próximo ciclo mesmo depois de o pagamento ser confirmado', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-19T12:00:00.000Z'));
    mocks.target.mockResolvedValue({
      ...TARGET,
      strictTrialDeadline: true,
      trialEndsAt: '2026-10-18T12:00:00.000Z',
      nextDueDate: '2026-10-19',
    });
    const client = fakeProvider({
      findPaymentByCheckoutSession: vi.fn().mockResolvedValue({
        ...PAYMENT,
        dueDate: '2026-10-19',
        status: 'CONFIRMED',
      }),
      getSubscription: vi.fn().mockResolvedValue({
        ...SUBSCRIPTION,
        nextDueDate: '2026-10-19',
      }),
    });

    await expect(
      completeSignupHostedCheckout({ userId: USER, verifiedEmail: EMAIL, client }),
    ).resolves.toEqual({ ok: true, state: 'pending' });
    expect(mocks.provision).not.toHaveBeenCalled();
  });

  it('não aceita pagamento de outro checkout para liberar trial vencido', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-19T12:00:00.000Z'));
    mocks.target.mockResolvedValue({
      ...TARGET,
      strictTrialDeadline: true,
      trialEndsAt: '2026-10-18T12:00:00.000Z',
      nextDueDate: '2026-10-19',
    });
    const client = fakeProvider({
      findPaymentByCheckoutSession: vi.fn().mockResolvedValue({
        ...PAYMENT,
        dueDate: '2026-10-19',
        checkoutSessionId: 'checkout_outra_conta',
        status: 'CONFIRMED',
      }),
      getSubscription: vi.fn().mockResolvedValue({
        ...SUBSCRIPTION,
        nextDueDate: '2026-11-19',
      }),
    });

    await expect(
      completeSignupHostedCheckout({ userId: USER, verifiedEmail: EMAIL, client }),
    ).resolves.toEqual({ ok: false, reason: 'conflict' });
    expect(mocks.provision).not.toHaveBeenCalled();
  });

  it('recusa uma data da assinatura fora da primeira cobrança e do ciclo seguinte', async () => {
    const client = fakeProvider({
      getSubscription: vi.fn().mockResolvedValue({
        ...SUBSCRIPTION,
        nextDueDate: '2026-12-03',
      }),
    });

    await expect(
      completeSignupHostedCheckout({ userId: USER, verifiedEmail: EMAIL, client }),
    ).resolves.toEqual({ ok: false, reason: 'conflict' });
    expect(mocks.activate).not.toHaveBeenCalled();
    expect(mocks.provision).not.toHaveBeenCalled();
  });
});
