import { describe, expect, it } from 'vitest';

import { calculateProfessionalPayout, moneyToCents } from './payout';

describe('calculateProfessionalPayout', () => {
  it('calcula 50% sobre o bruto sem descontar taxa implicitamente', () => {
    expect(
      calculateProfessionalPayout({
        grossAmount: 250,
        netAmount: 245,
        payoutBasis: 'gross',
        rule: { kind: 'percentage', percentage: 50 },
      }),
    ).toEqual({ status: 'calculated', basis: 'gross', basisAmount: 250, payoutAmount: 125 });
  });

  it('calcula 50% sobre o líquido apenas por política explícita', () => {
    expect(
      calculateProfessionalPayout({
        grossAmount: 250,
        netAmount: 245,
        payoutBasis: 'net',
        rule: { kind: 'percentage', percentage: 50 },
      }),
    ).toEqual({ status: 'calculated', basis: 'net', basisAmount: 245, payoutAmount: 122.5 });
  });

  it('mantém NET pendente quando o provedor ainda não informou a economia real', () => {
    expect(
      calculateProfessionalPayout({
        grossAmount: 250,
        netAmount: null,
        payoutBasis: 'net',
        rule: { kind: 'percentage', percentage: 50 },
      }),
    ).toEqual({ status: 'pending_economics', basis: 'net', basisAmount: null, payoutAmount: null });
  });

  it('regra fixa não depende da taxa nem da base', () => {
    expect(
      calculateProfessionalPayout({
        grossAmount: 250,
        netAmount: 245,
        payoutBasis: 'net',
        rule: { kind: 'fixed', fixedAmount: 100 },
      }),
    ).toMatchObject({ status: 'calculated', basisAmount: 245, payoutAmount: 100 });
  });

  it.each([
    [0.01, 1],
    [0.05, 5],
    [0.1, 10],
    [99.99, 9_999],
    [250, 25_000],
  ])('converte %s em %s centavos sem ruído binário', (amount, cents) => {
    expect(moneyToCents(amount)).toBe(cents);
  });

  it('arredonda percentual uma única vez no centavo final', () => {
    expect(
      calculateProfessionalPayout({
        grossAmount: 99.99,
        netAmount: 97.53,
        payoutBasis: 'gross',
        rule: { kind: 'percentage', percentage: 33.3333 },
      }),
    ).toMatchObject({ basisAmount: 99.99, payoutAmount: 33.33 });
  });

  it('recusa percentual inválido em vez de produzir valor silencioso', () => {
    expect(() =>
      calculateProfessionalPayout({
        grossAmount: 250,
        netAmount: 245,
        payoutBasis: 'gross',
        rule: { kind: 'percentage', percentage: 0 },
      }),
    ).toThrow('percentual de repasse inválido');
  });
});
