import { describe, expect, it } from 'vitest';

import { FinancialValidationError } from '../errors';
import {
  assertPaymentFitsBalance,
  assertRefundFitsPayment,
  refundableAmount,
} from './payment-ledger';

describe('payment ledger', () => {
  it('acumula pagamentos parciais sem exceder o lancamento', () => {
    expect(assertPaymentFitsBalance(1_000, 400, 600)).toBe(1_000);
    expect(() => assertPaymentFitsBalance(1_000, 400, 600.01)).toThrow(
      FinancialValidationError,
    );
  });

  it('calcula o saldo reembolsavel por pagamento original', () => {
    expect(refundableAmount(500, 200)).toBe(300);
    expect(refundableAmount(500, 700)).toBe(0);
  });

  it('permite reembolso parcial e bloqueia valor acima do pagamento liquido', () => {
    expect(assertRefundFitsPayment(500, 200, 300)).toBe(300);
    expect(() => assertRefundFitsPayment(500, 200, 300.01)).toThrow(
      FinancialValidationError,
    );
  });
});

