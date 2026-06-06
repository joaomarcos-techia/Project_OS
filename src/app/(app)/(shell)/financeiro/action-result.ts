/**
 * ActionResult + helpers compartilhados pelas telas do Financeiro (Fase 2).
 * Mapeia erros de domínio (por `name`, intactos no servidor) → mensagem amigável.
 */
export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; message: string };

export function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

const MSG: Record<string, string> = {
  SupplierNotFoundError: 'Fornecedor não encontrado.',
  LancamentoNotFoundError: 'Lançamento não encontrado.',
  FinancialForbiddenError: 'Você não tem permissão para esta ação.',
  IdempotencyInFlightError: 'Processando — tente de novo em instantes.',
  IdempotencyConflictError: 'Requisição duplicada detectada.',
};

export function fail(err: unknown): ActionResult<never> {
  const name = err instanceof Error ? err.name : '';
  if (name === 'FinancialValidationError' && err instanceof Error) {
    return { ok: false, message: err.message };
  }
  return { ok: false, message: MSG[name] ?? 'Não foi possível concluir a ação. Tente novamente.' };
}
