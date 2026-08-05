/**
 * ActionResult + helpers compartilhados pelas telas do Financeiro (Fase 2).
 * Mapeia erros de domínio (por `name`, intactos no servidor) → mensagem amigável.
 */
export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; message: string };

export function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

const MSG: Record<string, string> = {
  SupplierNotFoundError: 'Fornecedor não encontrado.',
  LancamentoNotFoundError: 'Lançamento não encontrado.',
  IdempotencyInFlightError: 'Processando — tente de novo em instantes.',
  IdempotencyConflictError: 'Requisição duplicada detectada.',
};

/** B2 — a porta única lança `AuthError`; ver o WHY em [caixa-types.ts]. */
function authMessage(err: unknown): string | null {
  if (!(err instanceof Error) || err.name !== 'AuthError') return null;
  const code = (err as { code?: string }).code;
  if (code === 'forbidden') return 'Você não tem permissão para esta ação.';
  if (code === 'unauthenticated') return 'Sua sessão expirou. Entre novamente.';
  return null;
}

export function fail(err: unknown): ActionResult<never> {
  const auth = authMessage(err);
  if (auth) return { ok: false, message: auth };
  const name = err instanceof Error ? err.name : '';
  if (name === 'FinancialValidationError' && err instanceof Error) {
    return { ok: false, message: err.message };
  }
  return { ok: false, message: MSG[name] ?? 'Não foi possível concluir a ação. Tente novamente.' };
}
