import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as SignupTrialModule from './signup-trial';

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  authCreatedAt: vi.fn(),
  provision: vi.fn(),
  ensureInvoice: vi.fn(),
  markInvoicePaid: vi.fn(),
  results: [] as unknown[][],
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', () => ({ dbAdmin: { transaction: mocks.transaction } }));
vi.mock('@/lib/env', () => ({
  env: { SIGNUP_AUTH_ENABLED: true, SIGNUP_IDENTITY_ENABLED: true },
}));
vi.mock('@/lib/auth/supabase-server', () => ({ createServerClient: vi.fn() }));
vi.mock('@/lib/observability/metrics', () => ({ metrics: { emit: vi.fn() } }));
vi.mock('@/contexts/billing/internal/subscriptions', () => ({
  ensureInvoiceForPayment: mocks.ensureInvoice,
  markInvoicePaid: mocks.markInvoicePaid,
}));
vi.mock('./saga', () => ({
  OnboardingProvisionError: class OnboardingProvisionError extends Error {},
  provisionTenantCoreTx: mocks.provision,
}));
vi.mock('./signup-trial', async (importOriginal) => ({
  ...(await importOriginal<typeof SignupTrialModule>()),
  readSignupAuthCreatedAt: mocks.authCreatedAt,
}));

import { provisionTenantFromSignup } from './signup-provision';

const USER = '11111111-1111-4111-8111-111111111111';
const CREATED_AT = new Date('2026-10-01T12:00:00.000Z');
const ATTEMPTED_AT = new Date('2026-10-02T12:00:00.000Z');

function setup(planCode: string, cycle: 'monthly' | 'annual' = 'monthly'): void {
  mocks.results = [
    [
      {
        id: '22222222-2222-4222-8222-222222222222',
        ownerName: 'Dona Teste',
        clinicName: 'Clínica Teste',
        selectedPlanId: '33333333-3333-4333-8333-333333333333',
        selectedBillingCycle: cycle,
        billingState: 'active',
        billingAttemptedAt: ATTEMPTED_AT,
        asaasCustomerId: 'cus_test',
        asaasCheckoutId: 'checkout_test',
        asaasSubscriptionId: 'sub_test',
      },
    ],
    [
      {
        planId: '33333333-3333-4333-8333-333333333333',
        planCode,
        priceId: '44444444-4444-4444-8444-444444444444',
        amount: cycle === 'annual' ? '1970.00' : '197.00',
      },
    ],
    [],
    [],
  ];
  const chain = {
    from: () => chain,
    innerJoin: () => chain,
    where: () => chain,
    for: () => chain,
    limit: async () => mocks.results.shift() ?? [],
  };
  mocks.transaction.mockImplementation(
    async (run: (tx: { select: () => typeof chain }) => unknown) => run({ select: () => chain }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  mocks.authCreatedAt.mockResolvedValue(CREATED_AT);
  mocks.provision.mockResolvedValue({ clinicId: '55555555-5555-4555-8555-555555555555' });
  mocks.ensureInvoice.mockResolvedValue({ id: 'invoice_test' });
});

describe('provisionamento do trial da nova oferta', () => {
  it('provisiona ciclo anual com o preço anual sem alterar contratos mensais', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-03T12:00:00.000Z'));
    setup('consultorio_2026', 'annual');
    await expect(
      provisionTenantFromSignup({
        userId: USER,
        verifiedEmail: 'dona@example.invalid',
        cpfCnpj: '24971563792',
        expectedPriceCents: 197_000,
      }),
    ).resolves.toMatchObject({ ok: true });
    expect(mocks.provision).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        billingCycle: 'annual',
        priceAmount: 1970,
        initialBillingStatus: 'trial',
      }),
      expect.any(Function),
    );
  });

  it('grava o fim absoluto do Auth sem reiniciar os 14 dias no provisionamento', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-03T12:00:00.000Z'));
    setup('consultorio_2026');

    await expect(
      provisionTenantFromSignup({
        userId: USER,
        verifiedEmail: 'dona@example.invalid',
        cpfCnpj: '24971563792',
        expectedPriceCents: 19_700,
      }),
    ).resolves.toMatchObject({ ok: true });
    expect(mocks.provision).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        trialDays: 14,
        trialEndsAt: new Date('2026-10-15T12:00:00.000Z'),
        enforceTrialDeadline: true,
        initialBillingStatus: 'trial',
      }),
      expect.any(Function),
    );
  });

  it('recusa provisionamento tardio sem primeira cobrança paga', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-16T12:00:00.000Z'));
    setup('clinica_2026_2');

    await expect(
      provisionTenantFromSignup({
        userId: USER,
        verifiedEmail: 'dona@example.invalid',
        cpfCnpj: '24971563792',
      }),
    ).resolves.toEqual({ ok: false, reason: 'not_paid' });
    expect(mocks.provision).not.toHaveBeenCalled();
  });

  it('provisiona como ativo após pagamento confirmado e período vigente', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-16T12:00:00.000Z'));
    setup('clinica_2026_3');
    const paidCheckout = {
      through: new Date('2026-11-16T00:00:00.000Z'),
      payment: {
        paymentId: 'pay_test',
        status: 'CONFIRMED',
        value: 197,
        dueDate: '2026-10-16',
        invoiceUrl: null,
        subscriptionId: 'sub_test',
        billingType: 'CREDIT_CARD',
        externalReference: null,
        checkoutSessionId: 'checkout_test',
        deleted: false,
      },
    };

    await expect(
      provisionTenantFromSignup({
        userId: USER,
        verifiedEmail: 'dona@example.invalid',
        cpfCnpj: '24971563792',
        paidCheckout,
      }),
    ).resolves.toMatchObject({ ok: true });
    expect(mocks.provision).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        trialEndsAt: new Date('2026-10-15T12:00:00.000Z'),
        enforceTrialDeadline: true,
        initialBillingStatus: 'active',
        currentPeriodStart: new Date('2026-10-16T00:00:00.000Z'),
        currentPeriodEnd: paidCheckout.through,
      }),
      expect.any(Function),
    );
    expect(mocks.ensureInvoice).toHaveBeenCalledWith(expect.anything(), {
      paymentId: 'pay_test',
      subscriptionId: 'sub_test',
      value: 197,
      dueDate: '2026-10-16',
    });
    expect(mocks.markInvoicePaid).toHaveBeenCalledWith(
      expect.anything(),
      '55555555-5555-4555-8555-555555555555',
      { id: 'invoice_test' },
      { paymentMethod: 'CREDIT_CARD', providerPaymentId: 'pay_test', idemSuffix: 'pay_test' },
    );
  });

  it('recusa pagamento associado a outro Checkout antes de criar a clínica', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-16T12:00:00.000Z'));
    setup('consultorio_2026');

    await expect(
      provisionTenantFromSignup({
        userId: USER,
        verifiedEmail: 'dona@example.invalid',
        cpfCnpj: '24971563792',
        paidCheckout: {
          through: new Date('2026-11-16T00:00:00.000Z'),
          payment: {
            paymentId: 'pay_other',
            status: 'CONFIRMED',
            value: 197,
            dueDate: '2026-10-16',
            invoiceUrl: null,
            subscriptionId: 'sub_test',
            billingType: 'CREDIT_CARD',
            externalReference: null,
            checkoutSessionId: 'checkout_other',
            deleted: false,
          },
        },
      }),
    ).resolves.toEqual({ ok: false, reason: 'not_paid' });
    expect(mocks.provision).not.toHaveBeenCalled();
    expect(mocks.ensureInvoice).not.toHaveBeenCalled();
  });

  it('não confirma o provisionamento pago sem materializar a primeira fatura', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-16T12:00:00.000Z'));
    setup('consultorio_2026');
    mocks.ensureInvoice.mockResolvedValue(null);

    await expect(
      provisionTenantFromSignup({
        userId: USER,
        verifiedEmail: 'dona@example.invalid',
        cpfCnpj: '24971563792',
        paidCheckout: {
          through: new Date('2026-11-16T00:00:00.000Z'),
          payment: {
            paymentId: 'pay_test',
            status: 'RECEIVED',
            value: 197,
            dueDate: '2026-10-16',
            invoiceUrl: null,
            subscriptionId: 'sub_test',
            billingType: 'CREDIT_CARD',
            externalReference: null,
            checkoutSessionId: 'checkout_test',
            deleted: false,
          },
        },
      }),
    ).rejects.toThrow('parcela paga sem assinatura');
    expect(mocks.markInvoicePaid).not.toHaveBeenCalled();
  });

  it('preserva o trial legado quando o Auth não informa o marco', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-03T12:00:00.000Z'));
    setup('solo');
    mocks.authCreatedAt.mockResolvedValue(null);

    await expect(
      provisionTenantFromSignup({
        userId: USER,
        verifiedEmail: 'dona@example.invalid',
        cpfCnpj: '24971563792',
      }),
    ).resolves.toMatchObject({ ok: true });
    expect(mocks.provision).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ trialDays: 7 }),
      expect.any(Function),
    );
  });

  it('não confunde draft expirado com tenant provisionado', async () => {
    setup('consultorio_2026');
    mocks.results = [[], []];

    await expect(
      provisionTenantFromSignup({
        userId: USER,
        verifiedEmail: 'dona@example.invalid',
        cpfCnpj: '24971563792',
        expectedAsaasSubscriptionId: 'sub_test',
      }),
    ).resolves.toEqual({ ok: false, reason: 'gone' });
    expect(mocks.provision).not.toHaveBeenCalled();
  });

  it('reconhece a aba vencedora somente pela mesma assinatura e pelo owner', async () => {
    setup('consultorio_2026');
    const clinicId = '55555555-5555-4555-8555-555555555555';
    mocks.results = [[], [{ clinicId }]];

    await expect(
      provisionTenantFromSignup({
        userId: USER,
        verifiedEmail: 'dona@example.invalid',
        cpfCnpj: '24971563792',
        expectedAsaasSubscriptionId: 'sub_test',
      }),
    ).resolves.toEqual({ ok: true, clinicId });
    expect(mocks.provision).not.toHaveBeenCalled();
  });

  it('recusa assinatura trocada antes de criar a clínica', async () => {
    setup('consultorio_2026');

    await expect(
      provisionTenantFromSignup({
        userId: USER,
        verifiedEmail: 'dona@example.invalid',
        cpfCnpj: '24971563792',
        expectedAsaasSubscriptionId: 'sub_other',
      }),
    ).resolves.toEqual({ ok: false, reason: 'not_paid' });
    expect(mocks.provision).not.toHaveBeenCalled();
  });

  it('recusa preço alterado entre o readback do Asaas e a transação', async () => {
    setup('consultorio_2026');
    await expect(
      provisionTenantFromSignup({
        userId: USER,
        verifiedEmail: 'dona@example.invalid',
        cpfCnpj: '24971563792',
        expectedAsaasSubscriptionId: 'sub_test',
        expectedPriceCents: 1,
      }),
    ).resolves.toEqual({ ok: false, reason: 'not_paid' });
    expect(mocks.provision).not.toHaveBeenCalled();
  });
});
