// Public surface of the `financial` context (C9).
// Other contexts may only import from this file (eslint-plugin-boundaries).
//
// Exposes: schema entities + enums, event names/payload types, and public DTOs.
// Server Actions, queries e handlers internos NÃO fazem parte da superfície
// cross-context — os vizinhos reagem via eventos do outbox (Scheduling consome
// financial.lancamento.created / financial.faturamento.pendente).
export {
  paymentMethods,
  suppliers,
  lancamentos,
  paymentProofs,
  faturamentoPendencias,
  cashFlowDaily,
  lancamentoTipo,
  lancamentoStatus,
  lancamentoCreatedVia,
  paymentProofType,
  pendenciaStatus,
} from './schema';

export { financialApiV1, type FinancialApiV1 } from './api';
export type { DunningCandidate } from './dunning-candidates';
export { FINANCIAL_EVENTS } from './events';
export type {
  LancamentoCreatedPayload,
  LancamentoPaidPayload,
  LancamentoCancelledPayload,
  LancamentoEstornadoPayload,
  FaturamentoPendentePayload,
} from './events';

export type {
  LancamentoTipo,
  LancamentoStatus,
  LancamentoCreatedVia,
  LancamentoSummary,
  CaixaItem,
  FaturamentoPendenciaDTO,
  CaixaDTO,
  CashFlowDTO,
  SupplierSummary,
  PaymentMethodDTO,
} from './types';
