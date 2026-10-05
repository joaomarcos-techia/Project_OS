import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AsaasClient } from '@/lib/payments/asaas';

const mocks = vi.hoisted(() => ({
  env: {
    APP_BASE_URL: 'https://app.qoro.test' as string | undefined,
    NODE_ENV: 'test' as const,
  },
  claim: vi.fn(),
  claimRenewal: vi.fn(),
  activate: vi.fn(),
  markIssue: vi.fn(),
  createCheckout: vi.fn(),
  cancelCheckout: vi.fn(),
  findPaymentByCheckoutSession: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/env', () => ({ env: mocks.env }));
vi.mock('@/lib/observability/metrics', () => ({ metrics: { emit: vi.fn() } }));
vi.mock('./charge-store', () => ({
  claimInitialCheckoutCharge: mocks.claim,
  claimRemainderCheckoutRenewal: mocks.claimRenewal,
  activateCheckoutGeneration: mocks.activate,
  markCheckoutCreationIssue: mocks.markIssue,
}));

import { BillingProviderError, BillingProviderUnreachableError } from '@/lib/payments/asaas';

import {
  createInitialHostedCheckout,
  renewRemainderHostedCheckout,
  resolveCheckoutWindow,
} from './hosted-checkout';

const NOW = new Date('2026-08-29T12:00:00.000Z');
const COLLECTION_END = new Date('2026-09-05T12:00:00.000Z');

function client(): AsaasClient {
  return {
    createCheckout: mocks.createCheckout,
    cancelCheckout: mocks.cancelCheckout,
    findPaymentByCheckoutSession: mocks.findPaymentByCheckoutSession,
  } as unknown as AsaasClient;
}

function run() {
  return createInitialHostedCheckout({
    client: client(),
    clinicId: 'clinic-1',
    appointmentId: 'appointment-1',
    patientId: 'patient-1',
    kind: 'remainder',
    amount: 75,
    description: 'Restante do atendimento',
    holdExpiresAt: null,
    collectionExpiresAt: COLLECTION_END,
    now: NOW,
  });
}

function renew() {
  return renewRemainderHostedCheckout({
    client: client(),
    clinicId: 'clinic-1',
    candidate: {
      chargeId: 'charge-1',
      appointmentId: 'appointment-1',
      patientId: 'patient-1',
      amount: 75,
      generation: 1,
      providerCheckoutId: 'checkout-1',
      collectionExpiresAt: COLLECTION_END,
      requestedPaymentMethod: null,
      requestedInstallmentCount: null,
    },
    now: NOW,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.env.APP_BASE_URL = 'https://app.qoro.test';
  mocks.claim.mockResolvedValue({
    state: 'claimed',
    chargeId: 'charge-1',
    generationId: 'generation-1',
    generation: 1,
    externalReference: 'remainder:appointment-1:g1',
    expiresAt: new Date('2026-08-30T12:00:00.000Z'),
  });
  mocks.createCheckout.mockResolvedValue({
    checkoutId: 'checkout-1',
    status: 'ACTIVE',
    link: 'https://sandbox.asaas.com/checkoutSession/show?id=checkout-1',
    externalReference: 'remainder:appointment-1:g1',
  });
  mocks.activate.mockResolvedValue(true);
  mocks.markIssue.mockResolvedValue(undefined);
  mocks.cancelCheckout.mockResolvedValue(undefined);
  mocks.findPaymentByCheckoutSession.mockResolvedValue(null);
  mocks.claimRenewal.mockResolvedValue({
    state: 'claimed',
    chargeId: 'charge-1',
    generationId: 'generation-2',
    generation: 2,
    externalReference: 'remainder:appointment-1:g2',
  });
});

describe('resolveCheckoutWindow', () => {
  it('limita cada geração a 24 horas', () => {
    expect(resolveCheckoutWindow(NOW, COLLECTION_END)).toEqual({
      minutesToExpire: 1_440,
      expiresAt: new Date('2026-08-30T12:00:00.000Z'),
    });
  });

  it('usa a janela local menor sem ultrapassá-la', () => {
    const end = new Date('2026-08-29T12:17:59.000Z');
    expect(resolveCheckoutWindow(NOW, end)).toEqual({
      minutesToExpire: 17,
      expiresAt: new Date('2026-08-29T12:17:00.000Z'),
    });
  });

  it('não cria Checkout com menos de 10 minutos restantes', () => {
    expect(resolveCheckoutWindow(NOW, new Date('2026-08-29T12:09:59.000Z'))).toBeNull();
  });
});

describe('createInitialHostedCheckout', () => {
  it('persiste o lease antes do POST e ativa a mesma geração', async () => {
    await expect(run()).resolves.toBe('created');

    expect(mocks.claim.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.createCheckout.mock.invocationCallOrder[0]!,
    );
    expect(mocks.createCheckout).toHaveBeenCalledWith({
      value: 75,
      description: 'Restante do atendimento',
      externalReference: 'remainder:appointment-1:g1',
      minutesToExpire: 1_440,
      callback: {
        successUrl: 'https://app.qoro.test/?payment=success',
        cancelUrl: 'https://app.qoro.test/?payment=cancelled',
        expiredUrl: 'https://app.qoro.test/?payment=expired',
      },
    });
    expect(mocks.activate).toHaveBeenCalledWith(
      expect.objectContaining({
        chargeId: 'charge-1',
        generationId: 'generation-1',
        providerCheckoutId: 'checkout-1',
        checkoutUrl: 'https://sandbox.asaas.com/checkoutSession/show?id=checkout-1',
        expiresAt: new Date('2026-08-30T12:00:00.000Z'),
      }),
    );
  });

  it('quem perde a UNIQUE não chama o Asaas', async () => {
    mocks.claim.mockResolvedValue({ state: 'existing', chargeId: 'charge-1' });

    await expect(run()).resolves.toBe('existing');

    expect(mocks.createCheckout).not.toHaveBeenCalled();
    expect(mocks.activate).not.toHaveBeenCalled();
  });

  it('leva cartão em 1x ao lease e ao Checkout sem prometer parcelas variáveis', async () => {
    await createInitialHostedCheckout({
      client: client(),
      clinicId: 'clinic-1',
      appointmentId: 'appointment-1',
      patientId: 'patient-1',
      kind: 'remainder',
      amount: 260,
      description: 'Restante do atendimento',
      holdExpiresAt: null,
      collectionExpiresAt: COLLECTION_END,
      paymentMethod: 'credit_card',
      installmentCount: 1,
      now: NOW,
    });

    expect(mocks.claim).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 260,
        requestedPaymentMethod: 'credit_card',
        requestedInstallmentCount: 1,
      }),
    );
    expect(mocks.createCheckout).toHaveBeenCalledWith(
      expect.objectContaining({
        value: 260,
        billingTypes: ['CREDIT_CARD'],
      }),
    );
    expect(mocks.createCheckout.mock.calls[0]?.[0]).not.toHaveProperty('maxInstallmentCount');
  });

  it.each([
    ['cartão parcelado', 'credit_card' as const, 3],
    ['cartão sem parcelas explícitas', 'credit_card' as const, null],
    ['Pix com parcelas', 'pix' as const, 2],
  ])(
    'bloqueia %s antes do lease e do provider',
    async (_label, paymentMethod, installmentCount) => {
      await expect(
        createInitialHostedCheckout({
          client: client(),
          clinicId: 'clinic-1',
          appointmentId: 'appointment-1',
          patientId: 'patient-1',
          kind: 'remainder',
          amount: 260,
          description: 'Restante do atendimento',
          holdExpiresAt: null,
          collectionExpiresAt: COLLECTION_END,
          paymentMethod,
          installmentCount,
          now: NOW,
        }),
      ).resolves.toBe('unsupported_condition');
      expect(mocks.claim).not.toHaveBeenCalled();
      expect(mocks.createCheckout).not.toHaveBeenCalled();
    },
  );

  it('4xx marca falha definitiva antes de propagar', async () => {
    const error = new BillingProviderError('recusado', 'billing_provider_error', 400, [
      'invalid_customer',
    ]);
    mocks.createCheckout.mockRejectedValue(error);

    await expect(run()).rejects.toBe(error);
    expect(mocks.markIssue).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'failed', failureCode: 'invalid_customer' }),
    );
  });

  it('timeout vira creation_unknown e não autoriza retry cego', async () => {
    const error = new BillingProviderUnreachableError('timeout');
    mocks.createCheckout.mockRejectedValue(error);

    await expect(run()).rejects.toBe(error);
    expect(mocks.markIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'creation_unknown',
        failureCode: 'checkout_creation_unknown',
      }),
    );
  });

  it('resposta sem link não é ativada e o recurso é cancelado', async () => {
    mocks.createCheckout.mockResolvedValue({
      checkoutId: 'checkout-1',
      status: 'ACTIVE',
      link: null,
      externalReference: 'remainder:appointment-1:g1',
    });

    await expect(run()).rejects.toMatchObject({ code: 'checkout_response_invalid' });
    expect(mocks.markIssue).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'failed', failureCode: 'checkout_response_invalid' }),
    );
    expect(mocks.cancelCheckout).toHaveBeenCalledWith('checkout-1');
    expect(mocks.activate).not.toHaveBeenCalled();
  });

  it('corrida com fechamento local cancela o Checkout recém-criado', async () => {
    mocks.activate.mockResolvedValue(false);

    await expect(run()).resolves.toBe('existing');
    expect(mocks.cancelCheckout).toHaveBeenCalledWith('checkout-1');
  });

  it('configuração sem APP_BASE_URL falha antes de gravar intenção', async () => {
    mocks.env.APP_BASE_URL = undefined;

    await expect(run()).rejects.toThrow('APP_BASE_URL');
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.createCheckout).not.toHaveBeenCalled();
  });
});

describe('renewRemainderHostedCheckout', () => {
  it('não consulta o provider nem renova Checkout parcelado sem quantidade exata', async () => {
    await expect(
      renewRemainderHostedCheckout({
        client: client(),
        clinicId: 'clinic-1',
        candidate: {
          chargeId: 'charge-1',
          appointmentId: 'appointment-1',
          patientId: 'patient-1',
          amount: 260,
          generation: 1,
          providerCheckoutId: 'checkout-1',
          collectionExpiresAt: COLLECTION_END,
          requestedPaymentMethod: 'credit_card',
          requestedInstallmentCount: 3,
        },
        now: NOW,
      }),
    ).resolves.toBe('unsupported_condition');
    expect(mocks.findPaymentByCheckoutSession).not.toHaveBeenCalled();
    expect(mocks.claimRenewal).not.toHaveBeenCalled();
    expect(mocks.createCheckout).not.toHaveBeenCalled();
  });

  it('confere se a geração anterior criou payment antes de reservar a próxima', async () => {
    await expect(renew()).resolves.toBe('created');

    expect(mocks.findPaymentByCheckoutSession).toHaveBeenCalledWith('checkout-1', {
      attempts: 1,
    });
    expect(mocks.findPaymentByCheckoutSession.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.claimRenewal.mock.invocationCallOrder[0]!,
    );
    expect(mocks.createCheckout).toHaveBeenCalledWith(
      expect.objectContaining({ externalReference: 'remainder:appointment-1:g2' }),
    );
  });

  it('não renova se já existe cobrança viva originada pela geração anterior', async () => {
    mocks.findPaymentByCheckoutSession.mockResolvedValue({
      paymentId: 'pay-1',
      deleted: false,
    });

    await expect(renew()).resolves.toBe('payment_exists');
    expect(mocks.claimRenewal).not.toHaveBeenCalled();
    expect(mocks.createCheckout).not.toHaveBeenCalled();
  });

  it('dois workers respeitam o CAS/lease e só o vencedor chama o POST', async () => {
    mocks.claimRenewal.mockResolvedValue({ state: 'lost' });

    await expect(renew()).resolves.toBe('lost');
    expect(mocks.createCheckout).not.toHaveBeenCalled();
  });
});
