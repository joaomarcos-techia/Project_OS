/** Remove do DOM a credencial já capturada pelo fluxo de login. */
export function clearPasswordField(form: HTMLFormElement | null): void {
  const field = form?.elements.namedItem('password');
  if (field instanceof HTMLInputElement) field.value = '';
}

/**
 * Aguarda o submit capturar o FormData e remove a credencial antes de qualquer
 * diagnóstico de timeout copiar o DOM.
 */
export function clearPasswordFieldAfterSubmit(form: HTMLFormElement | null): void {
  setTimeout(() => clearPasswordField(form), 0);
}
