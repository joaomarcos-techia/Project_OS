import type { AuthError } from '@supabase/supabase-js';

/**
 * Distingue "o serviço de autenticação não respondeu" de "a credencial está
 * errada" (UX-002, `docs/otimização_ui_final.md`).
 *
 * Mesmo raciocínio de `isCaptchaError`: colapsar os dois faz a pessoa achar que
 * errou a senha, tentar de novo, cair no limite de tentativas e trocar a senha
 * sem necessidade — e o suporte não separa queda de serviço de erro de senha.
 * Não fere anti-enumeração: a falha acontece antes de o GoTrue avaliar a
 * credencial, então a resposta não diz nada sobre a existência da conta.
 *
 * Sinais: `AuthRetryableFetchError` (rede, tempo esgotado, 502/503/504 — o
 * auth-js usa `status` 0 quando nem houve resposta) e qualquer 5xx.
 */
export function isAuthServiceUnavailable(error: AuthError | null | undefined): boolean {
  if (!error) return false;
  if (error.name === 'AuthRetryableFetchError') return true;
  const status = typeof error.status === 'number' ? error.status : undefined;
  return status === 0 || (status !== undefined && status >= 500);
}

/** Mensagem única para o usuário final. Sem detalhe operacional. */
export const AUTH_UNAVAILABLE_MESSAGE =
  'Não conseguimos conectar ao serviço de login agora. Sua senha não foi verificada; tente de novo em alguns instantes.';
