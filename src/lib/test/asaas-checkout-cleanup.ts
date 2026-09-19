const CONFIRMED_REFUND_STATUSES = new Set(['REFUNDED', 'DONE', 'CONFIRMED', 'COMPLETED']);
const CRITICAL_ACTION_STATUS = 'AWAITING_CRITICAL_ACTION_AUTHORIZATION';
const IN_FLIGHT_PAYMENT_STATUSES = new Set(['REFUND_REQUESTED', 'REFUND_IN_PROGRESS']);

export interface CheckoutCleanupRefund {
  status: string;
  value: number;
}

export type CheckoutCleanupReadback =
  | { state: 'complete' }
  | { state: 'pending-critical-action' }
  | { state: 'pending' };

export function retainCheckoutForChargeback(input: {
  optIn: string | undefined;
  expectedOptIn: string;
  interactive: boolean;
  method: 'CREDIT_CARD' | 'PIX';
}): boolean {
  if (input.optIn === undefined || input.optIn === '0') return false;
  if (input.optIn !== input.expectedOptIn) {
    throw new Error('opt-in de retencao para chargeback invalido');
  }
  if (!input.interactive || input.method !== 'CREDIT_CARD') {
    throw new Error('chargeback exige Checkout interativo por cartao');
  }
  return true;
}

export function hasCheckoutRefundInFlight(input: {
  paymentStatus: string;
  refunds: readonly CheckoutCleanupRefund[];
}): boolean {
  return IN_FLIGHT_PAYMENT_STATUSES.has(input.paymentStatus) || input.refunds.length > 0;
}

export function classifyCheckoutCleanup(input: {
  paymentStatus: string;
  paymentDeleted: boolean;
  expectedRefundValue: number;
  refunds: readonly CheckoutCleanupRefund[];
}): CheckoutCleanupReadback {
  if (input.paymentDeleted || input.paymentStatus === 'REFUNDED') {
    return { state: 'complete' };
  }

  const confirmedTotal = Number(
    input.refunds
      .filter((refund) => CONFIRMED_REFUND_STATUSES.has(refund.status))
      .reduce((total, refund) => total + refund.value, 0)
      .toFixed(2),
  );
  if (confirmedTotal >= input.expectedRefundValue) {
    return { state: 'complete' };
  }

  if (input.refunds.some((refund) => refund.status === CRITICAL_ACTION_STATUS)) {
    return { state: 'pending-critical-action' };
  }

  return { state: 'pending' };
}
