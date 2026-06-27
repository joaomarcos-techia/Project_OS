/**
 * DTOs/helpers compartilhados da tela /configuracoes/whatsapp entre Server
 * Actions e client (um arquivo `'use server'` só exporta funções async → tipos/
 * consts vivem aqui). Mesmo contrato `ActionResult` do caixa/consultório.
 */
export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; code: string; message: string };

export function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

/** Mapeia erros de domínio (por `name`) → ActionResult sem vazar internals. */
export function fail(err: unknown): ActionResult<never> {
  const name = err instanceof Error ? err.name : '';
  if (name === 'MetaConnectError') {
    // code estável p/ a UI ("Código: META_AUTH_FAILED"); mensagem genérica.
    return {
      ok: false,
      code: 'META_AUTH_FAILED',
      message: 'Não foi possível conectar o WhatsApp. Tente novamente.',
    };
  }
  if (name === 'AuthError') {
    return {
      ok: false,
      code: 'forbidden',
      message: 'Você não tem permissão para esta ação.',
    };
  }
  return {
    ok: false,
    code: 'error',
    message: 'Não foi possível concluir a ação. Tente novamente.',
  };
}
