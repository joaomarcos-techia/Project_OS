import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  BillingCircuitOpenError,
  BillingProviderError,
  BillingProviderUnreachableError,
  type PaymentProvider,
} from '@/lib/payments/asaas';

const billing = vi.hoisted(() => ({
  reserve: vi.fn(),
  activate: vi.fn(),
  mark: vi.fn(),
  reconcile: vi.fn(),
  target: vi.fn(),
}));

vi.mock('./signup-billing', () => ({
  reserveSignupBillingAttempt: billing.reserve,
  activateSignupBillingAttempt: billing.activate,
  markSignupBillingIssue: billing.mark,
  reconcileSignupBillingAttempt: billing.reconcile,
  readSignupBillingReconcileTarget: billing.target,
  centsToReais: (cents: number) => Number((cents / 100).toFixed(2)),
}));

import { reconcileSignupSubscription, startSignupSubscription } from './signup-checkout';

const USER = '11111111-1111-4111-8111-111111111111';
const EMAIL = 'dona@example.invalid';
/** CPF de teste do sandbox; não é PII real. */
const CPF = '24971563792';

const INTENT = {
  externalReference: 'signup:aaaaaaaa-0000-4000-8000-000000000001',
  planId: 'bbbbbbbb-0000-4000-8000-000000000002',
  planCode: 'essencial',
  priceId: 'cccccccc-0000-4000-8000-000000000003',
  priceCents: 34_900,
  clinicName: 'Clínica Aurora',
  ownerName: 'Ana Prado',
  trialDays: 7,
  nextDueDate: '2026-09-25',
};

/** Só os métodos que esta orquestração pode tocar. O resto explode se for usado. */
function fakeProvider(overrides: Partial<PaymentProvider> = {}): PaymentProvider {
  const notAllowed = (name: string) => () => {
    throw new Error(`[test] ${name} não deveria ser chamado nesta orquestração`);
  };
  return new Proxy(
    {
      findSubscriptionByExternalReference: vi.fn().mockResolvedValue(null),
      createCustomer: vi.fn().mockResolvedValue({ customerId: 'cus_1' }),
      createSubscription: vi.fn().mockResolvedValue({ subscriptionId: 'sub_1' }),
      getSubscription: vi.fn().mockResolvedValue({
        subscriptionId: 'sub_1',
        status: 'ACTIVE',
        value: 349,
        customerId: 'cus_1',
        externalReference: INTENT.externalReference,
      }),
      cancelSubscription: vi.fn().mockResolvedValue(undefined),
      deleteCustomer: vi.fn().mockResolvedValue(undefined),
      ...overrides,
    } as unknown as PaymentProvider,
    {
      get(target, prop: string) {
        const value = Reflect.get(target, prop);
        return value ?? notAllowed(prop);
      },
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  billing.reserve.mockResolvedValue({ ok: true, rowVersion: 7, intent: INTENT });
  billing.activate.mockResolvedValue({ ok: true, rowVersion: 8 });
  billing.mark.mockResolvedValue({ ok: true, rowVersion: 8 });
  billing.reconcile.mockResolvedValue({ ok: true, rowVersion: 9 });
});

describe('O-5 — início da assinatura recorrente', () => {
  it('reserva antes de qualquer I/O, cria sem cartão e ativa por CAS', async () => {
    const client = fakeProvider();

    const result = await startSignupSubscription({
      userId: USER,
      verifiedEmail: EMAIL,
      cpfCnpj: CPF,
      client,
    });

    expect(result).toEqual({ ok: true, state: 'active', subscriptionId: 'sub_1' });
    // A reserva precede a chamada externa: é o que garante que um timeout não
    // deixe o sistema sem saber que tentou.
    const reserveOrder = billing.reserve.mock.invocationCallOrder[0] ?? Infinity;
    const createOrder =
      (client.createSubscription as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0] ??
      -Infinity;
    expect(reserveOrder).toBeLessThan(createOrder);
    // Valor e ciclo vêm do catálogo resolvido no servidor, nunca do browser.
    expect(client.createSubscription).toHaveBeenCalledWith(
      expect.objectContaining({
        value: 349,
        cycle: 'MONTHLY',
        nextDueDate: INTENT.nextDueDate,
        externalReference: INTENT.externalReference,
        billingType: 'UNDEFINED',
      }),
    );
    expect(billing.activate).toHaveBeenCalledWith({
      userId: USER,
      reservedVersion: 7,
      asaasCustomerId: 'cus_1',
      asaasSubscriptionId: 'sub_1',
    });
  });

  it('manda o documento ao criar o customer — o Asaas recusa assinar sem ele', async () => {
    const client = fakeProvider();

    await startSignupSubscription({ userId: USER, verifiedEmail: EMAIL, cpfCnpj: CPF, client });

    // Medido no sandbox: sem `cpfCnpj`, POST /subscriptions devolve 400
    // invalid_object — com ou sem billingType. Ver ADR-053.
    expect(client.createCustomer).toHaveBeenCalledWith({
      name: INTENT.ownerName,
      email: EMAIL,
      cpfCnpj: CPF,
    });
  });

  it('nunca envia dado de cartão ao provedor', async () => {
    const client = fakeProvider();

    await startSignupSubscription({ userId: USER, verifiedEmail: EMAIL, cpfCnpj: CPF, client });

    const payload = JSON.stringify(
      (client.createSubscription as ReturnType<typeof vi.fn>).mock.calls[0]?.[0],
    );
    for (const forbidden of ['creditCard', 'holderInfo', 'ccv', 'number', 'remoteIp']) {
      expect(payload).not.toContain(forbidden);
    }
  });

  it('aproveita assinatura já criada por tentativa anterior, sem criar a segunda', async () => {
    const client = fakeProvider({
      findSubscriptionByExternalReference: vi.fn().mockResolvedValue({
        subscriptionId: 'sub_recuperada',
        status: 'ACTIVE',
        value: 349,
        customerId: 'cus_antigo',
        externalReference: INTENT.externalReference,
      }),
      getSubscription: vi.fn().mockResolvedValue({
        subscriptionId: 'sub_recuperada',
        status: 'ACTIVE',
        value: 349,
        customerId: 'cus_antigo',
        externalReference: INTENT.externalReference,
      }),
    });

    const result = await startSignupSubscription({
      userId: USER,
      verifiedEmail: EMAIL,
      cpfCnpj: CPF,
      client,
    });

    expect(result).toEqual({ ok: true, state: 'active', subscriptionId: 'sub_recuperada' });
    expect(client.createCustomer).not.toHaveBeenCalled();
    expect(client.createSubscription).not.toHaveBeenCalled();
  });

  it('4xx do provedor é definitivo: marca failed, compensa o customer desta tentativa', async () => {
    const client = fakeProvider({
      createSubscription: vi
        .fn()
        .mockRejectedValue(
          new BillingProviderError('recusado', 'billing_provider_error', 400, ['invalid_cpfCnpj']),
        ),
    });

    const result = await startSignupSubscription({
      userId: USER,
      verifiedEmail: EMAIL,
      cpfCnpj: CPF,
      client,
    });

    expect(result).toEqual({ ok: false, reason: 'declined' });
    expect(client.deleteCustomer).toHaveBeenCalledWith('cus_1');
    expect(billing.mark).toHaveBeenCalledWith({
      userId: USER,
      reservedVersion: 7,
      outcome: 'failed',
      // Código sanitizado e curto — nunca o corpo do provedor.
      failureCode: 'invalid_cpfcnpj',
    });
  });

  it.each([
    ['timeout/5xx', new BillingProviderUnreachableError('socket morreu')],
    ['circuito aberto', new BillingCircuitOpenError()],
  ])('%s vira creation_unknown sem compensar e sem permitir retry cego', async (_l, error) => {
    const client = fakeProvider({ createSubscription: vi.fn().mockRejectedValue(error) });

    const result = await startSignupSubscription({
      userId: USER,
      verifiedEmail: EMAIL,
      cpfCnpj: CPF,
      client,
    });

    expect(result).toEqual({ ok: false, reason: 'provider_unreachable' });
    expect(billing.mark).toHaveBeenCalledWith({
      userId: USER,
      reservedVersion: 7,
      outcome: 'creation_unknown',
      failureCode: 'subscription_creation_unknown',
      asaasCustomerId: 'cus_1',
    });
    // Apagar um customer cuja assinatura talvez exista é pior que mantê-lo.
    expect(client.deleteCustomer).not.toHaveBeenCalled();
    expect(client.cancelSubscription).not.toHaveBeenCalled();
  });

  it.each([
    ['valor divergente', { status: 'ACTIVE', value: 1 }],
    ['estado não ativo', { status: 'INACTIVE', value: 349 }],
  ])('readback que não confere (%s) cancela em vez de iniciar o trial', async (_l, readback) => {
    const client = fakeProvider({
      getSubscription: vi.fn().mockResolvedValue({
        subscriptionId: 'sub_1',
        customerId: 'cus_1',
        externalReference: INTENT.externalReference,
        ...readback,
      }),
    });

    const result = await startSignupSubscription({
      userId: USER,
      verifiedEmail: EMAIL,
      cpfCnpj: CPF,
      client,
    });

    expect(result).toEqual({ ok: false, reason: 'declined' });
    expect(client.cancelSubscription).toHaveBeenCalledWith('sub_1');
    expect(billing.mark).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'failed', failureCode: 'subscription_readback_mismatch' }),
    );
    expect(billing.activate).not.toHaveBeenCalled();
  });

  it('perder o CAS da ativação cancela a assinatura em vez de deixá-la órfã', async () => {
    billing.activate.mockResolvedValue({ ok: false, reason: 'conflict' });
    const client = fakeProvider();

    const result = await startSignupSubscription({
      userId: USER,
      verifiedEmail: EMAIL,
      cpfCnpj: CPF,
      client,
    });

    expect(result).toEqual({ ok: false, reason: 'conflict' });
    expect(client.cancelSubscription).toHaveBeenCalledWith('sub_1');
    expect(client.deleteCustomer).toHaveBeenCalledWith('cus_1');
  });

  it.each([
    ['já ativa', 'already_active'],
    ['pendente de reconciliação', 'reconcile_required'],
    ['sem plano', 'no_plan'],
    ['draft ausente', 'gone'],
    ['gate desligado', 'unavailable'],
  ])('%s não chega a tocar no provedor', async (_l, reason) => {
    billing.reserve.mockResolvedValue({ ok: false, reason });
    const client = fakeProvider();

    const result = await startSignupSubscription({
      userId: USER,
      verifiedEmail: EMAIL,
      cpfCnpj: CPF,
      client,
    });

    expect(result).toEqual({ ok: false, reason });
    expect(client.findSubscriptionByExternalReference).not.toHaveBeenCalled();
    expect(client.createCustomer).not.toHaveBeenCalled();
    expect(client.createSubscription).not.toHaveBeenCalled();
  });

  it('erro inesperado sobe, em vez de virar sucesso silencioso', async () => {
    const client = fakeProvider({
      createSubscription: vi.fn().mockRejectedValue(new TypeError('bug de programação')),
    });

    await expect(
      startSignupSubscription({ userId: USER, verifiedEmail: EMAIL, cpfCnpj: CPF, client }),
    ).rejects.toThrow(TypeError);
    expect(billing.mark).not.toHaveBeenCalled();
    expect(billing.activate).not.toHaveBeenCalled();
  });
});

describe('O-5 — reconciliação, a única saída de creation_unknown', () => {
  beforeEach(() => {
    billing.target.mockResolvedValue({
      externalReference: INTENT.externalReference,
      asaasCustomerId: 'cus_1',
    });
  });

  it('registra a assinatura que o timeout escondeu, sem criar nada', async () => {
    const client = fakeProvider({
      findSubscriptionByExternalReference: vi.fn().mockResolvedValue({
        subscriptionId: 'sub_perdida',
        status: 'ACTIVE',
        value: 349,
        customerId: 'cus_1',
        externalReference: INTENT.externalReference,
      }),
    });

    const result = await reconcileSignupSubscription({ userId: USER, client });

    expect(result).toEqual({ ok: true, state: 'active' });
    expect(client.createSubscription).not.toHaveBeenCalled();
    expect(client.createCustomer).not.toHaveBeenCalled();
    expect(billing.reconcile).toHaveBeenCalledWith({
      userId: USER,
      asaasCustomerId: 'cus_1',
      asaasSubscriptionId: 'sub_perdida',
    });
  });

  it('não encontrando nada, mantém o estado e não libera nova criação', async () => {
    const client = fakeProvider();

    const result = await reconcileSignupSubscription({ userId: USER, client });

    expect(result).toEqual({ ok: true, state: 'not_found' });
    expect(billing.reconcile).not.toHaveBeenCalled();
    expect(client.createSubscription).not.toHaveBeenCalled();
  });

  it('provedor indisponível não altera estado', async () => {
    const client = fakeProvider({
      findSubscriptionByExternalReference: vi
        .fn()
        .mockRejectedValue(new BillingProviderUnreachableError('timeout')),
    });

    const result = await reconcileSignupSubscription({ userId: USER, client });

    expect(result).toEqual({ ok: false, reason: 'provider_unreachable' });
    expect(billing.reconcile).not.toHaveBeenCalled();
  });

  it('sem alvo em creation_unknown, não consulta o provedor', async () => {
    billing.target.mockResolvedValue(null);
    const client = fakeProvider();

    const result = await reconcileSignupSubscription({ userId: USER, client });

    expect(result).toEqual({ ok: false, reason: 'gone' });
    expect(client.findSubscriptionByExternalReference).not.toHaveBeenCalled();
  });
});
