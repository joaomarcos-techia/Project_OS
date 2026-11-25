/**
 * Endereço da etapa do código, lembrado só NESTA aba (`sessionStorage`).
 *
 * Antes, ao recarregar a tela, o navegador pedia o endereço ao servidor, e o
 * servidor só sabia devolvê-lo quando o cadastro criou ou reaproveitou uma conta
 * pendente. Para um e-mail que já tem conta a resposta era outra, e isso dizia a
 * quem pediu o cadastro que aquele endereço estava cadastrado. Quem digitou o
 * e-mail já o conhece: guardar aqui não revela nada e não depende da conta.
 * Em outra aba, a pessoa digita o e-mail de novo, igual para todos.
 */
const KEY = 'qoro-signup-destination';

export function rememberSignupDestination(email: string): void {
  const value = email.trim();
  if (!value) return;
  try {
    sessionStorage.setItem(KEY, value);
  } catch {
    // Navegação privada ou armazenamento bloqueado: a pessoa digita de novo.
  }
}

export function recallSignupDestination(): string | null {
  try {
    const value = sessionStorage.getItem(KEY);
    return value && value.length <= 160 && value.includes('@') ? value : null;
  } catch {
    return null;
  }
}

export function forgetSignupDestination(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Nada a limpar.
  }
}
