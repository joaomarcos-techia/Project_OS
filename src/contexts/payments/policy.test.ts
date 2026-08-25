/**
 * Regras do sinal (ADR-049 1.2). Funções puras — este arquivo é a especificação
 * executável de quando o paciente é cobrado e quando o dinheiro volta.
 *
 * O caso mais importante do arquivo é o primeiro: política desligada não cobra
 * nada. É ele que garante o aceite da 1.2 ("flag off = comportamento idêntico").
 */
import { describe, expect, it } from 'vitest';

import {
  DEPOSIT_POLICY_OFF,
  isRefundableCancellation,
  resolveDepositAmount,
  type DepositPolicy,
} from './policy';

const on = (over: Partial<DepositPolicy> = {}): DepositPolicy => ({
  ...DEPOSIT_POLICY_OFF,
  enabled: true,
  ...over,
});

describe('resolveDepositAmount', () => {
  it('política desligada não cobra nada — nem na primeira, nem no retorno', () => {
    expect(
      resolveDepositAmount({ policy: DEPOSIT_POLICY_OFF, basePrice: 300, isReturn: false }),
    ).toBeNull();
    expect(
      resolveDepositAmount({ policy: DEPOSIT_POLICY_OFF, basePrice: 300, isReturn: true }),
    ).toBeNull();
  });

  it('aplica o percentual sobre o valor do procedimento', () => {
    expect(resolveDepositAmount({ policy: on(), basePrice: 300, isReturn: false })).toBe(150);
    expect(
      resolveDepositAmount({ policy: on({ percent: 30 }), basePrice: 300, isReturn: false }),
    ).toBe(90);
    expect(
      resolveDepositAmount({ policy: on({ percent: 100 }), basePrice: 300, isReturn: false }),
    ).toBe(300);
  });

  it('arredonda para centavos sem drift de ponto flutuante', () => {
    expect(resolveDepositAmount({ policy: on(), basePrice: 199.99, isReturn: false })).toBe(100);
    expect(
      resolveDepositAmount({ policy: on({ percent: 33 }), basePrice: 100, isReturn: false }),
    ).toBe(33);
    expect(
      resolveDepositAmount({ policy: on({ percent: 15 }), basePrice: 33.33, isReturn: false }),
    ).toBe(5);
  });

  it('respeita o escopo: primeira consulta e retorno são chaveáveis separadamente', () => {
    const soPrimeira = on({ appliesToReturn: false });
    expect(resolveDepositAmount({ policy: soPrimeira, basePrice: 200, isReturn: false })).toBe(100);
    expect(resolveDepositAmount({ policy: soPrimeira, basePrice: 200, isReturn: true })).toBeNull();

    const soRetorno = on({ appliesToFirstVisit: false });
    expect(resolveDepositAmount({ policy: soRetorno, basePrice: 200, isReturn: true })).toBe(100);
    expect(resolveDepositAmount({ policy: soRetorno, basePrice: 200, isReturn: false })).toBeNull();
  });

  it('procedimento sem preço não gera sinal', () => {
    for (const basePrice of [0, -10, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(resolveDepositAmount({ policy: on(), basePrice, isReturn: false })).toBeNull();
    }
  });

  it('sinal que arredonda para zero centavos é tratado como "não se aplica"', () => {
    // 1 centavo × 1% = 0,0001 → zero. Cobrança de R$ 0,00 não pode existir.
    expect(
      resolveDepositAmount({ policy: on({ percent: 1 }), basePrice: 0.01, isReturn: false }),
    ).toBeNull();
  });

  it('nunca cobra mais que o procedimento, mesmo com percentual corrompido', () => {
    expect(
      resolveDepositAmount({ policy: on({ percent: 250 }), basePrice: 200, isReturn: false }),
    ).toBe(200);
  });
});

describe('isRefundableCancellation', () => {
  const startsAt = new Date('2026-09-10T14:00:00.000Z');
  const policy = on({ cancellationWindowHours: 24 });

  it('cancelou com a antecedência exigida: estorna', () => {
    expect(
      isRefundableCancellation({
        policy,
        startsAt,
        cancelledAt: new Date('2026-09-09T10:00:00.000Z'),
      }),
    ).toBe(true);
  });

  it('exatamente no limite da janela ainda estorna', () => {
    expect(
      isRefundableCancellation({
        policy,
        startsAt,
        cancelledAt: new Date('2026-09-09T14:00:00.000Z'),
      }),
    ).toBe(true);
  });

  it('um minuto depois do limite não estorna', () => {
    expect(
      isRefundableCancellation({
        policy,
        startsAt,
        cancelledAt: new Date('2026-09-09T14:01:00.000Z'),
      }),
    ).toBe(false);
  });

  it('cancelar depois do horário nunca estorna — isso é falta', () => {
    expect(
      isRefundableCancellation({
        policy,
        startsAt,
        cancelledAt: new Date('2026-09-10T15:00:00.000Z'),
      }),
    ).toBe(false);
  });

  it('janela zero: basta cancelar antes do horário', () => {
    const semJanela = on({ cancellationWindowHours: 0 });
    expect(
      isRefundableCancellation({
        policy: semJanela,
        startsAt,
        cancelledAt: new Date('2026-09-10T13:59:00.000Z'),
      }),
    ).toBe(true);
    expect(
      isRefundableCancellation({
        policy: semJanela,
        startsAt,
        cancelledAt: new Date('2026-09-10T14:00:01.000Z'),
      }),
    ).toBe(false);
  });

  it('data inválida não move dinheiro', () => {
    expect(
      isRefundableCancellation({ policy, startsAt, cancelledAt: new Date('data-invalida') }),
    ).toBe(false);
    expect(
      isRefundableCancellation({
        policy,
        startsAt: new Date('data-invalida'),
        cancelledAt: new Date('2026-09-01T10:00:00.000Z'),
      }),
    ).toBe(false);
  });
});
