/**
 * CNPJ alfanumérico (IN RFB nº 2.229/2024; emissão a partir de julho de 2026).
 *
 * Formato: 12 posições alfanuméricas (A–Z, 0–9) + 2 dígitos verificadores
 * numéricos. O cálculo do DV é o mesmo módulo 11 do CNPJ numérico, mas cada
 * caractere vale `código ASCII − 48` (0–9 → 0–9; A → 17 … Z → 42). Para um CNPJ
 * só com dígitos o resultado é idêntico ao algoritmo antigo.
 *
 * O Padrão TISS 4.03.00 já exige este formato (`st_CNPJ = [A-Z0-9]{12}[0-9]{2}`).
 *
 * Esta função NÃO substitui `isValidCnpj` (`./cnpj`), que normaliza para só
 * dígitos e alimenta hash e persistência de outros cadastros. Trocar aquela
 * normalização é mudança transversal registrada no plano mestre (R16).
 */

/** Maiúsculas, sem pontuação (`.`, `/`, `-`, espaços). Não remove letras. */
export function normalizeCnpjAlphanumeric(input: string | null | undefined): string | null {
  if (input == null) return null;
  const clean = input.toUpperCase().replace(/[\s./-]/gu, '');
  return clean.length === 0 ? null : clean;
}

function checkDigit(base: string): number {
  let weight = 2;
  let sum = 0;
  for (let i = base.length - 1; i >= 0; i--) {
    sum += (base.charCodeAt(i) - 48) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const remainder = sum % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}

export function isValidCnpjAlphanumeric(input: string | null | undefined): boolean {
  const cnpj = normalizeCnpjAlphanumeric(input);
  if (cnpj === null || !/^[A-Z0-9]{12}[0-9]{2}$/u.test(cnpj)) return false;
  if (/^(\d)\1{13}$/u.test(cnpj)) return false;
  const first = checkDigit(cnpj.slice(0, 12));
  const second = checkDigit(cnpj.slice(0, 12) + String(first));
  return cnpj.slice(12) === `${first}${second}`;
}
