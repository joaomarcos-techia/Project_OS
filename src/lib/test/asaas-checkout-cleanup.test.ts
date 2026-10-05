import { describe, expect, it, vi } from 'vitest';

import {
  classifyCheckoutCleanup,
  completedRefundValue,
  hasCheckoutRefundInFlight,
  isCancelledCheckoutResponse,
  requestCheckoutRefundWithRetry,
  retainCheckoutForChargeback,
} from './asaas-checkout-cleanup';

describe('isCancelledCheckoutResponse', () => {
  it('confirma apenas o mesmo checkout no estado terminal de cancelamento', () => {
    expect(
      isCancelledCheckoutResponse({ id: 'checkout-test', status: 'CANCELED' }, 'checkout-test'),
    ).toBe(true);
  });

  it.each([
    { id: 'outro-checkout', status: 'CANCELED' },
    { id: 'checkout-test', status: 'ACTIVE' },
    { id: 'checkout-test' },
    null,
  ])('recusa resposta sem cancelamento comprovado: %#', (response) => {
    expect(isCancelledCheckoutResponse(response, 'checkout-test')).toBe(false);
  });
});

describe('classifyCheckoutCleanup', () => {
  it('a conferência de repetição soma somente dinheiro efetivamente devolvido', () => {
    expect(
      completedRefundValue([
        { status: 'DONE', value: 10 },
        { status: 'PENDING', value: 10 },
        { status: 'REFUNDED', value: 10 },
        { status: 'CANCELLED', value: 10 },
      ]),
    ).toBe(10);
  });
  it('aceita cobranca removida pelo provider', () => {
    expect(
      classifyCheckoutCleanup({
        paymentStatus: 'PENDING',
        paymentDeleted: true,
        expectedRefundValue: 10,
        refunds: [],
      }),
    ).toEqual({ state: 'complete' });
  });

  it('aceita somente estornos DONE cujo total cobre o pagamento', () => {
    expect(
      classifyCheckoutCleanup({
        paymentStatus: 'RECEIVED',
        paymentDeleted: false,
        expectedRefundValue: 10,
        refunds: [
          { status: 'DONE', value: 4 },
          { status: 'DONE', value: 6 },
        ],
      }),
    ).toEqual({ state: 'complete' });
  });

  it.each(['REFUNDED', 'CONFIRMED', 'COMPLETED'])(
    'nao aceita %s como status terminal de um estorno Asaas',
    (status) => {
      expect(
        classifyCheckoutCleanup({
          paymentStatus: 'RECEIVED',
          paymentDeleted: false,
          expectedRefundValue: 10,
          refunds: [{ status, value: 10 }],
        }),
      ).toEqual({ state: 'pending' });
    },
  );

  it('espera o estorno DONE mesmo se a cobranca ja aparece REFUNDED', () => {
    expect(
      classifyCheckoutCleanup({
        paymentStatus: 'REFUNDED',
        paymentDeleted: false,
        expectedRefundValue: 10,
        refunds: [{ status: 'PENDING', value: 10 }],
      }),
    ).toEqual({ state: 'pending' });
  });

  it('separa autorizacao critica pendente de estorno concluido', () => {
    expect(
      classifyCheckoutCleanup({
        paymentStatus: 'RECEIVED',
        paymentDeleted: false,
        expectedRefundValue: 10,
        refunds: [{ status: 'AWAITING_CRITICAL_ACTION_AUTHORIZATION', value: 10 }],
      }),
    ).toEqual({ state: 'pending-critical-action' });
  });

  it('separa estorno cancelado de processamento pendente', () => {
    expect(
      classifyCheckoutCleanup({
        paymentStatus: 'RECEIVED',
        paymentDeleted: false,
        expectedRefundValue: 10,
        refunds: [{ status: 'CANCELLED', value: 10 }],
      }),
    ).toEqual({ state: 'cancelled' });
  });

  it.each(['PENDING', 'REFUND_REQUESTED', 'REFUND_IN_PROGRESS', 'DENIED'])(
    'nao declara o estorno %s como concluido',
    (status) => {
      expect(
        classifyCheckoutCleanup({
          paymentStatus: 'RECEIVED',
          paymentDeleted: false,
          expectedRefundValue: 10,
          refunds: [{ status, value: 10 }],
        }),
      ).toEqual({ state: 'pending' });
    },
  );
});

describe('retainCheckoutForChargeback', () => {
  const expectedOptIn = 'RETAIN_PAID_CARD_FOR_ASAAS';

  it('mantem a limpeza normal sem opt-in', () => {
    expect(
      retainCheckoutForChargeback({
        optIn: undefined,
        expectedOptIn,
        interactive: true,
        method: 'CREDIT_CARD',
      }),
    ).toBe(false);
  });

  it('aceita somente opt-in exato, interativo e por cartao', () => {
    expect(
      retainCheckoutForChargeback({
        optIn: expectedOptIn,
        expectedOptIn,
        interactive: true,
        method: 'CREDIT_CARD',
      }),
    ).toBe(true);
  });

  it.each([
    { optIn: 'sim', interactive: true, method: 'CREDIT_CARD' as const },
    { optIn: expectedOptIn, interactive: false, method: 'CREDIT_CARD' as const },
    { optIn: expectedOptIn, interactive: true, method: 'PIX' as const },
  ])('rejeita retencao insegura: %#', (input) => {
    expect(() => retainCheckoutForChargeback({ ...input, expectedOptIn })).toThrow();
  });
});

describe('hasCheckoutRefundInFlight', () => {
  it.each(['REFUND_REQUESTED', 'REFUND_IN_PROGRESS', 'REFUNDED'])(
    'protege o status %s mesmo sem lista de estornos',
    (paymentStatus) => {
      expect(hasCheckoutRefundInFlight({ paymentStatus, refunds: [] })).toBe(true);
    },
  );

  it('protege uma cobranca quando o provider ja lista o estorno', () => {
    expect(
      hasCheckoutRefundInFlight({
        paymentStatus: 'RECEIVED',
        refunds: [{ status: 'PENDING', value: 10 }],
      }),
    ).toBe(true);
  });

  it('libera somente uma cobranca sem qualquer sinal de estorno', () => {
    expect(hasCheckoutRefundInFlight({ paymentStatus: 'PENDING', refunds: [] })).toBe(false);
  });
});

describe('requestCheckoutRefundWithRetry', () => {
  const notReady = new Error('invalid_action: tente novamente em alguns instantes');

  it('repete apenas depois de readback sem estorno e encerra quando o POST é aceito', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ accepted: false, error: notReady })
      .mockResolvedValueOnce({ accepted: true });
    const readback = vi.fn().mockResolvedValue({ paymentStatus: 'RECEIVED', refunds: [] });
    const wait = vi.fn().mockResolvedValue(undefined);

    await requestCheckoutRefundWithRetry({ request, readback, wait, maxAttempts: 3 });

    expect(request).toHaveBeenCalledTimes(2);
    expect(readback).toHaveBeenCalledTimes(1);
    expect(wait).toHaveBeenCalledTimes(1);
  });

  it('não repete o POST quando um estorno aparece no readback', async () => {
    const request = vi.fn().mockResolvedValue({ accepted: false, error: notReady });
    const readback = vi.fn().mockResolvedValue({
      paymentStatus: 'RECEIVED',
      refunds: [{ status: 'AWAITING_CRITICAL_ACTION_AUTHORIZATION', value: 10 }],
    });
    const wait = vi.fn();

    await requestCheckoutRefundWithRetry({ request, readback, wait, maxAttempts: 3 });

    expect(request).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
  });

  it('não repete quando o pagamento já aparece estornado no readback', async () => {
    const request = vi.fn().mockResolvedValue({ accepted: false, error: notReady });
    const readback = vi.fn().mockResolvedValue({ paymentStatus: 'REFUNDED', refunds: [] });

    await requestCheckoutRefundWithRetry({
      request,
      readback,
      wait: vi.fn(),
      maxAttempts: 3,
    });

    expect(request).toHaveBeenCalledTimes(1);
  });

  it('propaga a recusa após limite de tentativas sem estorno', async () => {
    const request = vi.fn().mockResolvedValue({ accepted: false, error: notReady });
    const readback = vi.fn().mockResolvedValue({ paymentStatus: 'RECEIVED', refunds: [] });
    const wait = vi.fn().mockResolvedValue(undefined);

    await expect(
      requestCheckoutRefundWithRetry({ request, readback, wait, maxAttempts: 3 }),
    ).rejects.toBe(notReady);
    expect(request).toHaveBeenCalledTimes(3);
    expect(wait).toHaveBeenCalledTimes(2);
  });

  it('não repete se a cobrança deixou de estar em estado reembolsável', async () => {
    const request = vi.fn().mockResolvedValue({ accepted: false, error: notReady });
    const readback = vi.fn().mockResolvedValue({ paymentStatus: 'PENDING', refunds: [] });
    const wait = vi.fn();

    await expect(
      requestCheckoutRefundWithRetry({ request, readback, wait, maxAttempts: 3 }),
    ).rejects.toBe(notReady);
    expect(request).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
  });

  it('não trata uma falha de rede ou autenticação como indisponibilidade transitória', async () => {
    const failure = new Error('provider indisponível');
    const request = vi.fn().mockRejectedValue(failure);
    const readback = vi.fn();

    await expect(
      requestCheckoutRefundWithRetry({ request, readback, wait: vi.fn(), maxAttempts: 3 }),
    ).rejects.toBe(failure);
    expect(request).toHaveBeenCalledTimes(1);
    expect(readback).not.toHaveBeenCalled();
  });
});
