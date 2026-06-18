/**
 * Máquinas de estado de billing (C13 — ADR-025 F4). Transições MONOTÔNICAS:
 * tratam webhook fora de ordem (ex.: OVERDUE chega depois de RECEIVED). Estados
 * terminais não regridem (`paid` nunca volta a `overdue`; `cancelled` é fim).
 *
 * O webhook SEMPRE consulta `canTransition` antes de aplicar a mudança.
 */

export type InvoiceStatus = 'open' | 'partial' | 'paid' | 'overdue' | 'cancelled';
export type BillingStatus = 'trial' | 'active' | 'past_due' | 'cancelled';

const INVOICE_ALLOWED: Record<InvoiceStatus, ReadonlySet<InvoiceStatus>> = {
  open: new Set(['partial', 'paid', 'overdue', 'cancelled']),
  partial: new Set(['paid', 'overdue', 'cancelled']),
  overdue: new Set(['paid', 'cancelled']), // pagamento atrasado recebido → paid
  paid: new Set([]), // terminal (refund é modelado em payment_attempts, não aqui)
  cancelled: new Set([]), // terminal
};

const BILLING_ALLOWED: Record<BillingStatus, ReadonlySet<BillingStatus>> = {
  trial: new Set(['active', 'past_due', 'cancelled']),
  active: new Set(['past_due', 'cancelled']),
  past_due: new Set(['active', 'cancelled']),
  cancelled: new Set([]), // terminal
};

/** true se a transição é permitida (idempotente: from===to é no-op permitido). */
export function canTransitionInvoice(from: InvoiceStatus, to: InvoiceStatus): boolean {
  if (from === to) return true;
  return INVOICE_ALLOWED[from].has(to);
}

export function canTransitionBilling(from: BillingStatus, to: BillingStatus): boolean {
  if (from === to) return true;
  return BILLING_ALLOWED[from].has(to);
}
