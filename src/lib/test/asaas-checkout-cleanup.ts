const COMPLETED_REFUND_STATUS = 'DONE';
const CRITICAL_ACTION_STATUS = 'AWAITING_CRITICAL_ACTION_AUTHORIZATION';
const CANCELLED_REFUND_STATUS = 'CANCELLED';
const IN_FLIGHT_PAYMENT_STATUSES = new Set(['REFUND_REQUESTED', 'REFUND_IN_PROGRESS', 'REFUNDED']);

export interface CheckoutCleanupRefund {
  status: string;
  value: number;
}

export function completedRefundValue(refunds: readonly CheckoutCleanupRefund[]): number {
  return Number(
    refunds
      .filter((refund) => refund.status === COMPLETED_REFUND_STATUS)
      .reduce((total, refund) => total + refund.value, 0)
      .toFixed(2),
  );
}

export function isCancelledCheckoutResponse(response: unknown, checkoutId: string): boolean {
  if (!response || typeof response !== 'object' || Array.isArray(response)) return false;
  return (
    'id' in response &&
    response.id === checkoutId &&
    'status' in response &&
    response.status === 'CANCELED'
  );
}

export type CheckoutCleanupReadback =
  | { state: 'complete' }
  | { state: 'pending-critical-action' }
  | { state: 'cancelled' }
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

/** O Sandbox pode recusar um estorno logo após confirmar o PIX. Antes de
 * repetir o POST, consulte o provedor para não pedir um segundo estorno. */
export async function requestCheckoutRefundWithRetry(input: {
  request: () => Promise<{ accepted: true } | { accepted: false; error: Error }>;
  readback: () => Promise<{ paymentStatus: string; refunds: readonly CheckoutCleanupRefund[] }>;
  wait: () => Promise<void>;
  maxAttempts: number;
}): Promise<void> {
  if (!Number.isInteger(input.maxAttempts) || input.maxAttempts < 1) {
    throw new RangeError('maxAttempts inválido para estorno do Checkout');
  }
  for (let attempt = 0; attempt < input.maxAttempts; attempt += 1) {
    const result = await input.request();
    if (result.accepted) return;

    const state = await input.readback();
    if (hasCheckoutRefundInFlight(state)) return;
    if (!['CONFIRMED', 'RECEIVED', 'RECEIVED_IN_CASH'].includes(state.paymentStatus)) {
      throw result.error;
    }
    if (attempt === input.maxAttempts - 1) throw result.error;
    await input.wait();
  }
}

export function classifyCheckoutCleanup(input: {
  paymentStatus: string;
  paymentDeleted: boolean;
  expectedRefundValue: number;
  refunds: readonly CheckoutCleanupRefund[];
}): CheckoutCleanupReadback {
  if (input.paymentDeleted) {
    return { state: 'complete' };
  }

  const confirmedTotal = completedRefundValue(input.refunds);
  if (confirmedTotal >= input.expectedRefundValue) {
    return { state: 'complete' };
  }

  if (input.refunds.some((refund) => refund.status === CRITICAL_ACTION_STATUS)) {
    return { state: 'pending-critical-action' };
  }

  if (input.refunds.some((refund) => refund.status === CANCELLED_REFUND_STATUS)) {
    return { state: 'cancelled' };
  }

  return { state: 'pending' };
}
