/**
 * DTOs/helpers compartilhados da tela /configuracoes/pagamentos entre a Server
 * Action e o client (arquivo `'use server'` só exporta função async → tipos e
 * consts vivem aqui). Mesmo contrato `ActionResult` do WhatsApp e do caixa.
 */
import {
  PaymentCredentialRejectedError,
  PaymentProviderUnavailableError,
} from '@/contexts/payments';

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; code: string; message: string };

export function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

/**
 * Mapeia erro de domínio → `ActionResult` sem vazar internals.
 *
 * A distinção que importa para o operador: **chave recusada** (ele corrige) vs
 * **Asaas indisponível** (ninguém corrige, tenta de novo). Tratar as duas como
 * "erro ao salvar" faria alguém trocar uma chave que estava certa.
 */
export function fail(err: unknown): ActionResult<never> {
  if (err instanceof PaymentCredentialRejectedError) {
    return { ok: false, code: err.code, message: err.message };
  }
  if (err instanceof PaymentProviderUnavailableError) {
    return { ok: false, code: err.code, message: err.message };
  }
  const name = err instanceof Error ? err.name : '';
  const code =
    typeof err === 'object' && err !== null && 'code' in err && typeof err.code === 'string'
      ? err.code
      : '';
  if ((code === 'financial_validation' || code === 'payment_validation') && err instanceof Error) {
    return { ok: false, code, message: err.message };
  }
  if (name === 'AuthError') {
    return { ok: false, code: 'forbidden', message: 'Você não tem permissão para esta ação.' };
  }
  if (name === 'ZodError') {
    return {
      ok: false,
      code: 'invalid_input',
      message: 'Confira os campos informados e tente novamente.',
    };
  }
  // Erro não mapeado vai INTEIRO para o Sentry/Better Stack e volta GENÉRICO para a
  // tela (V11: erro cru não vaza). Numa tela que manipula credencial de terceiro,
  // detalhe de exceção é dica para quem estiver do outro lado.
  console.error(
    '[pagamentos action] erro não mapeado:',
    err instanceof Error ? (err.stack ?? err.message) : err,
  );
  return {
    ok: false,
    code: 'error',
    message: 'Não foi possível concluir a ação. Tente novamente.',
  };
}
