import { describe, expect, it } from 'vitest';

import { FinancialValidationError } from '../errors';
import { isEstornoIntegral, round2 } from '../logic';
import {
  assertPaymentFitsBalance,
  assertRefundFitsPayment,
  refundableAmount,
} from './payment-ledger';

describe('payment ledger', () => {
  it('acumula pagamentos parciais sem exceder o lancamento', () => {
    expect(assertPaymentFitsBalance(1_000, 400, 600)).toBe(1_000);
    expect(() => assertPaymentFitsBalance(1_000, 400, 600.01)).toThrow(FinancialValidationError);
  });

  it('calcula o saldo reembolsavel por pagamento original', () => {
    expect(refundableAmount(500, 200)).toBe(300);
    expect(refundableAmount(500, 700)).toBe(0);
  });

  it('permite reembolso parcial e bloqueia valor acima do pagamento liquido', () => {
    expect(assertRefundFitsPayment(500, 200, 300)).toBe(300);
    expect(() => assertRefundFitsPayment(500, 200, 300.01)).toThrow(FinancialValidationError);
  });
});

describe('DATA-003 — teto por parcela × total global do lançamento', () => {
  // As duas invariantes eram a MESMA conta no código antigo: o subtotal da
  // parcela decidia também a terminalização do lançamento. Com pagamento
  // multiparcelado nenhum subtotal alcança o valor pago, então o estado
  // terminal nunca chegava. Estes casos fixam que são perguntas diferentes.

  it('o teto continua sendo POR PARCELA — não se estorna a parcela inteira do vizinho', () => {
    // Parcela de R$ 3,33 dentro de um lançamento de R$ 10,00.
    expect(() => assertRefundFitsPayment(3.33, 0, 10)).toThrow(/excede/u);
    expect(assertRefundFitsPayment(3.33, 0, 3.33)).toBeCloseTo(3.33, 2);
  });

  it('a terminalização usa o total GLOBAL: 3,33 + 6,67 = 10,00 fecha o lançamento', () => {
    // Nenhuma parcela sozinha alcança 10,00 — o cenário exato do relatório.
    expect(isEstornoIntegral(10, 3.33)).toBe(false);
    expect(isEstornoIntegral(10, round2(3.33 + 6.67))).toBe(true);
  });

  it('estorno parcial de várias parcelas não terminaliza antes da hora', () => {
    expect(isEstornoIntegral(10, round2(1 + 2 + 3))).toBe(false);
    expect(isEstornoIntegral(10, round2(1 + 2 + 3 + 4))).toBe(true);
  });

  it('a ordem das parcelas não muda o resultado', () => {
    expect(isEstornoIntegral(10, round2(6.67 + 3.33))).toBe(true);
    expect(isEstornoIntegral(10, round2(3.33 + 6.67))).toBe(true);
  });

  it('over-refund por parcela continua barrado mesmo com saldo global sobrando', () => {
    // Global permitiria mais 6,67; esta parcela, não.
    expect(() => assertRefundFitsPayment(3.33, 3.33, 0.01)).toThrow(/excede/u);
  });
});
