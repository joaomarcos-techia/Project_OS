/**
 * DTOs/helpers compartilhados da tela /caixa entre Server Actions e client
 * components (um arquivo `'use server'` só exporta funções async → tipos/consts
 * vivem aqui). Mesmo contrato `ActionResult` do consultório (C8).
 */
export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; code: string; message: string };

export function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

/** Mapeia erros de domínio (por `name`, intactos no servidor) → ActionResult. */
const MAP: Record<string, { code: string; message: string }> = {
  LancamentoStateError: {
    code: 'state',
    message: 'Esta ação não é mais possível — a situação do lançamento mudou. Recarregue.',
  },
  LancamentoNotFoundError: { code: 'not_found', message: 'Lançamento não encontrado.' },
  IdempotencyInFlightError: {
    code: 'retry',
    message: 'Pagamento em processamento — aguarde um instante e tente de novo.',
  },
  IdempotencyConflictError: { code: 'conflict', message: 'Requisição duplicada detectada.' },
};

/**
 * B2: a porta única (`tenant-context`) lança `AuthError`, não um erro do contexto.
 * O mapa só conhecia `FinancialForbiddenError` — que vinha dos checks à mão. As
 * actions que já usavam a porta única (createLancamento, createSupplier) caíam no
 * genérico "Tente novamente" ao negar permissão: mensagem errada E enganosa, porque
 * tentar de novo não resolve. `code` distingue 403 de sessão expirada.
 */
function fromAuthError(err: unknown): ActionResult<never> | null {
  if (!(err instanceof Error) || err.name !== 'AuthError') return null;
  const code = (err as { code?: string }).code;
  if (code === 'forbidden') {
    return { ok: false, code: 'forbidden', message: 'Você não tem permissão para esta ação.' };
  }
  if (code === 'unauthenticated') {
    return { ok: false, code: 'unauthenticated', message: 'Sua sessão expirou. Entre novamente.' };
  }
  return null; // 'config' é erro nosso — cai no genérico, sem detalhe ao usuário.
}

export function fail(err: unknown): ActionResult<never> {
  const auth = fromAuthError(err);
  if (auth) return auth;
  const name = err instanceof Error ? err.name : '';
  const hit = MAP[name];
  if (hit) return { ok: false, code: hit.code, message: hit.message };
  // FinancialValidationError e afins: a mensagem é segura para o usuário.
  if (name === 'FinancialValidationError' && err instanceof Error) {
    return { ok: false, code: 'validation', message: err.message };
  }
  return { ok: false, code: 'error', message: 'Não foi possível concluir a ação. Tente novamente.' };
}
