/** Financial context domain errors (C9). `code` + `httpStatus` para o caller/UI mapear. */

export class FinancialValidationError extends Error {
  readonly code = 'financial_validation';
  readonly httpStatus = 422;
  constructor(message: string) {
    super(message);
    this.name = 'FinancialValidationError';
  }
}

export class LancamentoNotFoundError extends Error {
  readonly code = 'lancamento_not_found';
  readonly httpStatus = 404;
  constructor(id: string) {
    super(`lançamento não encontrado: ${id}`);
    this.name = 'LancamentoNotFoundError';
  }
}

/**
 * Transição de status inválida (state machine) OU ação não permitida no estado
 * atual (ex.: cancelar/estornar um lançamento já pago/cancelado). Mapeado p/ 409.
 * Sob concorrência (dois cliques em Confirmar Pagamento) o perdedor cai aqui.
 */
export class LancamentoStateError extends Error {
  readonly code = 'lancamento_state';
  readonly httpStatus = 409;
  constructor(message: string) {
    super(message);
    this.name = 'LancamentoStateError';
  }
}

export class SupplierNotFoundError extends Error {
  readonly code = 'supplier_not_found';
  readonly httpStatus = 404;
  constructor(id: string) {
    super(`fornecedor não encontrado: ${id}`);
    this.name = 'SupplierNotFoundError';
  }
}

/** Permissão insuficiente para a ação financeira (ex.: caixa sem operate:caixa). */
export class FinancialForbiddenError extends Error {
  readonly code = 'financial_forbidden';
  readonly httpStatus = 403;
  constructor(message = 'Você não tem permissão para esta ação financeira.') {
    super(message);
    this.name = 'FinancialForbiddenError';
  }
}
