/**
 * Máquinas de estado de billing (C13 — ADR-025 F4). Transições MONOTÔNICAS:
 * tratam webhook fora de ordem (ex.: OVERDUE chega depois de RECEIVED). Estados
 * terminais não regridem (`paid` nunca volta a `overdue`; invoice `cancelled` é fim
 * para transições genéricas). A restauração autoritativa de cobrança removida é
 * uma exceção estreita dentro de `syncInvoiceFromProviderPayment`, não uma aresta
 * aberta nesta máquina.
 * A assinatura de billing só volta de `cancelled` para `active` pelo fluxo
 * auditado de reativação, depois da confirmação do Asaas — e esse fluxo grava o
 * estado diretamente, sem passar por esta tabela.
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
  cancelled: new Set([]), // terminal; restauração do provider usa seam dedicado
};

// `cancelled` é TERMINAL para transições genéricas. A única saída é o fluxo
// auditado de reativação (`reactivateSubscription`), que grava o estado
// diretamente depois de o Asaas aceitar a reativação — ele não passa por aqui.
//
// A aresta `cancelled -> active` existia nesta tabela "para a reativação", mas
// a reativação nunca a usou. Quem usava era `activateSubscription`, chamado por
// qualquer pagamento confirmado: uma parcela que sobrava no Asaas depois do
// cancelamento desfazia o cancelamento sozinha.
const BILLING_ALLOWED: Record<BillingStatus, ReadonlySet<BillingStatus>> = {
  trial: new Set(['active', 'past_due', 'cancelled']),
  active: new Set(['past_due', 'cancelled']),
  past_due: new Set(['active', 'cancelled']),
  cancelled: new Set([]),
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
