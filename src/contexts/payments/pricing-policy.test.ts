import { describe, expect, it } from 'vitest';

import { resolveProcedurePaymentPrice } from './pricing-policy';

const prices = [
  { method: 'pix' as const, installmentCount: null, grossAmount: 240 },
  { method: 'cash' as const, installmentCount: null, grossAmount: 250 },
  { method: 'credit_card' as const, installmentCount: 1, grossAmount: 255 },
  { method: 'credit_card' as const, installmentCount: 3, grossAmount: 260 },
];

describe('resolveProcedurePaymentPrice', () => {
  it('ABSORB_FEES mantém o preço clínico, qualquer que seja o método', () => {
    expect(
      resolveProcedurePaymentPrice({
        mode: 'absorb_fees',
        standardGrossAmount: 250,
        method: 'pix',
        prices,
      }),
    ).toEqual({ available: true, grossAmount: 250, source: 'standard' });
  });

  it('PIX explícito vira o bruto cobrado, não uma taxa escondida', () => {
    expect(
      resolveProcedurePaymentPrice({
        mode: 'payment_method_pricing',
        standardGrossAmount: 250,
        method: 'pix',
        prices,
      }),
    ).toEqual({ available: true, grossAmount: 240, source: 'explicit_method_price' });
  });

  it.each([
    [1, 255],
    [3, 260],
  ])('resolve cartão de %sx sem estimar tarifa do provedor', (installmentCount, grossAmount) => {
    expect(
      resolveProcedurePaymentPrice({
        mode: 'payment_method_pricing',
        standardGrossAmount: 250,
        method: 'credit_card',
        installmentCount,
        prices,
      }),
    ).toEqual({ available: true, grossAmount, source: 'explicit_method_price' });
  });

  it('não faz fallback silencioso quando a política exige preço por método', () => {
    expect(
      resolveProcedurePaymentPrice({
        mode: 'payment_method_pricing',
        standardGrossAmount: 250,
        method: 'credit_card',
        installmentCount: 2,
        prices,
      }),
    ).toEqual({ available: false, reason: 'method_price_not_configured' });
  });
});
