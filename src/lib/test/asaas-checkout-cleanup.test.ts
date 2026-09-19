import { describe, expect, it } from 'vitest';

import {
  classifyCheckoutCleanup,
  hasCheckoutRefundInFlight,
  retainCheckoutForChargeback,
} from './asaas-checkout-cleanup';

describe('classifyCheckoutCleanup', () => {
  it.each([
    { paymentStatus: 'REFUNDED', paymentDeleted: false },
    { paymentStatus: 'RECEIVED', paymentDeleted: true },
  ])('aceita cobranca encerrada pelo provider: $paymentStatus', (input) => {
    expect(
      classifyCheckoutCleanup({
        ...input,
        expectedRefundValue: 10,
        refunds: [],
      }),
    ).toEqual({ state: 'complete' });
  });

  it('aceita o total confirmado mesmo antes de o status da cobranca mudar', () => {
    expect(
      classifyCheckoutCleanup({
        paymentStatus: 'RECEIVED',
        paymentDeleted: false,
        expectedRefundValue: 10,
        refunds: [
          { status: 'DONE', value: 4 },
          { status: 'REFUNDED', value: 6 },
        ],
      }),
    ).toEqual({ state: 'complete' });
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
  it.each(['REFUND_REQUESTED', 'REFUND_IN_PROGRESS'])(
    'protege o status intermediario %s mesmo sem lista de estornos',
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
