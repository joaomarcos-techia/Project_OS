import { FinancialValidationError } from '../errors';
import { round2 } from '../logic';

const EPSILON = 1e-9;

export function assertPaymentFitsBalance(
  lancamentoValue: number,
  alreadyPaid: number,
  paymentAmount: number,
): number {
  const nextPaid = round2(alreadyPaid + paymentAmount);
  if (nextPaid > round2(lancamentoValue) + EPSILON) {
    throw new FinancialValidationError('Valor pago excede o valor do lancamento.');
  }
  return nextPaid;
}

export function refundableAmount(paymentAmount: number, alreadyRefunded: number): number {
  return Math.max(0, round2(paymentAmount - alreadyRefunded));
}

export function assertRefundFitsPayment(
  paymentAmount: number,
  alreadyRefunded: number,
  refundAmount: number,
): number {
  const available = refundableAmount(paymentAmount, alreadyRefunded);
  if (round2(refundAmount) > available + EPSILON) {
    throw new FinancialValidationError('Valor do reembolso excede o saldo do pagamento.');
  }
  return available;
}

