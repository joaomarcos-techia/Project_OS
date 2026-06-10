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
  FinancialForbiddenError: {
    code: 'forbidden',
    message: 'Você não tem permissão para esta ação.',
  },
  IdempotencyInFlightError: {
    code: 'retry',
    message: 'Pagamento em processamento — aguarde um instante e tente de novo.',
  },
  IdempotencyConflictError: { code: 'conflict', message: 'Requisição duplicada detectada.' },
};

export function fail(err: unknown): ActionResult<never> {
  const name = err instanceof Error ? err.name : '';
  const hit = MAP[name];
  if (hit) return { ok: false, code: hit.code, message: hit.message };
  // FinancialValidationError e afins: a mensagem é segura para o usuário.
  if (name === 'FinancialValidationError' && err instanceof Error) {
    return { ok: false, code: 'validation', message: err.message };
  }
  return { ok: false, code: 'error', message: 'Não foi possível concluir a ação. Tente novamente.' };
}
